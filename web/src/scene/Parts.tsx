import { useLayoutEffect, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import { roundedBox } from './geometry.ts';
import { groupParts, type Placement } from './layout.ts';
import type { MaterialSet } from './materials.ts';
import { partColor } from './palette.ts';

interface PartsProps {
  placements: Placement[];
  materials: MaterialSet;
  onEnter: (id: string, instance: number) => void;
}

/** Parts a click can't act on skip the raycast entirely (ADR 0017). */
const noRaycast = () => undefined;

/**
 * A kind that repeats a lot: one draw call, one color per instance. The kind's
 * parts share one size, so the geometry is built at that size and the
 * instances only move. Instanced parts are detail, and skip the raycast,
 * unless some of them can be entered (the SMs of a GPC): then the instance
 * under the pointer is the one entered.
 */
function InstancedParts({ list, materials, onEnter }: PartsProps & { list: Placement[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const first = list[0];
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new Object3D();
    const color = new Color();
    list.forEach((p, i) => {
      dummy.position.set(...p.position);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(partColor(p.kind, p.enabled)));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list]);
  if (!first) return null;
  const events = list.some((p) => p.enterId !== null)
    ? {
        onClick: (e: { stopPropagation: () => void; instanceId?: number }) => {
          const hit = e.instanceId === undefined ? undefined : list[e.instanceId];
          if (!hit?.enterId) return;
          e.stopPropagation();
          onEnter(hit.enterId, hit.instance);
        },
      }
    : { raycast: noRaycast };
  // Geometry and material are shared: the mesh must not dispose them on unmount.
  return (
    <instancedMesh
      ref={mesh}
      args={[roundedBox(first.size), materials.instanced(first.kind), list.length]}
      dispose={null}
      {...events}
    />
  );
}

/** Draws placements as beveled boxes; clicking one with an `enterId` enters it. */
export function Parts({ placements, materials, onEnter }: PartsProps) {
  const { instanced, single } = groupParts(placements);
  return (
    <>
      {instanced.map((list) => (
        <InstancedParts key={list[0]?.kind} list={list} placements={placements} materials={materials} onEnter={onEnter} />
      ))}
      {single.map((p) => {
        const { enterId } = p;
        const events = enterId
          ? {
              onClick: (e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                onEnter(enterId, p.instance);
              },
            }
          : { raycast: noRaycast };
        return (
          <mesh
            key={p.key}
            position={[...p.position]}
            geometry={roundedBox(p.size)}
            material={materials.part(p.kind, p.enabled)}
            dispose={null}
            {...events}
          />
        );
      })}
    </>
  );
}
