import { FlowLabel } from './flow/FlowLabel.tsx';
import { ComponentPanel } from './panel/ComponentPanel.tsx';
import { LevelNote } from './nav/LevelNote.tsx';
import { Breadcrumbs } from './nav/Breadcrumbs.tsx';
import { useNavigationKeys } from './nav/useNavigationKeys.ts';
import type { HwNode, ModelConfig } from './core/index.ts';
import { OccupancyCard } from './occupancy/OccupancyCard.tsx';
import { Scene } from './scene/Scene.tsx';

export function App({ hardware, model }: { hardware: HwNode; model: ModelConfig }) {
  useNavigationKeys();
  return (
    <>
      <Scene hardware={hardware} />
      <Breadcrumbs />
      <ComponentPanel hardware={hardware} />
      <div className="hud-right">
        <FlowLabel />
        <OccupancyCard hardware={hardware} kvHeads={model.config.num_key_value_heads} />
      </div>
      <LevelNote />
    </>
  );
}
