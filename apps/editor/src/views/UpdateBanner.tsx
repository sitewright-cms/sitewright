import { useEffect, useState } from 'react';
import { api } from '../api';

/** Pull-based update notice: shows a dismissible banner when a newer release exists. */
export function UpdateBanner() {
  const [info, setInfo] = useState<{ latest: string; url: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .version()
      .then((v) => {
        if (active && v.updateAvailable && v.latest) {
          // Defense-in-depth: only ever follow an https link (the server sends a
          // GitHub URL today, but never trust a URL into an href unchecked).
          const url = v.releaseUrl && v.releaseUrl.startsWith('https://') ? v.releaseUrl : null;
          setInfo({ latest: v.latest, url });
        }
      })
      .catch(() => {
        /* update check is best-effort */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!info || dismissed) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-200/60 bg-amber-100/70 px-4 py-2 text-sm text-amber-900 backdrop-blur-xl">
      <span>
        A new Sitewright release ({info.latest}) is available.{' '}
        {info.url && (
          <a href={info.url} target="_blank" rel="noreferrer" className="font-semibold underline">
            View release
          </a>
        )}
      </span>
      <button
        aria-label="Dismiss update notice"
        className="rounded px-1 text-amber-700 hover:text-amber-950"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  );
}
