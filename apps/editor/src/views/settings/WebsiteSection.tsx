import { useState } from 'react';
import { motion } from 'motion/react';
import { NAV_EFFECTS, BUTTON_EFFECTS, type JsonValue, type NavEffect, type ButtonEffect } from '@sitewright/schema';
import { newStr, shopLabelKeys, type Patch, type SettingsForm } from './model';
import { Field, GlassCard } from './ui';
import { SectionHelp } from '../ui/SectionHelp';
import { Globe, Sparkles, Paintbrush, Code, Braces, PanelTop, Smartphone, PanelLeft, PanelRight, PanelBottom, ArrowDownToLine, Signpost, ShoppingCart, Languages, Pencil } from 'lucide-react';
import { CodeField } from '../ui/CodeField';
import { RedirectsEditor } from './RedirectsEditor';
import { ShopSettingsModal } from './ShopSettingsModal';
import { LocaleManager } from './LocaleManager';
import { TranslationsEditor } from './TranslationsEditor';
import { WebsiteDataModal } from './WebsiteDataModal';
import { ghostButton, glassInput, fieldLabel, toggleInput } from '../../theme';
import { cardStagger, cardVariants } from './motion';

/** Shared bindings hint for the validated skeleton-slot editors. */
const SLOT_HINT =
  'HTML + Tailwind/DaisyUI (no JS). The skeleton wraps this slot in its own landmark (top-nav/footer/…), so do NOT use <nav>/<main>/<footer>/<aside> here — use <div>. Bindings: {{ company.* }}, {{#each nav.header}}…{{/each}}, {{ website.json_data.* }}, {{ website.data.* }}.';

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
        title="Nav & button effects"
        icon={<Sparkles className="h-4 w-4" />}
        tooltip="CI-themed, contrast-safe hover/active schemes, applied site-wide (no code). The current nav item is highlighted where you mark it .active. Want your own? Leave these “None” and write it in Critical CSS (target .active / .btn)."
        wide
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col">
            <span className={fieldLabel}>Nav effect</span>
            <select
              aria-label="Nav effect"
              className={glassInput}
              value={form.navEffect || 'none'}
              onChange={(e) => patch({ navEffect: e.target.value === 'none' ? 'none' : (e.target.value as NavEffect) })}
            >
              <option value="none">None</option>
              {NAV_EFFECTS.map((n) => (
                <option key={n} value={n}>
                  {n[0]!.toUpperCase() + n.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className={fieldLabel}>Button effect</span>
            <select
              aria-label="Button effect"
              className={glassInput}
              value={form.buttonEffect || 'none'}
              onChange={(e) => patch({ buttonEffect: e.target.value === 'none' ? 'none' : (e.target.value as ButtonEffect) })}
            >
              <option value="none">None</option>
              {BUTTON_EFFECTS.map((b) => (
                <option key={b} value={b}>
                  {b[0]!.toUpperCase() + b.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
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

      <GlassCard title="Top navigation" icon={<PanelTop className="h-4 w-4" />}>
        <CodeField
          label="topNav — top of every page"
          title="topNav partial"
          hint={SLOT_HINT}
          value={form.topNav}
          onChange={(v) => patch({ topNav: v })}
          placeholder={'<div class="navbar">{{ company.name }}</div>'}
        />
      </GlassCard>

      <GlassCard title="Mobile navigation" icon={<Smartphone className="h-4 w-4" />}>
        <CodeField
          label="mobileNav — after topNav"
          title="mobileNav partial"
          hint={SLOT_HINT}
          value={form.mobileNav}
          onChange={(v) => patch({ mobileNav: v })}
          placeholder={'<div class="drawer">…</div>'}
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
