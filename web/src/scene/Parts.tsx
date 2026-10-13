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
  /** A click on a part with no level of its own opens its panel. */
  onSelect: (id: string) => void;
  /**
   * Overrides the palette color of an instanced part (the SMs a wave lights,
   * task 5.3); undefined keeps it. Parts drawn alone ignore it.
   */
  colorOf?: ((p: Placement) => string | undefined) | undefined;
}

/** Pointer events that tell the tooltip which part is under the pointer. */
type HoverEvent = {
  clientX?: number;
  clientY?: number;
  nativeEvent?: { clientX: number; clientY: number };
  stopPropagation: () => void;
};
/** Only the nearest part under the pointer is explained: the ones behind it get no event. */
const hoverOver = (nodeId: string, e: HoverEvent) => {
  e.stopPropagation();
  const n = e.nativeEvent;
  useSceneHover.getState().set({ nodeId, x: n?.clientX ?? e.clientX ?? 0, y: n?.clientY ?? e.clientY ?? 0 });
};
/** Leaving a part clears the tooltip unless the pointer has already moved to another part. */
const hoverOut = (nodeId?: string) => {
  const { hover, set } = useSceneHover.getState();
  if (nodeId === undefined || hover?.nodeId === nodeId) set(null);
};

/**
 * A kind that repeats a lot: one draw call, one color per instance. The kind's
 * parts share one size, so the geometry is built at that size and the
 * instances only move. The instance under the pointer is the one explained,
 * and entered when it has a level of its own (the SMs of a GPC).
 */
function InstancedParts({ list, materials, onEnter, onSelect, colorOf }: PartsProps & { list: Placement[] }) {
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
  const events = {
    onClick: (e: { stopPropagation: () => void; instanceId?: number }) => {
      const hit = e.instanceId === undefined ? undefined : list[e.instanceId];
      if (!hit) return;
      e.stopPropagation();
      hoverOut();
      if (hit.enterId) onEnter(hit.enterId, hit.instance);
      else onSelect(hit.infoId);
    },
    onPointerMove: (e: HoverEvent & { instanceId?: number }) => {
      const hit = e.instanceId === undefined ? undefined : list[e.instanceId];
      if (hit) hoverOver(hit.infoId, e);
    },
    onPointerOut: (e: { instanceId?: number }) => {
      const hit = e.instanceId === undefined ? undefined : list[e.instanceId];
      hoverOut(hit?.infoId);
    },
  };
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

/** Draws placements as beveled boxes; clicking one with an `enterId` enters it, any other opens its panel. */
export function Parts({ placements, materials, onEnter, onSelect, colorOf }: PartsProps) {
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
          onSelect={onSelect}
          colorOf={colorOf}
        />
      ))}
      {single.map((p) => {
        const events = {
          onClick: (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            hoverOut();
            if (p.enterId) onEnter(p.enterId, p.instance);
            else onSelect(p.infoId);
          },
          onPointerMove: (e: HoverEvent) => { hoverOver(p.infoId, e); },
          onPointerOut: () => { hoverOut(p.infoId); },
        };
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
