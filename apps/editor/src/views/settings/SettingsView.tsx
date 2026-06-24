import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { History } from 'lucide-react';
import { ApiError, api, type Project, type SettingsBundle } from '../../api';
import { RevisionHistoryModal } from '../RevisionHistoryModal';
import { toForm, toBundle, type SettingsForm } from './model';
import { IdentitySection } from './IdentitySection';
import { WebsiteSection } from './WebsiteSection';
import { sectionVariants } from './motion';
import { SkeletonList } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { primaryButton } from '../../theme';

type Section = 'identity' | 'website';
const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'identity', label: 'Corporate Identity' },
  { key: 'website', label: 'Website' },
];

// The form fields owned by the WEBSITE section (website.* + the locale settings, which the Website
// page's LocaleManager edits). Everything else in the form belongs to Corporate Identity. Used to
// scope the dirty check + save + discard so the two sections' Save/Discard buttons are INDEPENDENT:
// editing one section never arms the other's buttons, and saving/discarding one leaves the other's
// pending edits intact.
const WEBSITE_FORM_KEYS = new Set<keyof SettingsForm>([
  'siteUrl', 'jsonDataUrl', 'data', 'criticalCss', 'head', 'scripts',
  'topNav', 'mobileNav', 'sidebarLeft', 'sidebarRight', 'footer', 'bottom', 'redirects',
  'navEffect', 'buttonEffect', 'buttonAccent', 'buttonShape', 'preloaderEffect',
  'navCode', 'buttonCode', 'preloaderCode',
  'enableThemes', 'defaultTheme', 'containerWidth',
  'shopEnabled', 'shopCurrencyPosition', 'shopCurrencyDecimals', 'shopChannels',
  'defaultLocale', 'locales', 'translations',
]);

const inSection = (key: string, section: Section): boolean =>
  WEBSITE_FORM_KEYS.has(key as keyof SettingsForm) === (section === 'website');

/** A stable JSON snapshot of ONLY the given section's form fields (for the per-section dirty check). */
function sectionSnapshot(form: SettingsForm, section: Section): string {
  return JSON.stringify(Object.fromEntries(Object.entries(form).filter(([k]) => inSection(k, section))));
}

/** `target` with the given section's fields replaced by `source`'s (the others untouched). */
function mergeSection(target: SettingsForm, source: SettingsForm, section: Section): SettingsForm {
  const slice = Object.fromEntries(Object.entries(source).filter(([k]) => inSection(k, section)));
  return { ...target, ...slice } as SettingsForm;
}

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

// Floating Discard: a SOLID white pill (never transparent in its active state — it overlays page
// content), with a shadow so it reads as a floating control. Disabled = faded + inert.
const floatingDiscard =
  'waves-effect inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-lg shadow-slate-900/10 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40';

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
  // (logoLight/logoDark, spacing, radii, typography.scale) so a save never drops them, and the
  // carry-through source for the section NOT being saved.
  const [base, setBase] = useState<SettingsBundle | null>(null);
  // The form snapshot the dirty check compares against. Reset wholesale on load, and PER-SECTION on
  // save/discard, so each section's dirty state is tracked independently. Rows carry transient ids
  // and toForm/toBundle normalize, so snapshotting the form (not the assembled bundle) is precise.
  const [baseline, setBaseline] = useState<SettingsForm | null>(null);
  const [internalSection, setSection] = useState<Section>('identity');
  // When the parent fixes the section (top-tab driven), use it and hide the switcher.
  const section = fixedSection ?? internalSection;
  const showSwitcher = fixedSection === undefined;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const tabRefs = useRef<Record<Section, HTMLButtonElement | null>>({ identity: null, website: null });
  const toast = useToast();

  // Hydrate the editable form from a bundle and reset the dirty baseline to it (initial load).
  const applyBundle = useCallback((bundle: SettingsBundle) => {
    const f = toForm(bundle);
    setBase(bundle);
    setForm(f);
    setBaseline(f);
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

  // Dirty for the ACTIVE section only — editing identity never arms the website buttons, or vice versa.
  const dirty = useMemo(
    () => form != null && baseline != null && sectionSnapshot(form, section) !== sectionSnapshot(baseline, section),
    [form, baseline, section],
  );

  function patch(p: Partial<SettingsForm>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  async function save() {
    if (!form || !base) return;
    setSaving(true);
    const snapshot = form; // the values being persisted (form may change during the await)
    try {
      const assembled = toBundle(form, base);
      // Persist ONLY the active section's slice; carry the OTHER section through from `base` so an
      // unsaved edit there stays pending (the two sections save independently).
      const bundle: SettingsBundle =
        section === 'identity'
          ? { identity: assembled.identity, settings: base.settings, ...(base.website ? { website: base.website } : {}) }
          : { identity: base.identity, settings: assembled.settings, ...(assembled.website ? { website: assembled.website } : {}) };
      const res = await api.putSettings(project.id, bundle);
      setBase(res.item);
      // Clear ONLY this section's dirty state; the other section's pending edits remain dirty.
      setBaseline((b) => (b ? mergeSection(b, snapshot, section) : toForm(res.item)));
      toast.show('Settings saved', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Revert ONLY the active section's fields to the baseline (the other section's edits are untouched).
  function discard() {
    if (!baseline) return;
    setForm((f) => (f ? mergeSection(f, baseline, section) : f));
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
        {showSwitcher && (
          // Legacy self-switching surface (the project's top tabs drive the fixed-section case).
          <div className="mb-4 flex">
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
          </div>
        )}

        <div className="relative">
          {/* Floating, sticky Save + Discard — NO wrapper. The zero-height sticky row overlays the
              first card's header (top-right) and aligns with its headline, while the section renders
              at full height underneath; only the buttons are interactive. It stays visible while
              scrolling. Both are enabled ONLY when the ACTIVE section has unsaved changes, and they
              act on that section alone. Outcomes are reported via toasts. */}
          <div className="pointer-events-none sticky top-20 z-10 flex h-0 justify-end">
            <div className="pointer-events-auto mt-9 flex items-center gap-2">
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => setHistoryOpen(true)}
                className={floatingDiscard}
                aria-label="Revision history"
              >
                <History className="h-4 w-4" aria-hidden />
                History
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={discard}
                disabled={!dirty || saving}
                className={floatingDiscard}
              >
                <DiscardIcon />
                Discard
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => void save()}
                disabled={!dirty || saving}
                className={`${primaryButton} shadow-lg disabled:pointer-events-none disabled:opacity-40`}
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
      </div>
      {historyOpen && (
        <RevisionHistoryModal
          projectId={project.id}
          kind="settings"
          entityId="settings"
          label="Project settings"
          onClose={() => setHistoryOpen(false)}
          onRestored={async () => {
            const res = await api.getSettings(project.id);
            applyBundle(res.item);
          }}
        />
      )}
    </MotionConfig>
  );
}
