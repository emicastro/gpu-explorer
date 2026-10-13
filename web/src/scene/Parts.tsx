import { useLayoutEffect, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import { roundedBox } from './geometry.ts';
import { groupParts, type Placement } from './layout.ts';
import type { MaterialSet } from './materials.ts';
import { partColor } from './palette.ts';
import { useSceneHover } from '../tooltip/SceneTip.tsx';

interface PartsProps {
  placements: Placement[];
  materials: MaterialSet;
  onEnter: (id: string, instance: number) => void;
  /**
   * Overrides the palette color of an instanced part (the SMs a wave lights,
   * task 5.3); undefined keeps it. Parts drawn alone ignore it.
   */
  colorOf?: ((p: Placement) => string | undefined) | undefined;
}

/** Pointer events that tell the tooltip which part is under the pointer. */
type HoverEvent = { clientX?: number; clientY?: number; nativeEvent?: { clientX: number; clientY: number } };
const hoverOver = (nodeId: string, e: HoverEvent) => {
  const n = e.nativeEvent;
  useSceneHover.getState().set({ nodeId, x: n?.clientX ?? e.clientX ?? 0, y: n?.clientY ?? e.clientY ?? 0 });
};
const hoverOut = () => { useSceneHover.getState().set(null); };

/** Parts a click can't act on skip the raycast entirely (ADR 0017). */
const noRaycast = () => undefined;

/**
 * A kind that repeats a lot: one draw call, one color per instance. The kind's
 * parts share one size, so the geometry is built at that size and the
 * instances only move. Instanced parts are detail, and skip the raycast,
 * unless some of them can be entered (the SMs of a GPC): then the instance
 * under the pointer is the one entered.
 */
function InstancedParts({ list, materials, onEnter, colorOf }: PartsProps & { list: Placement[] }) {
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
      m.setColorAt(i, color.set(colorOf?.(p) ?? partColor(p.kind, p.enabled)));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list, colorOf]);
  if (!first) return null;
  const events = list.some((p) => p.enterId !== null)
    ? {
        onClick: (e: { stopPropagation: () => void; instanceId?: number }) => {
          const hit = e.instanceId === undefined ? undefined : list[e.instanceId];
          if (!hit?.enterId) return;
          e.stopPropagation();
          hoverOut();
          onEnter(hit.enterId, hit.instance);
        },
        onPointerMove: (e: HoverEvent & { instanceId?: number }) => {
          const hit = e.instanceId === undefined ? undefined : list[e.instanceId];
          if (hit?.enterId) hoverOver(hit.enterId, e);
        },
        onPointerOut: hoverOut,
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
export function Parts({ placements, materials, onEnter, colorOf }: PartsProps) {
  const { instanced, single } = groupParts(placements);
  return (
    <>
      {instanced.map((list) => (
        <InstancedParts
          key={list[0]?.kind}
          list={list}
          placements={placements}
          materials={materials}
          onEnter={onEnter}
          colorOf={colorOf}
        />
      ))}
      {single.map((p) => {
        const { enterId } = p;
        const events = enterId
          ? {
              onClick: (e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                hoverOut();
                onEnter(enterId, p.instance);
              },
              onPointerMove: (e: HoverEvent) => { hoverOver(enterId, e); },
              onPointerOut: hoverOut,
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
