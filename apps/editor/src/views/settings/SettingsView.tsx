import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ApiError, api, type Project, type SettingsBundle } from '../../api';
import { toForm, toBundle, type SettingsForm } from './model';
import { IdentitySection } from './IdentitySection';
import { WebsiteSection } from './WebsiteSection';
import { sectionVariants } from './motion';

type Section = 'identity' | 'website';
const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'identity', label: 'Corporate Identity' },
  { key: 'website', label: 'Website' },
];

function emptyBundle(project: Project): SettingsBundle {
  // The Project type carries no locale metadata, so a fresh project starts at `en`.
  return { identity: { name: project.name, colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } };
}

/**
 * The project Settings surface: a glassmorphic, animated editor for the unified
 * Corporate Identity (company + brand) and Website settings, over the existing
 * settings-singleton content API. `prefers-reduced-motion` is honored globally.
 */
/**
 * @param section When provided, the view renders ONLY that section and hides the internal
 *   segmented switcher — the project's top-level tabs (Corporate Identity / Website Settings)
 *   own the switching. Omitted, the legacy self-switching surface is shown.
 */
export function SettingsView({ project, section: fixedSection }: { project: Project; section?: Section }) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  // The last-loaded bundle — the baseline for fields the form doesn't surface
  // (logoLight/logoDark, spacing, radii, typography.scale) so a save never drops them.
  const [base, setBase] = useState<SettingsBundle | null>(null);
  const [internalSection, setSection] = useState<Section>('identity');
  // When the parent fixes the section (top-tab driven), use it and hide the switcher.
  const section = fixedSection ?? internalSection;
  const showSwitcher = fixedSection === undefined;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const tabRefs = useRef<Record<Section, HTMLButtonElement | null>>({ identity: null, website: null });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getSettings(project.id);
        if (active) {
          setBase(res.item);
          setForm(toForm(res.item));
        }
      } catch (err) {
        // No settings singleton yet → start from sensible defaults rather than erroring.
        if (err instanceof ApiError && err.status === 404) {
          if (active) {
            const fresh = emptyBundle(project);
            setBase(fresh);
            setForm(toForm(fresh));
          }
        } else if (active) {
          setLoadError(err instanceof Error ? err.message : 'failed to load settings');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [project.id]);

  // Auto-dismiss the "Saved" confirmation so it doesn't linger as a stale label.
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(id);
  }, [saved]);

  function patch(p: Partial<SettingsForm>) {
    setSaved(false);
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.putSettings(project.id, toBundle(form, base ?? undefined));
      setBase(res.item);
      setForm(toForm(res.item));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'failed to save settings');
    } finally {
      setSaving(false);
    }
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
  if (!form) return <p className="p-6 text-sm text-slate-400">Loading settings…</p>;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-hidden rounded-3xl">
        {/* Vivid gradient backdrop behind the frosted cards. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-indigo-100 via-sky-50 to-fuchsia-100" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 -z-10 h-72 w-72 rounded-full bg-fuchsia-300/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 -z-10 h-72 w-72 rounded-full bg-sky-300/30 blur-3xl" />

        <div className="p-5 sm:p-7">
          {/* Header: title + animated segmented switcher + save control. */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
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
                  className="relative rounded-xl px-4 py-1.5 text-sm font-medium text-slate-600 transition"
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
              // Section is fixed by the parent tab; keep the header layout (save control stays right).
              <div />
            )}

            <div className="flex items-center gap-3">
              <AnimatePresence>
                {saved && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    aria-label="Saved"
                    className="text-sm font-medium text-emerald-600"
                  >
                    ✓ Saved
                  </motion.span>
                )}
              </AnimatePresence>
              {saveError && <span className="text-sm text-red-600">{saveError}</span>}
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => void save()}
                disabled={saving}
                className="rounded-xl bg-gradient-to-br from-indigo-600 to-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save changes'}
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
              {section === 'identity' ? <IdentitySection form={form} patch={patch} /> : <WebsiteSection form={form} patch={patch} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
