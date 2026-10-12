import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

/** What the last frame cost the GPU (design §6.7). */
export interface RenderInfo {
  calls: number;
  triangles: number;
  pixelRatio: number;
}

let source: (() => RenderInfo) | null = null;

/** The last frame's counts, or null before the canvas mounts. */
export function readRenderInfo(): RenderInfo | null {
  return source?.() ?? null;
}

/**
 * Lets `readRenderInfo` reach the renderer. Mount once inside the canvas. The
 * renderer resets its counters at each render, so the numbers are the last
 * frame's main pass.
 */
export function useRenderInfoProbe(): void {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    source = () => ({
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      pixelRatio: gl.getPixelRatio(),
    });
    return () => {
      source = null;
    };
  }, [gl]);
}
