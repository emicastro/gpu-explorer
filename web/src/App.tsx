import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { BOX_SIZE } from './scene/placeholder.ts';

export function App() {
  return (
    <Canvas camera={{ position: [3, 3, 3], fov: 50 }}>
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
