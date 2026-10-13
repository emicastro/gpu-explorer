import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { PerspectiveCamera, type Group, type Vector3 } from 'three';
import {
  clipPlanes,
  setClipPlanes,
  ease,
  lerp,
  lerpPose,
  OVERVIEW_POSE,
  poseForLevel,
  siblingRestOpacity,
  TRANSITION_SECONDS,
  type Pose,
} from '../nav/camera.ts';
import { useStore } from '../state/store.ts';
import type { HwNode } from '../core/index.ts';
import { busySmKeys, smOccupancy, smSlots, waveCount } from '../occupancy/occupancy.ts';
import { clampWave, useWave } from '../occupancy/wave.ts';
import { sceneSubject } from '../plan/kernels.ts';
import { Flow } from './Flow.tsx';
import { Labels } from './Labels.tsx';
import { levelContent, levelFrame } from './frames.ts';
import { DIE_FRAME, layoutDie, layoutPackage, nodeAtLevel, type Placement } from './layout.ts';
import { createMaterials, type MaterialSet } from './materials.ts';
import { LIGHT_COLORS, SCENE_BACKGROUND, smOccupancyColor } from './palette.ts';
import { Parts } from './Parts.tsx';
import { useRenderInfoProbe } from './renderInfo.ts';

/** The part of drei's OrbitControls the rig drives. */
interface Orbit {
  target: Vector3;
  update: () => void;
}

interface Flight {
  elapsed: number;
  fromPose: Pose;
  toPose: Pose;
  fromFade: number;
  toFade: number;
}

/** A material set for the life of the component, disposed on unmount. */
function useMaterials(fades: boolean): MaterialSet {
  const set = useMemo(() => createMaterials({ fades }), [fades]);
  useEffect(() => () => { set.dispose(); }, [set]);
  return set;
}

/**
 * The flow's pulse clock: seconds since the kernel came on. Mounted per kernel,
 * so a new kernel starts a new pulse. The wave is not the clock's: it follows
 * the playhead (ADR 0020).
 */
function PulseClock({ clockRef }: { clockRef: RefObject<number> }) {
  useEffect(() => {
    clockRef.current = 0;
  }, [clockRef]);
  useFrame((_, delta) => {
    clockRef.current += delta;
  });
  return null;
}

/** Lights the enabled SMs in `busy`, dims the other enabled ones; leaves every other part alone. */
const occupancyColors = (busy: Set<string> | null) => (p: Placement): string | undefined =>
  busy && p.kind === 'sm' && p.enabled ? smOccupancyColor(busy.has(p.key)) : undefined;

/**
 * The current level's parts. Flies the camera and fades the siblings when the
 * path changes (design §6.2).
 * A new flight starts from wherever the camera is, so interrupting one is smooth.
 */
function Level({ hardware }: { hardware: HwNode }) {
  const siblings = useRef<Group>(null);
  const enter = useStore((s) => s.enter);
  const path = useStore((s) => s.path);
  const picks = useStore((s) => s.picks);
  const from = useStore((s) => s.from);
  const flying = from !== null;
  const plan = useStore((s) => s.plan);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as Orbit | null;
  const fade = useRef(1);
  const flight = useRef<Flight | null>(null);
  const lastPath = useRef<string[]>(useStore.getState().path);
  // The package's siblings fade, so they own their materials (ADR 0017).
  const fadingMaterials = useMaterials(true);
  const solidMaterials = useMaterials(false);

  useFrame((_, delta) => {
    const { path, picks, settle } = useStore.getState();
    if (path !== lastPath.current) {
      lastPath.current = path;
      const target = controls?.target;
      flight.current = {
        elapsed: 0,
        fromPose: {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: target ? [target.x, target.y, target.z] : OVERVIEW_POSE.target,
        },
        toPose: poseForLevel(path.length, levelFrame(hardware, path, picks)),
        fromFade: fade.current,
        toFade: siblingRestOpacity(path.length),
      };
    }

    const f = flight.current;
    if (f) {
      f.elapsed += delta;
      const t = ease(f.elapsed / TRANSITION_SECONDS);
      const pose = lerpPose(f.fromPose, f.toPose, t);
      camera.position.set(...pose.position);
      controls?.target.set(...pose.target);
      controls?.update();
      fade.current = lerp(f.fromFade, f.toFade, t);
      if (f.elapsed >= TRANSITION_SECONDS) {
        flight.current = null;
        settle();
      }
    }

    // Four nested frames span five orders of magnitude: the clip planes follow the camera.
    if (camera instanceof PerspectiveCamera) {
      const t = controls?.target;
      const dist = t ? camera.position.distanceTo(t) : camera.position.length();
      const { near, far } = clipPlanes(dist);
      setClipPlanes(camera, near, far);
    }

    const group = siblings.current;
    if (group) group.visible = fade.current > 0.001;
    fadingMaterials.setOpacity(fade.current);
  });
  // The package stays until the flight lands; the die mounts on arrival (design §6.2).
  const packageParts = useMemo(() => layoutPackage(nodeAtLevel(hardware, 'package')), [hardware]);
  const dieParts = useMemo(() => layoutDie(nodeAtLevel(hardware, 'die')), [hardware]);
  // While flying, the shallower of the two ends stays on screen: the camera flies
  // toward (or away from) a tile of it. The deeper level mounts on landing.
  const depth = from ? Math.min(path.length, from.length) : path.length;
  const shownPath = path.slice(0, depth);
  const shownPicks = picks.slice(0, depth);
  // The slices are new arrays each render; their content is what matters.
  const shownKey = `${shownPath.join('/')}@${shownPicks.join(',')}`;
  const deep = useMemo(
    () => (depth >= 2 ? levelContent(hardware, shownPath, shownPicks) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hardware, depth, shownKey],
  );
  const showPackage = depth === 0;
  const showDie = depth === 1;
  const showGpc = depth === 2;

  // The kernel on the scene and the SMs its current wave occupies (task 5.3, ADR 0020).
  const kernelRef = useStore((s) => s.sceneKernel);
  const summary = useStore((s) => s.summary);
  const kernel = plan ? sceneSubject(plan, kernelRef, summary) : null;
  const waves = kernel ? waveCount(kernel) : 1;
  const ticked = useWave((s) => s.wave);
  const wave = clampWave(ticked, waves);
  const clockRef = useRef(0);
  const slots = useMemo(() => smSlots(nodeAtLevel(hardware, 'die')), [hardware]);
  const busy = useMemo(() => (kernel ? smOccupancy(kernel, wave, slots.length) : null), [kernel, wave, slots]);
  const dieBusy = useMemo(() => (busy ? busySmKeys(slots, busy) : null), [busy, slots]);
  const gpcId = showGpc ? shownPath[1] : undefined;
  const gpcPick = shownPicks[1] ?? 0;
  const gpcBusy = useMemo(
    () => (busy && gpcId ? busySmKeys(slots, busy, { gpcId, gpc: gpcPick }) : null),
    [busy, slots, gpcId, gpcPick],
  );
  const dieColors = useMemo(() => occupancyColors(dieBusy), [dieBusy]);
  const gpcColors = useMemo(() => occupancyColors(gpcBusy), [gpcBusy]);
  return (
    <>
      {showPackage && (
        <>
          <group ref={siblings}>
            <Parts
              placements={packageParts.filter((p) => p.enterId === null)}
              materials={fadingMaterials}
              onEnter={enter}
            />
          </group>
          <Parts
            placements={packageParts.filter((p) => p.enterId !== null)}
            materials={solidMaterials}
            onEnter={enter}
          />
        </>
      )}
      {kernel && (showDie || showGpc) && <PulseClock key={kernel.id} clockRef={clockRef} />}
      {showDie && (
        <group position={[...DIE_FRAME.position]} scale={DIE_FRAME.scale}>
          <Parts placements={dieParts} materials={solidMaterials} onEnter={enter} colorOf={dieColors} />
          {kernel && dieBusy && <Flow kernel={kernel} dieParts={dieParts} busy={dieBusy} clockRef={clockRef} />}
        </group>
      )}
      {deep && (
        <group position={[...deep.frame.position]} scale={deep.frame.scale}>
          <Parts
            placements={deep.placements}
            materials={solidMaterials}
            onEnter={enter}
            colorOf={showGpc ? gpcColors : undefined}
          />
        </group>
      )}
      {/* Labels stay mounted and toggle: their DOM overlay outlives the levels' meshes. */}
      <Labels tree={hardware} placements={packageParts} show={showPackage && !flying} />
      <Labels tree={hardware} placements={dieParts} own="die" show={showDie && !flying} frame={DIE_FRAME} />
      {deep && (
        <Labels
          tree={hardware}
          key={shownKey}
          placements={deep.placements}
          own={deep.own}
          show={!flying}
          frame={deep.frame}
        />
      )}
    </>
  );
}

/**
 * The reflections metal needs: a studio of light panels rendered into an
 * environment map once (`frames={1}`), from code. No preset, no file (R19).
 */
function Studio() {
  return (
    <Environment frames={1} resolution={256}>
      <Lightformer form="rect" color={LIGHT_COLORS.softbox} intensity={0.5} position={[0, 6, 0]} scale={[24, 24, 1]} target={[0, 0, 0]} />
      {[-5, -1.5, 2].map((x) => (
        <Lightformer key={x} form="rect" color={LIGHT_COLORS.softbox} intensity={3} position={[x, 5.5, -x]} scale={[1.2, 18, 1]} target={[0, 0, 0]} />
      ))}
      <Lightformer form="rect" color={LIGHT_COLORS.cool} intensity={1.6} position={[-6, 1.5, 2]} scale={[1, 8, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" color={LIGHT_COLORS.warm} intensity={1.2} position={[6, 1, -2]} scale={[1, 8, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" color={LIGHT_COLORS.softbox} intensity={1.5} position={[2, 3, 6]} scale={2.5} target={[0, 0, 0]} />
    </Environment>
  );
}

function RenderInfoProbe() {
  useRenderInfoProbe();
  return null;
}

/** Pixel ratio ceiling (design §6.7); it drops toward 1 when the frame rate falls. */
const MAX_DPR = 2;

export function Scene({ hardware }: { hardware: HwNode }) {
  const start = OVERVIEW_POSE;
  const top = Math.min(MAX_DPR, window.devicePixelRatio);
  const [dpr, setDpr] = useState(top);
  return (
    <Canvas camera={{ position: [...start.position], fov: 50, near: clipPlanes(6.2).near, far: clipPlanes(6.2).far }} dpr={dpr}>
      <PerformanceMonitor
        onIncline={() => { setDpr(top); }}
        onDecline={() => { setDpr(1); }}
        flipflops={3}
        onFallback={() => { setDpr(1); }}
      />
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <Studio />
      <directionalLight position={[5, 8, 3]} intensity={1.4} color={LIGHT_COLORS.key} />
      <Level hardware={hardware} />
      <OrbitControls makeDefault />
      <RenderInfoProbe />
    </Canvas>
  );
}
