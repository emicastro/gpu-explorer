import { useStore } from '../state/store.ts';
import { breadcrumbs } from './machine.ts';

export function Breadcrumbs() {
  const path = useStore((s) => s.path);
  const setPath = useStore((s) => s.setPath);
  return (
    <nav className="breadcrumbs" aria-label="Hardware level">
      <ol>
        {breadcrumbs(path).map((crumb) => (
          <li key={crumb.path.join('/')}>
            <button
              type="button"
              aria-current={crumb.current ? 'location' : undefined}
              disabled={crumb.current}
              onClick={() => { setPath(crumb.path); }}
            >
              {crumb.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
