import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Vector3 } from 'three';
import { stopIsActive, useFlowStage } from '../flow/stage.ts';
import { levelLabels } from './labels.ts';
import type { Placement, Vec3 } from './layout.ts';
import type { PartKind } from './palette.ts';

interface LabelsProps {
  placements: Placement[];
  /** The level's own kind: no label for the thing you're inside. */
  own?: PartKind;
  show: boolean;
  /** Where the level's frame sits in the world (layout.ts `DIE_FRAME`). */
  frame?: { scale: number; position: Vec3 };
}

/**
 * One fixed label per part kind (ADR 0018). DOM, so no draw calls and plain
 * text, in one overlay per level whose spans follow their anchors every frame.
 * The overlay never takes the pointer, so a click goes through to the part.
 * A label whose flow stop is an end of the current leg lights up.
 */
export function Labels({ placements, own, show, frame }: LabelsProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const leg = useFlowStage((s) => s.leg);
  const labels = useMemo(() => levelLabels(placements, own), [placements, own]);
  const root = useRef<Root | null>(null);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);
  const v = useMemo(() => new Vector3(), []);

  // A root of its own next to the canvas: R3F's reconciler can't render DOM.
  useLayoutEffect(() => {
    const target = gl.domElement.parentNode;
    if (!target) return;
    const el = document.createElement('div');
    el.className = 'scene-labels';
    target.appendChild(el);
    const r = createRoot(el);
    root.current = r;
    return () => {
      root.current = null;
      // Unmounting a root while React renders this one warns; let it finish first.
      queueMicrotask(() => {
        r.unmount();
        el.remove();
      });
    };
  }, [gl]);

  useLayoutEffect(() => {
    root.current?.render(
      <>
        {labels.map((l, i) => {
          const active = l.stop !== null && stopIsActive(leg, l.stop);
          return (
            <span
              key={l.kind}
              ref={(e) => { spans.current[i] = e; }}
              hidden={!show}
              className={active ? 'scene-label scene-label-active' : 'scene-label'}
              data-testid={`label-${l.kind}`}
              data-active={active ? 'true' : 'false'}
            >
              {l.text}
            </span>
          );
        })}
      </>,
    );
  }, [labels, leg, show]);

  useFrame(() => {
    if (!show) return;
    const scale = frame?.scale ?? 1;
    const [ox, oy, oz] = frame?.position ?? [0, 0, 0];
    labels.forEach((l, i) => {
      const span = spans.current[i];
      if (!span) return;
      v.set(l.anchor[0] * scale + ox, l.anchor[1] * scale + oy, l.anchor[2] * scale + oz).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      span.style.visibility = v.z > 1 ? 'hidden' : 'visible';
      span.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    });
  });

  return null;
}
