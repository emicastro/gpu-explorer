import { useEffect, useState } from 'react';

/** Below this width the layout does not fit (R17). */
export const MIN_WIDTH = 1024;
const QUERY = `(max-width: ${String(MIN_WIDTH - 1)}px)`;

/** A banner on screens narrower than 1024 px. It never takes the pointer, so the page stays usable. */
export function SmallScreenNotice() {
  const [small, setSmall] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => { setSmall(mq.matches); };
    mq.addEventListener('change', on);
    return () => { mq.removeEventListener('change', on); };
  }, []);
  if (!small) return null;
  return (
    <div className="small-screen-notice" role="status" data-testid="small-screen-notice">
      {`This explorer is built for screens 1024 px or wider. On this one, panels will overlap and some text will be cut off.`}
    </div>
  );
}
