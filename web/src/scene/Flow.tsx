import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import type { KernelPlan } from '../core/index.ts';
import { arrivalScale, flowParticles, flowRoutes, flowStreams, pointAt } from '../flow/flow.ts';
import type { Placement } from './layout.ts';
import { FLOW_COLORS } from './palette.ts';

/** Seconds from the HBM to a tensor core. */
const LOOP_SECONDS = 3;
const PARTICLE_SIZE = 0.04;

interface FlowProps {
  kernel: KernelPlan;
  dieParts: Placement[];
}

/** The kernel's HBM reads as particles over the die, in one draw call (design §6.6). */
export function Flow({ kernel, dieParts }: FlowProps) {
  const mesh = useRef<InstancedMesh>(null);
  const clock = useRef(0);
  const routes = useMemo(() => flowRoutes(dieParts), [dieParts]);
  const particles = useMemo(
    () => flowParticles(flowStreams(kernel), routes.length),
    [kernel, routes],
  );
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const color = new Color();
    particles.forEach((p, i) => { m.setColorAt(i, color.set(FLOW_COLORS[p.cls])); });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [particles]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    clock.current += delta;
    const loop = clock.current / LOOP_SECONDS;
    particles.forEach((p, i) => {
      const route = routes[p.route];
      if (!route) return;
      const s = (loop + p.phase) % 1;
      const [x, y, z] = pointAt(route, s);
      dummy.position.set(x + p.offset[0], y + p.offset[1], z + p.offset[2]);
      dummy.scale.setScalar(PARTICLE_SIZE * arrivalScale(s));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  // The particles move every frame, so a bounding sphere computed once would cull them.
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, particles.length]} frustumCulled={false}>
      <sphereGeometry args={[0.5, 8, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
