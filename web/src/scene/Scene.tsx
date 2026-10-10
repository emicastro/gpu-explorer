import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { BOX_SIZE } from './placeholder.ts';

export const SCENE_BACKGROUND = '#0b0d12';

export function Scene() {
  return (
    <Canvas camera={{ position: [3, 3, 3], fov: 50 }}>
      <color attach="background" args={[SCENE_BACKGROUND]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} />
      <mesh>
        <boxGeometry args={[BOX_SIZE, BOX_SIZE, BOX_SIZE]} />
        <meshStandardMaterial color="#4c8bf5" />
      </mesh>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
