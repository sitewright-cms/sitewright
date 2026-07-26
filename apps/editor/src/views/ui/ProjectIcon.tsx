import { useState } from 'react';
import { Globe } from 'lucide-react';

/**
 * A project's favicon (from `identity.icon` → `iconUrl`), falling back to a generic globe glyph when the
 * URL is unset or the image fails to load. The caller supplies `boxClassName` (size + shape + background
 * of the badge) and, optionally, `iconClassName` (size + colour of the fallback glyph) so the same badge
 * serves both the header brand mark and the project-selector list rows.
 */
export function ProjectIcon({
  src,
  boxClassName,
  iconClassName = 'h-4 w-4',
}: {
  src?: string;
  boxClassName: string;
  iconClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <span className={boxClassName}>
        {/* no-referrer: an owner-set external favicon URL must not receive a Referer beacon (belt-and-
            suspenders over the global same-origin referrer-policy header). */}
        <img
          src={src}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return (
    <span className={boxClassName} aria-hidden>
      <Globe className={iconClassName} />
    </span>
  );
}
