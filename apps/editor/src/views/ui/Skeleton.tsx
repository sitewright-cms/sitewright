/**
 * DaisyUI animated `skeleton` placeholders shown while content loads — boxes that
 * pulse on the page surface instead of blank space or a bare "Loading…" string.
 */
import { useState } from 'react';

/** A single DaisyUI `skeleton` block; size/shape via `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/**
 * A stack of skeleton bars standing in for not-yet-loaded text / list / form content.
 * Carries an sr-only "Loading…" status so the placeholder stays announced to AT, even
 * though the bars themselves are decorative.
 */
export function SkeletonList({
  rows = 3,
  className = '',
  label = 'Loading…',
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    // role="status" already implies a polite live region.
    <div className={`flex flex-col gap-3 ${className}`} role="status">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className={`skeleton h-5 rounded-lg ${i === rows - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * A lazy `<img>` that shows a DaisyUI skeleton until it loads (or errors), so thumbnail
 * grids fill with pulsing boxes instead of blank frames. The wrapper owns the box size +
 * radius (pass via `className`); the image covers it and fades in on load.
 */
export function SkeletonImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  return (
    <span className={`relative block overflow-hidden ${className}`}>
      {status === 'loading' && <span aria-hidden className="skeleton absolute inset-0" />}
      {status === 'error' ? (
        // A broken/removed asset: a neutral muted box (with the alt text for AT) instead of
        // the browser's broken-image chrome.
        <span
          role="img"
          aria-label={alt || 'Image unavailable'}
          className="flex h-full w-full items-center justify-center bg-base-200 text-base-content/30 dark:bg-white/10 dark:text-white/40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-1/3 w-1/3" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16l5-5 4 4 3-3 6 6M3 5h18v14H3z" />
          </svg>
        </span>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={`h-full w-full object-cover transition-opacity duration-200 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </span>
  );
}
