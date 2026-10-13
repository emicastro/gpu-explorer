import { FlowLabel } from './flow/FlowLabel.tsx';
import { ComponentPanel } from './panel/ComponentPanel.tsx';
import { KnobsPanel } from './knobs/KnobsPanel.tsx';
import { LevelNote } from './nav/LevelNote.tsx';
import { Breadcrumbs } from './nav/Breadcrumbs.tsx';
import { useNavigationKeys } from './nav/useNavigationKeys.ts';
import type { HwNode, ModelConfig } from './core/index.ts';
import { usePlaybackDriver } from './playback/driver.ts';
import { Transport } from './playback/Transport.tsx';
import { OccupancyCard } from './occupancy/OccupancyCard.tsx';
import { HbmBar } from './linked/HbmBar.tsx';
import { Roofline } from './linked/Roofline.tsx';
import { Scene } from './scene/Scene.tsx';

export function App({ hardware, model }: { hardware: HwNode; model: ModelConfig }) {
  useNavigationKeys();
  usePlaybackDriver();
  return (
    <>
      <Scene hardware={hardware} />
      <Breadcrumbs />
      <ComponentPanel hardware={hardware} />
      <div className="hud-right">
        <KnobsPanel />
        <FlowLabel />
        <HbmBar />
        <Roofline />
        <OccupancyCard hardware={hardware} kvHeads={model.config.num_key_value_heads} />
      </div>
      <Transport />
      <LevelNote />
    </>
  );
}
