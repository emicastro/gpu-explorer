import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
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
import { PLACEHOLDER_BOXES } from './placeholder.ts';

/** The part of drei's OrbitControls the rig drives. */
interface Orbit {
  target: Vector3;
  update: () => void;
}

export const SCENE_BACKGROUND = '#0b0d12';

interface Flight {
  elapsed: number;
  fromPose: Pose;
  toPose: Pose;
  fromFade: number;
  toFade: number;
}

/**
 * The placeholder level (task 4.3 replaces the boxes). Flies the camera and
 * fades the siblings when the path changes (design §6.2).
 * A new flight starts from wherever the camera is, so interrupting one is smooth.
 */
function Placeholder() {
  const siblings = useRef<Group>(null);
  const enter = useStore((s) => s.enter);
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
  return (
    <>
      <group ref={siblings}>
        {PLACEHOLDER_BOXES.filter((b) => b.sibling).map((b) => (
          <mesh key={b.key} position={[...b.position]}>
            <boxGeometry args={[...b.size]} />
            <meshStandardMaterial color={b.color} transparent />
          </mesh>
        ))}
      </group>
      {PLACEHOLDER_BOXES.filter((b) => !b.sibling).map((b) => (
        <mesh
          key={b.key}
          position={[...b.position]}
          onClick={(e) => {
            if (!b.id) return;
            e.stopPropagation();
            enter(b.id);
          }}
        >
          <boxGeometry args={[...b.size]} />
          <meshStandardMaterial color={b.color} />
        </mesh>
      ))}
    </>
  );
}

export function Scene() {
  const start = poseForDepth(0);
  return (
    <Canvas camera={{ position: [...start.position], fov: 50 }}>
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <Placeholder />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
