import { useEffect, useState } from 'react';
import { Icon } from './icons';

declare const __APP_VERSION__: string;
/** The release this bundle was built from; 'dev' under tests and the dev server, which never prompt. */
export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * A tab left open keeps running the release it loaded, so a deploy can go
 * unseen for days and staff report a fixed form as still broken. The server
 * says which release it is; when it differs from this bundle, a banner offers
 * a reload. It never reloads by itself, because a register may be half typed.
 */
export function UpdateNotice() {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    if (appVersion === 'dev') return;
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch('/health/live', { cache: 'no-store' });
        const body = await response.json() as { version?: string };
        if (!stopped && body.version && body.version !== appVersion) setLatest(body.version);
      } catch { /* offline or restarting: try again later */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  if (!latest) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="info" size={16} />
      <span>EDUNEXUS has been updated to {latest}; this page is still running {appVersion}. Save what you are typing, then reload to use the new version.</span>
      <button type="button" className="btn small" onClick={() => window.location.reload()}>Reload now</button>
    </div>
  );
}
