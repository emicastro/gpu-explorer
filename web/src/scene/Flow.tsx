import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { BufferGeometry, Color, Float32BufferAttribute, Object3D, type InstancedMesh } from 'three';
import type { KernelPlan } from '../core/index.ts';
import {
  arrivalScale,
  flowParticles,
  flowPaths,
  flowRoutes,
  flowStreams,
  pointAt,
  waveLeg,
} from '../flow/flow.ts';
import { useFlowStage } from '../flow/stage.ts';
import { WAVE_SECONDS } from '../occupancy/wave.ts';
import type { Placement } from './layout.ts';
import { FLOW_COLORS, FLOW_PATH_COLOR } from './palette.ts';

/** Seconds for one pulse from the HBM to a tensor core: one wave's worth (ADR 0020). */
const LOOP_SECONDS = WAVE_SECONDS;
const PARTICLE_SIZE = 0.045;
const PATH_OPACITY = 0.35;

interface FlowProps {
  kernel: KernelPlan;
  dieParts: Placement[];
  /** Keys of the SMs the current wave occupies: the only ones the pulse lands on. */
  busy: Set<string>;
  /** Seconds on the scene's wave clock, so a pulse starts when a wave does. */
  clockRef: RefObject<number>;
}

/**
 * The kernel's HBM reads over the die (design §6.6, ADR 0018): the shared legs
 * as faint lines, and the particles in pulses along them, one leg at a time.
 * Two draw calls.
 */
export function Flow({ kernel, dieParts, busy, clockRef }: FlowProps) {
  const mesh = useRef<InstancedMesh>(null);
  const setLeg = useFlowStage((s) => s.setLeg);
  const routes = useMemo(() => flowRoutes(dieParts, busy), [dieParts, busy]);
  const particles = useMemo(
    () => flowParticles(flowStreams(kernel), routes.length),
    [kernel, routes],
  );
  const paths = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(flowPaths(routes).flat(2), 3));
    return g;
  }, [routes]);
  useEffect(() => () => { paths.dispose(); }, [paths]);
  // The flow leaves with the die: no leg is current once it unmounts.
  useEffect(() => () => { setLeg(null); }, [setLeg]);
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const color = new Color();
    particles.forEach((p, i) => { m.setColorAt(i, color.set(FLOW_COLORS[p.cls])); });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [particles]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const loop = clockRef.current / LOOP_SECONDS;
    const leg = waveLeg(loop);
    if (useFlowStage.getState().leg !== leg) setLeg(leg);
    particles.forEach((p, i) => {
      const route = routes[p.route];
      if (!route) return;
      // Later phases lead the pulse.
      const s = (loop + p.phase) % 1;
      const [x, y, z] = pointAt(route, s);
      // The spread closes as the particle lands, so it ends on its SM.
      const k = arrivalScale(s);
      dummy.position.set(x + p.offset[0] * k, y + p.offset[1] * k, z + p.offset[2] * k);
      // Shrinks as it lands, but stays visible on its SM.
      dummy.scale.setScalar(PARTICLE_SIZE * (0.6 + 0.4 * k));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  // The particles move every frame, so a bounding sphere computed once would cull them.
  return (
    <>
      <lineSegments geometry={paths} raycast={() => undefined}>
        <lineBasicMaterial color={FLOW_PATH_COLOR} transparent opacity={PATH_OPACITY} toneMapped={false} />
      </lineSegments>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, particles.length]}
        frustumCulled={false}
        raycast={() => undefined}
      >
        <sphereGeometry args={[0.5, 8, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}
