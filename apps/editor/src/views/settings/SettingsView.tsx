import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ApiError, api, type Project, type SettingsBundle } from '../../api';
import { toForm, toBundle, type SettingsForm } from './model';
import { IdentitySection } from './IdentitySection';
import { WebsiteSection } from './WebsiteSection';
import { sectionVariants } from './motion';
import { SkeletonList } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { primaryButton, ghostButton } from '../../theme';

type Section = 'identity' | 'website';
const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'identity', label: 'Corporate Identity' },
  { key: 'website', label: 'Website' },
];

function emptyBundle(project: Project): SettingsBundle {
  // The Project type carries no locale metadata, so a fresh project starts at `en`.
  return { identity: { name: project.name, colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } };
}

/** Floppy-disk save glyph (stroke, 24-grid) — matches the editor's inline-SVG icon convention. */
function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

/** Counter-clockwise arrow — the "revert to the last saved state" (discard) affordance. */
function DiscardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/**
 * The project Settings surface: a glassmorphic, animated editor for the unified
 * Corporate Identity (company + brand) and Website settings, over the existing
 * settings-singleton content API. `prefers-reduced-motion` is honored globally.
 *
 * @param section When provided, the view renders ONLY that section and hides the internal
 *   segmented switcher — the project's top-level tabs (Corporate Identity / Website Settings)
 *   own the switching. Omitted, the legacy self-switching surface is shown.
 */
export function SettingsView({
  project,
  section: fixedSection,
  onLocalesChanged,
}: {
  project: Project;
  section?: Section;
  /** Notifies the parent (the pages list) when a language is added/removed here, so it can refresh. */
  onLocalesChanged?: () => void;
}) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  // The last-loaded bundle — the baseline for fields the form doesn't surface
  // (logoLight/logoDark, spacing, radii, typography.scale) so a save never drops them.
  const [base, setBase] = useState<SettingsBundle | null>(null);
  const [internalSection, setSection] = useState<Section>('identity');
  // When the parent fixes the section (top-tab driven), use it and hide the switcher.
  const section = fixedSection ?? internalSection;
  const showSwitcher = fixedSection === undefined;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A JSON snapshot of the form as last loaded/saved — the exact baseline for the dirty check. Rows
  // carry transient ids and toForm/toBundle normalize (e.g. fill mandatory color defaults), so
  // comparing assembled bundles would false-positive; snapshotting the form itself is precise.
  const [baselineJson, setBaselineJson] = useState('');
  const tabRefs = useRef<Record<Section, HTMLButtonElement | null>>({ identity: null, website: null });
  const toast = useToast();

  // Hydrate the editable form from a bundle and reset the dirty baseline to it (load / save / discard).
  const applyBundle = useCallback((bundle: SettingsBundle) => {
    const f = toForm(bundle);
    setBase(bundle);
    setForm(f);
    setBaselineJson(JSON.stringify(f));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getSettings(project.id);
        if (active) applyBundle(res.item);
      } catch (err) {
        // No settings singleton yet → start from sensible defaults rather than erroring.
        if (err instanceof ApiError && err.status === 404) {
          if (active) applyBundle(emptyBundle(project));
        } else if (active) {
          setLoadError(err instanceof Error ? err.message : 'failed to load settings');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [project.id, applyBundle]);

  // True whenever the form diverges from the last loaded/saved snapshot — gates Save + Discard.
  const dirty = useMemo(() => form != null && JSON.stringify(form) !== baselineJson, [form, baselineJson]);

  function patch(p: Partial<SettingsForm>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const res = await api.putSettings(project.id, toBundle(form, base ?? undefined));
      applyBundle(res.item);
      toast.show('Settings saved', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Revert every field to the last loaded/saved baseline, dropping all unsaved edits.
  function discard() {
    if (!base) return;
    applyBundle(base);
    toast.show('Changes discarded', 'info');
  }

  // APG tab pattern: arrow keys move between tabs and focus the target.
  function onTabKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = SECTIONS[(i + (e.key === 'ArrowRight' ? 1 : SECTIONS.length - 1)) % SECTIONS.length]!.key;
    setSection(next);
    // eslint-disable-next-line security/detect-object-injection -- next is a typed Section literal
    tabRefs.current[next]?.focus();
  }

  if (loadError) return <p className="p-6 text-sm text-red-600">{loadError}</p>;
  if (!form) return <SkeletonList rows={5} className="max-w-2xl" label="Loading settings…" />;

  return (
    <MotionConfig reducedMotion="user">
      {/* No own chrome/background or extra padding: the cards sit flush on the page
          surface that `<main>` already pads — settings match the other tabs. */}
      <div>
        {/* Header toolbar: the segmented switcher (legacy mode) + the Save/Discard group. Made
            `sticky` so it pins just under the app header and the two actions stay reachable while
            scrolling a long settings page. z-10 keeps it above the cards but below the app header
            (z-20) and the portalled pickers/modals. */}
        <div className="sticky top-14 z-10 mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/50 bg-white/70 px-4 py-2.5 shadow-sm backdrop-blur-xl">
          {showSwitcher ? (
            <div role="tablist" aria-label="Settings sections" className="flex items-center gap-2 rounded-2xl border border-white/50 bg-white/50 p-1 shadow-sm backdrop-blur-xl">
              {SECTIONS.map((s, i) => (
                <button
                  key={s.key}
                  ref={(el) => {
                    tabRefs.current[s.key] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${s.key}`}
                  aria-selected={section === s.key}
                  aria-controls={`settings-panel-${s.key}`}
                  tabIndex={section === s.key ? 0 : -1}
                  onClick={() => setSection(s.key)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className="waves-effect relative rounded-xl px-4 py-1.5 text-sm font-medium text-slate-600 transition"
                >
                  {section === s.key && (
                    <motion.span
                      layoutId="settings-seg"
                      className="absolute inset-0 -z-10 rounded-xl bg-white shadow-md shadow-slate-900/5"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className={section === s.key ? 'text-slate-900' : ''}>{s.label}</span>
                </button>
              ))}
            </div>
          ) : (
            // Section is fixed by the parent tab; keep the layout so the action group stays right.
            <div />
          )}

          {/* The permanently-visible Save + Discard group — both enabled ONLY while unsaved changes
              exist. Save/discard outcomes are reported via toasts (not inline text). */}
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={discard}
              disabled={!dirty || saving}
              className={`${ghostButton} disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/50`}
            >
              <DiscardIcon />
              Discard
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => void save()}
              disabled={!dirty || saving}
              className={`${primaryButton} disabled:pointer-events-none disabled:cursor-not-allowed`}
            >
              <SaveIcon />
              {saving ? 'Saving…' : 'Save'}
            </motion.button>
          </div>
        </div>

        {/* Active section — fades/slides, cards cascade in via stagger. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            role="tabpanel"
            id={`settings-panel-${section}`}
            aria-labelledby={`settings-tab-${section}`}
            tabIndex={0}
            variants={sectionVariants}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {section === 'identity' ? (
              <IdentitySection form={form} patch={patch} projectId={project.id} />
            ) : (
              <WebsiteSection form={form} patch={patch} projectId={project.id} onLocalesChanged={onLocalesChanged} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
