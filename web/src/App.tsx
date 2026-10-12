import { FlowLabel } from './flow/FlowLabel.tsx';
import { ComponentPanel } from './panel/ComponentPanel.tsx';
import { LevelNote } from './nav/LevelNote.tsx';
import { Breadcrumbs } from './nav/Breadcrumbs.tsx';
import { useNavigationKeys } from './nav/useNavigationKeys.ts';
import type { HwNode } from './core/index.ts';
import { Scene } from './scene/Scene.tsx';

export function App({ hardware }: { hardware: HwNode }) {
  useNavigationKeys();
  return (
    <>
      <Scene hardware={hardware} />
      <Breadcrumbs />
      <ComponentPanel hardware={hardware} />
      <FlowLabel />
      <LevelNote />
    </>
  );
}
