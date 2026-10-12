import { Breadcrumbs } from './nav/Breadcrumbs.tsx';
import { useNavigationKeys } from './nav/useNavigationKeys.ts';
import { Scene } from './scene/Scene.tsx';

export function App() {
  useNavigationKeys();
  return (
    <>
      <Scene />
      <Breadcrumbs />
    </>
  );
}
