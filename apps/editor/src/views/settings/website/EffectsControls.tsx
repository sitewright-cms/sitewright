import { useState } from 'react';
import {
  NAV_EFFECTS,
  NAV_EFFECT_LABELS,
  BUTTON_EFFECT_LABELS,
  BUTTON_SHAPE_LABELS,
  PRELOADER_EFFECTS,
  STICKY_HEADER_MODES,
  STICKY_HEADER_LABELS,
  type NavEffect,
  type PreloaderEffect,
  type StickyHeaderMode,
} from '@sitewright/schema';
import { Code, SlidersHorizontal } from 'lucide-react';
import type { EffectForks } from '../../../api';
import type { Patch, SettingsForm } from '../model';
import { ButtonEffectsModal } from '../ButtonEffectsModal';
import { CodeEditorModal } from '../../ui/CodeEditorModal';
import { SectionHelp } from '../../ui/SectionHelp';
import { ghostButton, glassInput, toggleInput } from '../../../theme';
import { Labelled } from '../ui';
import { effectLabel } from '../board/summaries';

// The effect pickers list their options alphabetically by the label the user sees (the source-of-truth
// arrays keep their own curated order). Sorted once at module load, not per render.
const NAV_EFFECTS_SORTED = [...NAV_EFFECTS].sort((a, b) => NAV_EFFECT_LABELS[a].localeCompare(NAV_EFFECT_LABELS[b]));
const PRELOADER_EFFECTS_SORTED = [...PRELOADER_EFFECTS].sort((a, b) => effectLabel(a).localeCompare(effectLabel(b)));

export const EFFECTS_HELP =
  'CI-themed, contrast-safe nav/button hover-active schemes + a page preloader overlay (shown on load and during navigation), applied site-wide (no code). The current nav item is highlighted where you mark it .active. Want your own look? Pick “None / Custom Code” and click Add code to write it (or fork a built-in effect as a starting point).';

const STICKY_HELP =
  'Fix the top navigation to the viewport so it stays visible as the page scrolls. Content clears the bar automatically — add sw-top-padding only to move that offset onto an inner element, so a full-bleed hero bleeds under the header. It is defeated by any padding class or inline padding on the same element, so give that element px-4 pb-4 rather than p-4. A custom header must set its real height — --sw-header-h — in Custom CSS at every breakpoint.';
const BACK_TO_TOP_HELP = 'Shows a chevron-up button after the first screen of scrolling that scrolls back to the top.';
const SCROLLSPY_HELP =
  'Highlights the main & mobile nav link whose in-page section (a link to #about → a <section id="about">) is scrolled into view. Best for one-page / landing layouts — on the page that holds the sections it takes over the nav’s active state; pages without in-page sections keep normal link highlighting. For a custom on-page nav, add the data-sw-scrollspy attribute instead.';
const BACKDROP_HELP =
  'Only for CUSTOM preloader code — the built-in preloaders always carry one. Fills the screen with the page background so nothing shows through while loading. Leave it off if your overlay draws its own (or is meant to be see-through).';

/** A switch row: label + "?" on the left, the switch on the right. */
function SwitchRow({ label, help, ariaLabel, checked, disabled, onChange }: { label: string; help: string; ariaLabel: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`flex min-w-0 items-center gap-1.5 text-sm ${disabled ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
        <span className="truncate pr-0.5">{label}</span>
        <SectionHelp tip={help} />
      </span>
      <input type="checkbox" role="switch" aria-label={ariaLabel} className={`${toggleInput} shrink-0`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

/**
 * The motion vocabulary, edited ON its tile — nav hover schemes, the button effect/accent/shape, the
 * preloader, the sticky header, back-to-top and scrollspy. Every control the old card held, with the same
 * names; the long explanations moved into "?" tooltips so the tile stays compact. Custom effect code still
 * saves in its own editor's gesture (`saveNow`).
 */
export function EffectsControls({
  form,
  patch,
  saveNow,
  forks,
}: {
  form: SettingsForm;
  patch: Patch;
  saveNow: (p: Partial<SettingsForm>) => void | Promise<void>;
  forks: EffectForks | null;
}) {
  const [editing, setEditing] = useState<null | 'nav' | 'button' | 'preloader'>(null);
  const [btnModalOpen, setBtnModalOpen] = useState(false);
  const slotCfg = {
    nav: {
      title: 'Custom nav effect code',
      code: form.navCode,
      set: (v: string) => saveNow({ navCode: v }),
      forks: forks?.nav ?? [],
      hint: 'Applied site-wide while Nav effect is “None / Custom Code”. Target the nav links (e.g. .menu a — the built-in schemes only style links inside a .menu) and use --sw-color-* tokens so it stays legible in dark mode. Fork a built-in effect for a working starting point.',
    },
    button: {
      title: 'Custom button effect code',
      code: form.buttonCode,
      set: (v: string) => saveNow({ buttonCode: v }),
      forks: forks?.button ?? [],
      hint: 'Applied site-wide while Button effect is “None / Custom Code”. Target buttons (.btn) and use --sw-color-* tokens for dark-mode safety.',
    },
    preloader: {
      title: 'Custom preloader code',
      code: form.preloaderCode,
      set: (v: string) => saveNow({ preloaderCode: v }),
      forks: forks?.preloader ?? [],
      hint: 'A full-screen overlay injected as the first body child while Preloader is “None / Custom Code”. Mark it data-sw-preloader and hide it once loaded — fork a preset for a complete, working example.',
    },
  };

  const codeButton = (which: 'nav' | 'button' | 'preloader', code: string, tip: string) => (
    <button
      type="button"
      title={tip}
      onClick={() => setEditing(which)}
      className={`${ghostButton} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5`}
    >
      <Code className="h-3.5 w-3.5" /> {code.trim() ? 'Edit code' : 'Add code'}
    </button>
  );
  // The backdrop only means something once there IS custom preloader code — shown always (so the tile's
  // height does not jump), but disabled until then.
  const backdropApplies = form.preloaderEffect === 'none' && form.preloaderCode.trim() !== '';

  return (
    <>
      <Labelled label="Nav effect">
        <span className="flex items-center gap-2">
          <select
            aria-label="Nav effect"
            className={`${glassInput} min-w-0 flex-1`}
            value={form.navEffect || 'none'}
            onChange={(e) => patch({ navEffect: e.target.value === 'none' ? 'none' : (e.target.value as NavEffect) })}
          >
            <option value="none">None / Custom Code</option>
            {NAV_EFFECTS_SORTED.map((n) => (
              <option key={n} value={n}>
                {NAV_EFFECT_LABELS[n]}
              </option>
            ))}
          </select>
          {form.navEffect === 'none' && codeButton('nav', form.navCode, 'Edit the custom nav effect code')}
        </span>
      </Labelled>
      <Labelled label="Buttons">
        <span className="flex items-center gap-2">
          <button
            type="button"
            title="Configure button effect, hover accent + shape with a live preview"
            onClick={() => setBtnModalOpen(true)}
            className={`${glassInput} flex min-w-0 flex-1 items-center justify-between gap-2 text-left`}
          >
            <span className="truncate pr-0.5">
              {form.buttonEffect === 'none' ? 'Baseline' : BUTTON_EFFECT_LABELS[form.buttonEffect]}
              {' · '}
              {(form.buttonAccent || 'secondary')[0]!.toUpperCase() + (form.buttonAccent || 'secondary').slice(1)}
              {' accent · '}
              {BUTTON_SHAPE_LABELS[form.buttonShape || 'rounded']}
            </span>
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
          {form.buttonEffect === 'none' && codeButton('button', form.buttonCode, 'Edit the custom button effect code')}
        </span>
      </Labelled>
      <Labelled label="Preloader">
        <span className="flex items-center gap-2">
          <select
            aria-label="Preloader effect"
            className={`${glassInput} min-w-0 flex-1`}
            value={form.preloaderEffect || 'none'}
            onChange={(e) => patch({ preloaderEffect: e.target.value === 'none' ? 'none' : (e.target.value as PreloaderEffect) })}
          >
            <option value="none">None / Custom Code</option>
            {PRELOADER_EFFECTS_SORTED.map((p) => (
              <option key={p} value={p}>
                {effectLabel(p)}
              </option>
            ))}
          </select>
          {form.preloaderEffect === 'none' && codeButton('preloader', form.preloaderCode, 'Edit the custom preloader code')}
        </span>
      </Labelled>
      <Labelled label="Sticky header" tip={STICKY_HELP}>
        <select
          aria-label="Sticky header mode"
          className={`${glassInput} min-w-0`}
          value={form.stickyHeader}
          onChange={(e) => patch({ stickyHeader: e.target.value === 'none' ? 'none' : (e.target.value as StickyHeaderMode) })}
        >
          <option value="none">Off — static header</option>
          {STICKY_HEADER_MODES.map((m) => (
            <option key={m} value={m}>
              {STICKY_HEADER_LABELS[m]}
            </option>
          ))}
        </select>
      </Labelled>
      <span className="flex flex-col gap-2.5 pt-1">
        <SwitchRow label="Back-to-top button" help={BACK_TO_TOP_HELP} ariaLabel="Enable back-to-top button" checked={form.backToTop} onChange={(backToTop) => patch({ backToTop })} />
        <SwitchRow label="ScrollSpy" help={SCROLLSPY_HELP} ariaLabel="Enable scrollspy" checked={form.scrollSpy} onChange={(scrollSpy) => patch({ scrollSpy })} />
        <SwitchRow
          label="Preloader backdrop"
          help={BACKDROP_HELP}
          ariaLabel="Solid backdrop behind the custom preloader"
          checked={form.preloaderBackdrop}
          disabled={!backdropApplies}
          onChange={(preloaderBackdrop) => patch({ preloaderBackdrop })}
        />
      </span>

      {editing && (
        <CodeEditorModal
          title={slotCfg[editing].title}
          value={slotCfg[editing].code}
          language="html"
          hint={slotCfg[editing].hint}
          fork={
            slotCfg[editing].forks.length
              ? {
                  // alphabetical by label, like the effect pickers (None / source order aside).
                  options: slotCfg[editing].forks
                    .map((f) => ({ value: f.name, label: f.label }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
                  snippetFor: (v) => slotCfg[editing].forks.find((f) => f.name === v)?.code ?? '',
                }
              : undefined
          }
          onSave={(v) => slotCfg[editing].set(v)}
          onClose={() => setEditing(null)}
        />
      )}
      {btnModalOpen && (
        <ButtonEffectsModal
          form={form}
          onApply={(v) => patch({ buttonEffect: v.buttonEffect, buttonAccent: v.buttonAccent, buttonShape: v.buttonShape })}
          onClose={() => setBtnModalOpen(false)}
        />
      )}
    </>
  );
}
