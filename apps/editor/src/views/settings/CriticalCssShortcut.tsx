import { useCallback, useState } from 'react';
import { api } from '../../api';
import { CodeEditorModal } from '../ui/CodeEditorModal';
import { useToast } from '../ui/Toast';
import { shortcutLabel, useGlobalShortcut, type Shortcut } from '../../lib/use-global-shortcut';

/**
 * Opener for the project's Critical CSS.
 *
 * Ctrl/⌘+Alt+C is the requested binding. Kept to ONE chord, unlike the TailwindCSS Reference's pair:
 * that one needs an alternate because GNOME claims Ctrl+Alt+T for a terminal at the desktop level, so
 * the key never reaches the browser at all. Nothing claims Ctrl+Alt+C.
 */
export const CRITICAL_CSS_SHORTCUTS: Shortcut[] = [{ key: 'c', mod: true, alt: true }];

/** How the binding is written on the current platform — for tooltips/help text elsewhere. */
export const criticalCssShortcutLabel = (): string => shortcutLabel(CRITICAL_CSS_SHORTCUTS[0]!);

/**
 * The project-wide Critical CSS, one chord away from anywhere.
 *
 * It already lives in Settings → Website, but reaching it means leaving whatever you are doing:
 * critical CSS is written WHILE looking at the page it is fixing, and the page is behind a modal that
 * the settings modal cannot open over. So this mounts at the app root, opens ABOVE whatever is on
 * screen (`overOverlays` + `elevate`), and Escape unwinds it first, back to the editor you were in.
 *
 * TWO THINGS IT MUST NOT DO, both of which the shape below is chosen to prevent:
 *
 *  · SHOW AN EMPTY EDITOR WHILE LOADING. The draft it opens with is the baseline a save writes back,
 *    so a modal opened on `''` and saved before the fetch landed would erase the stylesheet. It is
 *    therefore not opened at all until the current value is in hand; a failed load opens nothing and
 *    says so.
 *  · REPLACE THE WHOLE SETTINGS ENTITY. This caller holds ONE field and never read the rest, so it
 *    writes through the MERGE endpoint. A full PUT from here would blank every setting it wasn't
 *    carrying — every other slot, the brand colours, the deploy targets.
 */
export function CriticalCssShortcut({ projectId }: { projectId?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [css, setCss] = useState('');

  const openEditor = useCallback(() => {
    if (!projectId || loading) return;
    setLoading(true);
    void api
      .getSettings(projectId)
      .then(({ item }) => {
        setCss(item.website?.criticalCss ?? '');
        setOpen(true);
      })
      .catch((err: unknown) => toast.show(err instanceof Error ? `Couldn’t open Critical CSS: ${err.message}` : 'Couldn’t open Critical CSS'))
      .finally(() => setLoading(false));
  }, [projectId, loading, toast]);

  useGlobalShortcut(CRITICAL_CSS_SHORTCUTS, openEditor, { enabled: !!projectId && !open, overOverlays: true });

  if (!open || !projectId) return null;
  return (
    <CodeEditorModal
      title="Critical CSS"
      hint="Project-wide CSS inlined in <head> after the brand tokens — applies to every page. Also in Settings → Website."
      language="css"
      value={css}
      elevate
      onClose={() => setOpen(false)}
      onSave={async (value) => {
        // The modal reports "Saved" purely on this RESOLVING, so a failure has to reject — otherwise
        // it says saved, marks the draft clean, and the author closes on top of lost work.
        await api.patchWebsiteSettings(projectId, { criticalCss: value });
        setCss(value);
      }}
    />
  );
}
