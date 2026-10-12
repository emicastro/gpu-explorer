import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Vector3 } from 'three';
import {
  ease,
  lerp,
  lerpPose,
  poseForDepth,
  siblingRestOpacity,
  TRANSITION_SECONDS,
  type Pose,
} from '../nav/camera.ts';
import { useStore } from '../state/store.ts';
import type { HwNode } from '../core/index.ts';
import { FLOW_OP, findKernel } from '../flow/flow.ts';
import { Flow } from './Flow.tsx';
import { Labels } from './Labels.tsx';
import { DIE_FRAME, layoutDie, layoutPackage, nodeAtLevel } from './layout.ts';
import { createMaterials, type MaterialSet } from './materials.ts';
import { LIGHT_COLORS, SCENE_BACKGROUND } from './palette.ts';
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
 * The current level's parts. Flies the camera and fades the siblings when the
 * path changes (design §6.2).
 * A new flight starts from wherever the camera is, so interrupting one is smooth.
 */
function Level({ hardware }: { hardware: HwNode }) {
  const siblings = useRef<Group>(null);
  const enter = useStore((s) => s.enter);
  const path = useStore((s) => s.path);
  const flying = useStore((s) => s.from !== null);
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
    const { path, settle } = useStore.getState();
    if (path !== lastPath.current) {
      lastPath.current = path;
      const target = controls?.target;
      flight.current = {
        elapsed: 0,
        fromPose: {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: target ? [target.x, target.y, target.z] : poseForDepth(0).target,
        },
        toPose: poseForDepth(path.length),
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

    const group = siblings.current;
    if (group) group.visible = fade.current > 0.001;
    fadingMaterials.setOpacity(fade.current);
  });
  // The package stays until the flight lands; the die mounts on arrival (design §6.2).
  const packageParts = useMemo(() => layoutPackage(nodeAtLevel(hardware, 'package')), [hardware]);
  const dieParts = useMemo(() => layoutDie(nodeAtLevel(hardware, 'die')), [hardware]);
  const showPackage = path.length === 0 || flying;
  const showDie = path.length >= 1 && !flying;
  const flowKernel = plan ? findKernel(plan, FLOW_OP) : null;
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
      {showDie && (
        <group position={[...DIE_FRAME.position]} scale={DIE_FRAME.scale}>
          <Parts placements={dieParts} materials={solidMaterials} onEnter={enter} />
          {flowKernel && <Flow kernel={flowKernel} dieParts={dieParts} />}
        </group>
      )}
      {/* Labels stay mounted and toggle: their DOM overlay outlives the levels' meshes. */}
      <Labels placements={packageParts} show={path.length === 0 && !flying} />
      <Labels placements={dieParts} own="die" show={showDie} frame={DIE_FRAME} />
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
  const start = poseForDepth(0);
  const top = Math.min(MAX_DPR, window.devicePixelRatio);
  const [dpr, setDpr] = useState(top);
  return (
    <Canvas camera={{ position: [...start.position], fov: 50 }} dpr={dpr}>
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
