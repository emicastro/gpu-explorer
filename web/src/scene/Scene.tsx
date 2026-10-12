import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group, Material, Vector3 } from 'three';
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
import { layoutDie, layoutPackage, nodeAtLevel } from './layout.ts';
import { SCENE_BACKGROUND } from './palette.ts';
import { Parts } from './Parts.tsx';

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
    if (group) {
      group.visible = fade.current > 0.001;
      group.traverse((o) => {
        const material = (o as { material?: Material }).material;
        if (material) material.opacity = fade.current;
      });
    }
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
            <Parts placements={packageParts.filter((p) => p.enterId === null)} onEnter={enter} />
          </group>
          <Parts placements={packageParts.filter((p) => p.enterId !== null)} onEnter={enter} />
        </>
      )}
      {showDie && <Parts placements={dieParts} onEnter={enter} />}
      {showDie && flowKernel && <Flow kernel={flowKernel} dieParts={dieParts} />}
    </>
  );
}

export function Scene({ hardware }: { hardware: HwNode }) {
  const start = poseForDepth(0);
  return (
    <Canvas camera={{ position: [...start.position], fov: 50 }}>
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <Level hardware={hardware} />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
