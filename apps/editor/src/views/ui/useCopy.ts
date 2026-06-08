import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Writes `text` to the clipboard, resilient to INSECURE contexts. `navigator.clipboard` only exists
 * in a secure context (HTTPS or localhost); a self-hosted instance reached over plain HTTP on a LAN
 * (e.g. http://host:port) has `navigator.clipboard === undefined`, so the modern API throws. We try
 * the async API first and fall back to the legacy `document.execCommand('copy')` via an off-screen
 * textarea — the only clipboard path available without a secure context.
 */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path (e.g. permissions/transient failure).
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Keep it out of view and unable to scroll the page into a jump.
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy command was rejected');
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Copy-to-clipboard with a transient "copied" flag keyed by an id. The flag clears itself after a
 * short delay; the timer is cancelled on unmount AND before a rapid re-copy (so a second copy can't
 * orphan the first's reset timer). `onCopied` fires ONLY on a successful write — e.g. to raise a
 * toast. Shared by every copy surface (code rails, library) so the behaviour can't drift. Resilient
 * to insecure contexts via {@link writeClipboard} (HTTP/LAN self-hosting).
 */
export function useCopy(onCopied?: () => void): [string | null, (text: string, id: string) => void] {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopiedRef = useRef(onCopied);
  onCopiedRef.current = onCopied;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback((text: string, id: string) => {
    void writeClipboard(text)
      .then(() => {
        setCopiedId(id);
        onCopiedRef.current?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1400);
      })
      .catch(() => setCopiedId(null));
  }, []);
  return [copiedId, copy];
}
