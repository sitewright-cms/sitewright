import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  NAV_EFFECTS,
  NAV_EFFECT_LABELS,
  BUTTON_EFFECT_LABELS,
  BUTTON_SHAPE_LABELS,
  PRELOADER_EFFECTS,
  type JsonValue,
  type NavEffect,
  type PreloaderEffect,
} from '@sitewright/schema';
import { newStr, shopLabelKeys, type Patch, type SettingsForm } from './model';
import { Field, GlassCard } from './ui';
import { SectionHelp } from '../ui/SectionHelp';
import { ButtonEffectsModal } from './ButtonEffectsModal';
import { Globe, Sparkles, Paintbrush, Code, Braces, PanelTop, PanelLeft, PanelRight, PanelBottom, ArrowDownToLine, Signpost, ShoppingCart, Languages, Pencil, MoonStar, MoveHorizontal, SlidersHorizontal } from 'lucide-react';
import { GLOBAL_SNIPPET_PARTIALS } from '@sitewright/core';
import { CodeField } from '../ui/CodeField';
import { CodeEditorModal } from '../ui/CodeEditorModal';
import { api, type EffectForks } from '../../api';
import { RedirectsEditor } from './RedirectsEditor';
import { ShopSettingsModal } from './ShopSettingsModal';
import { LocaleManager } from './LocaleManager';
import { TranslationsEditor } from './TranslationsEditor';
import { WebsiteDataModal } from './WebsiteDataModal';
import { ghostButton, glassInput, fieldLabel, toggleInput } from '../../theme';
import { cardStagger, cardVariants } from './motion';

/** "logo-pulse" → "Logo pulse" for the preloader picker option labels. */
const effectLabel = (s: string): string => {
  const t = s.replace(/-/g, ' ');
  return t[0]!.toUpperCase() + t.slice(1);
};

// The effect pickers list their options alphabetically by the label the user sees (the source-of-truth
// arrays keep their own curated order). Sorted once at module load, not per render.
const NAV_EFFECTS_SORTED = [...NAV_EFFECTS].sort((a, b) => NAV_EFFECT_LABELS[a].localeCompare(NAV_EFFECT_LABELS[b]));
const PRELOADER_EFFECTS_SORTED = [...PRELOADER_EFFECTS].sort((a, b) => effectLabel(a).localeCompare(effectLabel(b)));

/** Shared bindings hint for the validated skeleton-slot editors. */
const SLOT_HINT =
  'HTML + Tailwind/DaisyUI (no JS). The skeleton wraps this slot in its own landmark (main-nav/footer/…), so do NOT use <nav>/<main>/<footer>/<aside> here — use <div>. Bindings: {{ company.* }}, {{#each nav.header}}…{{/each}}, {{ website.json_data.* }}, {{ website.data.* }}.';

/** A one-line summary of the current `website.data` value for the "Edit data" row. */
function dataSummary(v: JsonValue): string {
  if (v == null) return 'empty';
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'empty';
  if (typeof v === 'object') {
    const n = Object.keys(v).length;
    return n ? `${n} key${n === 1 ? '' : 's'}` : 'empty';
  }
  return 'a value';
}

/** Content-width presets (value = the `--sw-container` value; '' = platform default 1200px). */
const CW_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Default (1200px)', value: '' },
  { label: 'Narrow (960px)', value: '960px' },
  { label: 'Wide (1440px)', value: '1440px' },
  { label: 'Full width', value: 'none' },
];

/** Website settings: production URL, injected CSS/HTML, redirects, and localization. */
export function WebsiteSection({
  form,
  patch,
  projectId,
  onLocalesChanged,
}: {
  form: SettingsForm;
  patch: Patch;
  projectId: string;
  /** Bubbles a language add/remove up so the pages list refreshes. */
  onLocalesChanged?: () => void;
}) {
  const [dataOpen, setDataOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  // The "fork existing effect" snippets (built-in effects as ready-to-run custom code) + which custom
  // effect's code editor is open. The forks are static platform data, fetched once.
  const [forks, setForks] = useState<EffectForks | null>(null);
  const [editing, setEditing] = useState<null | 'nav' | 'button' | 'preloader'>(null);
  const [btnModalOpen, setBtnModalOpen] = useState(false);
  useEffect(() => {
    let on = true;
    api.listEffectForks().then((f) => on && setForks(f)).catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  const slotCfg = {
    nav: {
      title: 'Custom nav effect code',
      code: form.navCode,
      set: (v: string) => patch({ navCode: v }),
      forks: forks?.nav ?? [],
      hint: 'Applied site-wide while Nav effect is “None / Custom Code”. Target the nav links (e.g. .menu a — the built-in schemes only style links inside a .menu) and use --sw-color-* tokens so it stays legible in dark mode. Fork a built-in effect for a working starting point.',
    },
    button: {
      title: 'Custom button effect code',
      code: form.buttonCode,
      set: (v: string) => patch({ buttonCode: v }),
      forks: forks?.button ?? [],
      hint: 'Applied site-wide while Button effect is “None / Custom Code”. Target buttons (.btn) and use --sw-color-* tokens for dark-mode safety.',
    },
    preloader: {
      title: 'Custom preloader code',
      code: form.preloaderCode,
      set: (v: string) => patch({ preloaderCode: v }),
      forks: forks?.preloader ?? [],
      hint: 'A full-screen overlay injected as the first body child while Preloader is “None / Custom Code”. Mark it data-sw-preloader and hide it once loaded — fork a preset for a complete, working example.',
    },
  };
  // The configured locales, default first (deduped) — for the locale manager.
  const localeCodes = Array.from(
    new Set([form.defaultLocale, ...form.locales.map((l) => l.value).filter(Boolean)]),
  );
  return (
    <motion.div variants={cardStagger} className="grid gap-4 sm:grid-cols-2">
      <GlassCard title="Site" icon={<Globe className="h-4 w-4" />} wide>
        <Field
          label="Production URL (for sitemap.xml + robots.txt)"
          value={form.siteUrl}
          onChange={(v) => patch({ siteUrl: v })}
          type="url"
          placeholder="https://acme.com"
        />
        <div className="mt-3">
          <Field
            label="JSON data URL → {{ website.json_data }} (fetched at publish)"
            value={form.jsonDataUrl}
            onChange={(v) => patch({ jsonDataUrl: v })}
            type="url"
            placeholder="https://api.example.com/data.json"
          />
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
            Site data → {'{{ website.data }}'} (edited here, in preview + publish)
          </label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setDataOpen(true)} className={ghostButton}>
              Edit data
            </button>
            <span className="text-xs text-slate-400">{dataSummary(form.data)}</span>
          </div>
        </div>
      </GlassCard>

      {dataOpen && (
        <WebsiteDataModal
          value={form.data}
          onSave={(data) => patch({ data })}
          onClose={() => setDataOpen(false)}
        />
      )}

      <GlassCard
        title="Nav, Buttons & Preloader Effects"
        icon={<Sparkles className="h-4 w-4" />}
        tooltip="CI-themed, contrast-safe nav/button hover-active schemes + a page preloader overlay (shown on load and during navigation), applied site-wide (no code). The current nav item is highlighted where you mark it .active. Want your own look? Pick “None / Custom Code” and click Edit to write it (or fork a built-in effect as a starting point)."
        wide
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col">
            <span className={fieldLabel}>Nav effect</span>
            <div className="flex items-center gap-2">
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
              {form.navEffect === 'none' && (
                <button
                  type="button"
                  onClick={() => setEditing('nav')}
                  className={`${ghostButton} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
                  title="Edit the custom nav effect code"
                >
                  <Code className="h-3.5 w-3.5" /> {form.navCode.trim() ? 'Edit code' : 'Add code'}
                </button>
              )}
            </div>
          </label>
          <div className="flex flex-col">
            <span className={fieldLabel}>Buttons</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBtnModalOpen(true)}
                className={`${glassInput} flex min-w-0 flex-1 items-center justify-between gap-2 text-left`}
                title="Configure button effect, hover accent + shape with a live preview"
              >
                <span className="truncate">
                  {form.buttonEffect === 'none' ? 'Baseline' : BUTTON_EFFECT_LABELS[form.buttonEffect]}
                  {' · '}
                  {(form.buttonAccent || 'secondary')[0]!.toUpperCase() + (form.buttonAccent || 'secondary').slice(1)}
                  {' accent · '}
                  {BUTTON_SHAPE_LABELS[form.buttonShape || 'rounded']}
                </span>
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </button>
              {form.buttonEffect === 'none' && (
                <button
                  type="button"
                  onClick={() => setEditing('button')}
                  className={`${ghostButton} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
                  title="Edit the custom button effect code"
                >
                  <Code className="h-3.5 w-3.5" /> {form.buttonCode.trim() ? 'Edit code' : 'Add code'}
                </button>
              )}
            </div>
          </div>
          <label className="flex flex-col">
            <span className={fieldLabel}>Preloader</span>
            <div className="flex items-center gap-2">
              <select
                aria-label="Preloader effect"
                className={`${glassInput} min-w-0 flex-1`}
                value={form.preloaderEffect || 'none'}
                onChange={(e) =>
                  patch({ preloaderEffect: e.target.value === 'none' ? 'none' : (e.target.value as PreloaderEffect) })
                }
              >
                <option value="none">None / Custom Code</option>
                {PRELOADER_EFFECTS_SORTED.map((p) => (
                  <option key={p} value={p}>
                    {effectLabel(p)}
                  </option>
                ))}
              </select>
              {form.preloaderEffect === 'none' && (
                <button
                  type="button"
                  onClick={() => setEditing('preloader')}
                  className={`${ghostButton} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap`}
                  title="Edit the custom preloader code"
                >
                  <Code className="h-3.5 w-3.5" /> {form.preloaderCode.trim() ? 'Edit code' : 'Add code'}
                </button>
              )}
            </div>
          </label>
        </div>
        <label className="mt-4 flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className={fieldLabel}>Back-to-top button</span>
            <span className="block text-[11px] text-slate-400">
              Shows a chevron-up button after the first screen of scrolling that scrolls back to the top.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable back-to-top button"
            className={toggleInput}
            checked={form.backToTop}
            onChange={(e) => patch({ backToTop: e.target.checked })}
          />
        </label>
      </GlassCard>

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
          onApply={(v) =>
            patch({ buttonEffect: v.buttonEffect, buttonAccent: v.buttonAccent, buttonShape: v.buttonShape })
          }
          onClose={() => setBtnModalOpen(false)}
        />
      )}

      <GlassCard
        title="Themes (light / dark)"
        icon={<MoonStar className="h-4 w-4" />}
        tooltip="Opt-in light + dark themes for the published site. When on, the platform adds a dark variant of your theme; pick whether visitors start on light, dark, or follow their device (auto). Add a {{sw-theme-toggle}} to your nav to let visitors switch. For best results use theme color classes (bg-base-100, text-base-content, text-primary) rather than fixed colors so your content adapts automatically."
        wide
      >
        {/* Master switch. OFF (default) = single-theme site, byte-identical output; gates the
            {{sw-theme-toggle}} helper (renders nothing) + the reserved theme_toggle ghost row. */}
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className={fieldLabel}>Enable themes</span>
            <span className="block text-[11px] text-slate-400">
              Adds a dark variant of your theme. When off, the site stays single-theme.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable themes"
            className={toggleInput}
            checked={form.enableThemes}
            onChange={(e) => patch({ enableThemes: e.target.checked })}
          />
        </label>
        {form.enableThemes && (
          <label className="mt-3 flex flex-col">
            <span className={fieldLabel}>Default theme</span>
            <select
              aria-label="Default theme"
              className={glassInput}
              value={form.defaultTheme}
              onChange={(e) => patch({ defaultTheme: e.target.value as 'auto' | 'light' | 'dark' })}
            >
              <option value="auto">Auto — follow the visitor’s device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <span className="mt-1 block text-[11px] text-slate-400">
              The starting theme. A <code>{'{{sw-theme-toggle}}'}</code> in your nav lets visitors override it.
            </span>
          </label>
        )}
      </GlassCard>

      <GlassCard
        title="Content width"
        icon={<MoveHorizontal className="h-4 w-4" />}
        tooltip="The max-width of the main content area, applied site-wide so every section's content aligns to one width. Pick a preset or a custom pixel width; Full width removes the cap (edge-to-edge). Full-bleed section backgrounds still span the viewport."
        wide
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col">
            <span className={fieldLabel}>Width</span>
            <select
              aria-label="Content width"
              className={glassInput}
              value={CW_PRESETS.some((o) => o.value === form.containerWidth) ? form.containerWidth : 'custom'}
              onChange={(e) => patch({ containerWidth: e.target.value === 'custom' ? '1080px' : e.target.value })}
            >
              {CW_PRESETS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {!CW_PRESETS.some((o) => o.value === form.containerWidth) && (
            <label className="flex flex-col">
              <span className={fieldLabel}>Custom (px)</span>
              <input
                type="number"
                min={320}
                max={2560}
                aria-label="Custom content width in pixels"
                className={glassInput}
                value={parseInt(form.containerWidth, 10) || ''}
                onChange={(e) => patch({ containerWidth: e.target.value ? `${e.target.value}px` : '' })}
              />
            </label>
          )}
        </div>
        <span className="mt-2 block text-[11px] text-slate-400">
          Sets the content container width used by every section, so the whole site aligns to one width.
        </span>
      </GlassCard>

      <GlassCard title="Critical CSS" icon={<Paintbrush className="h-4 w-4" />} wide>
        <CodeField
          label="Project-wide CSS inlined in <head> (after brand tokens)"
          title="Critical CSS"
          language="css"
          value={form.criticalCss}
          onChange={(v) => patch({ criticalCss: v })}
          placeholder=".hero { ... }"
        />
      </GlassCard>

      <GlassCard title="Head HTML" icon={<Code className="h-4 w-4" />}>
        <CodeField
          label="Raw HTML injected into <head> (analytics, meta)"
          title="Head HTML"
          value={form.head}
          onChange={(v) => patch({ head: v })}
          placeholder="<meta ... />"
        />
      </GlassCard>

      <GlassCard title="Scripts" icon={<Braces className="h-4 w-4" />}>
        <CodeField
          label="Raw HTML injected after the page body (3rd-party scripts/widgets)"
          title="Scripts"
          value={form.scripts}
          onChange={(v) => patch({ scripts: v })}
          placeholder="<script ... ></script>"
        />
      </GlassCard>

      <motion.div variants={cardVariants} className="sm:col-span-2 mt-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
          Skeleton slots — shared Handlebars partials rendered around every page
          <SectionHelp tip="Validated (no JS): HTML + Tailwind/DaisyUI + {{ company.* }}, {{#each nav.header}}, {{ website.json_data.* }}, {{ website.data.* }}." />
        </h3>
      </motion.div>

      <GlassCard title="Main Navigation" icon={<PanelTop className="h-4 w-4" />}>
        <CodeField
          label="mainNav — desktop bar + mobile drawer, on every page"
          title="Main Navigation"
          hint={SLOT_HINT}
          value={form.mainNav}
          onChange={(v) => patch({ mainNav: v })}
          starter={{ label: 'Insert the default navigation', code: GLOBAL_SNIPPET_PARTIALS['nav-header'] ?? '' }}
          placeholder={'<div class="navbar">{{ company.name }}</div>'}
        />
      </GlassCard>

      <GlassCard title="Left sidebar" icon={<PanelLeft className="h-4 w-4" />}>
        <CodeField
          label="sidebarLeft — after the page body (position via classes)"
          title="sidebarLeft partial"
          hint={SLOT_HINT}
          value={form.sidebarLeft}
          onChange={(v) => patch({ sidebarLeft: v })}
          placeholder={'<div class="menu">…</div>'}
        />
      </GlassCard>

      <GlassCard title="Right sidebar" icon={<PanelRight className="h-4 w-4" />}>
        <CodeField
          label="sidebarRight — after the page body (position via classes)"
          title="sidebarRight partial"
          hint={SLOT_HINT}
          value={form.sidebarRight}
          onChange={(v) => patch({ sidebarRight: v })}
          placeholder={'<div class="menu">…</div>'}
        />
      </GlassCard>

      <GlassCard title="Footer" icon={<PanelBottom className="h-4 w-4" />}>
        <CodeField
          label="footer — below body + sidebars"
          title="footer partial"
          hint={SLOT_HINT}
          value={form.footer}
          onChange={(v) => patch({ footer: v })}
          starter={{ label: 'Insert the default footer', code: GLOBAL_SNIPPET_PARTIALS['nav-footer'] ?? '' }}
          placeholder={'<div class="footer">© {{ company.name }}</div>'}
        />
      </GlassCard>

      <GlassCard title="Bottom" icon={<ArrowDownToLine className="h-4 w-4" />}>
        <CodeField
          label="bottom — after the footer (global modals, schema.org microdata)"
          title="bottom partial"
          hint={SLOT_HINT}
          value={form.bottom}
          onChange={(v) => patch({ bottom: v })}
          placeholder={'<div class="modal">…</div>'}
        />
      </GlassCard>

      <GlassCard
        title="Redirects"
        icon={<Signpost className="h-4 w-4" />}
        tooltip="Emitted to .htaccess + _redirects on publish."
        wide
      >
        <RedirectsEditor rows={form.redirects} onChange={(redirects) => patch({ redirects })} />
      </GlassCard>

      <GlassCard
        title="Shop"
        icon={<ShoppingCart className="h-4 w-4" />}
        tooltip="A front-end cart for static sites: drop {{sw-cart}} + {{sw-add-to-cart …}} in a page (or use the global:shop template). This card holds the shop's structure; its wording (cart labels, currency, channel/field labels) is translatable — edit it in Translations & Labels. Prices are non-authoritative — the cart sends an order inquiry; you confirm availability and collect payment."
        wide
      >
        {/* Master switch. OFF (default) collapses the whole section — no settings, no Edit — and gates the
            cart helpers (they render nothing) + the translation table's reserved cart-string ghost rows. */}
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className={fieldLabel}>Enable shop</span>
            <span className="block text-[11px] text-slate-400">
              A front-end cart for static sites. When off, <code>{'{{sw-cart}}'}</code> /{' '}
              <code>{'{{sw-add-to-cart}}'}</code> render nothing.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable shop"
            className={toggleInput}
            checked={form.shopEnabled}
            onChange={(e) => patch({ shopEnabled: e.target.checked })}
          />
        </label>
        {form.shopEnabled && (
          <div className="mt-3">
            <button
              type="button"
              aria-label="Edit shop settings"
              onClick={() => setShopOpen(true)}
              className="waves-effect group flex w-full items-center justify-between gap-3 rounded-xl border border-white/60 bg-white/50 px-3 py-2.5 text-left shadow-sm backdrop-blur-xl transition hover:border-indigo-400 hover:bg-white hover:shadow-md"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-700">Shop settings</span>
                <span className="block text-[11px] text-slate-400">Currency, labels, checkout channels</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition group-hover:border-indigo-400 group-hover:text-indigo-600">
                <Pencil className="h-4 w-4" /> Edit
              </span>
            </button>
          </div>
        )}
        {shopOpen && <ShopSettingsModal form={form} patch={patch} onClose={() => setShopOpen(false)} />}
      </GlassCard>

      <GlassCard title="Localization" icon={<Languages className="h-4 w-4" />} wide>
        <LocaleManager
          projectId={projectId}
          locales={localeCodes}
          defaultLocale={form.defaultLocale}
          onChange={(next) => patch({ locales: next.map((value) => ({ ...newStr(), value })) })}
          onLocalesChanged={onLocalesChanged}
        />
      </GlassCard>

      <div id="translations-labels" className="scroll-mt-20 sm:col-span-2">
        <GlassCard
          title="Translations & Labels"
          icon={<Languages className="h-4 w-4" />}
          tooltip="Shared phrases + UI labels ({{sw-translate}} / data-sw-translate), one row per key and a column per locale. Scoped keys (home.*, shop.*) group into collapsible sections. Inline preview edits land here too."
        >
          <TranslationsEditor
            rows={form.translations}
            localeCodes={localeCodes}
            defaultLocale={form.defaultLocale}
            shopEnabled={form.shopEnabled}
            themesEnabled={form.enableThemes}
            // Auto-surface a ghost row per configured channel/field label (shop.<key>) so the operator fills
            // the wording here instead of hand-typing the keys — only while the shop is on.
            extraGhostGroups={
              form.shopEnabled ? [{ id: 'shop_labels', label: 'Shop · Channels & fields', keys: shopLabelKeys(form.shopChannels) }] : []
            }
            onChange={(translations) => patch({ translations })}
          />
        </GlassCard>
      </div>
    </motion.div>
  );
}
