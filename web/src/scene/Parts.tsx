import { useLayoutEffect, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import { groupParts, type Placement } from './layout.ts';
import { partColor } from './palette.ts';

interface PartsProps {
  placements: Placement[];
  onEnter: (id: string) => void;
}

/** A kind that repeats a lot: one draw call, one color per instance. */
function InstancedParts({ list }: { list: Placement[] }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new Object3D();
    const color = new Color();
    list.forEach((p, i) => {
      dummy.position.set(...p.position);
      dummy.scale.set(...p.size);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(partColor(p.kind, p.enabled)));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [list]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, list.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial transparent />
    </instancedMesh>
  );
}

/** Draws placements as boxes; clicking one with an `enterId` enters it. */
export function Parts({ placements, onEnter }: PartsProps) {
  const { instanced, single } = groupParts(placements);
  return (
    <>
      {instanced.map((list) => (
        <InstancedParts key={list[0]?.kind} list={list} />
      ))}
      {single.map((p) => (
        <mesh
          key={p.key}
          position={[...p.position]}
          onClick={(e) => {
            if (!p.enterId) return;
            e.stopPropagation();
            onEnter(p.enterId);
          }}
        >
          <boxGeometry args={[...p.size]} />
          <meshStandardMaterial color={partColor(p.kind, p.enabled)} transparent />
        </mesh>
      ))}
    </>
  );
}
