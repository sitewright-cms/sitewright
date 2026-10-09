import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { siteUrlIssue, type JsonValue, type PaymentBindingPublic } from '@sitewright/schema';
import {
  Globe, Sparkles, PanelTop, Signpost, ShoppingCart, Languages, MoonStar, MoveHorizontal,
  ShieldAlert, ShieldCheck, Image as ImageIcon, Trash2, Search, BookOpenText,
} from 'lucide-react';
import { newStr, shopLabelKeys, type Patch, type SettingsForm } from './model';
import { Field, Labelled } from './ui';
import { api, type EffectForks, type Project } from '../../api';
import { RedirectsEditor } from './RedirectsEditor';
import { ShopSettingsModal } from './ShopSettingsModal';
import { PaymentCredentialsModal } from './PaymentCredentialsModal';
import { TransactionsInbox } from './TransactionsInbox';
import type { AvailableGateway } from './ShopChannelsEditor';
import { ConsentSettingsModal } from './ConsentSettingsModal';
import { LocaleManager } from './LocaleManager';
import { TranslationsEditor } from './TranslationsEditor';
import { WebsiteDataModal } from './WebsiteDataModal';
import { SlotEditor, type ChromeSlotKey } from '../SlotEditor';
import { ghostButton, glassInput, toggleInput } from '../../theme';
import { cardStagger } from './motion';
import { notifyPaymentsChanged } from '../../lib/payments-active';
import { Band, BudgetRows, EmptyRows, PartRow, Row, RowBlock, Tile } from './board/Tile';
import { SettingsSheet, type SheetSave } from './board/Sheet';
import { JsonDataStatus } from './website/JsonDataStatus';
import { EffectsControls, EFFECTS_HELP } from './website/EffectsControls';
import { SecuritySheet } from './website/SecuritySheet';
import { SkeletonMap } from './website/SkeletonMap';
import {
  consentStatus,
  contentWidthLabel,
  contentWidthStatus,
  effectsStatus,
  imagesStatus,
  languagesStatus,
  localeCodesOf,
  redirectsExtra,
  redirectsStatus,
  searchStatus,
  securityContacts,
  securityStatus,
  shopStatus,
  siteStatus,
  skeletonStatus,
  themesStatus,
  translationCoverage,
  translationsStatus,
} from './board/summaries';

/** A one-line summary of the current `website.data` value. */
function dataSummary(v: JsonValue): string {
  if (v == null) return 'Empty';
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'Empty';
  if (typeof v === 'object') {
    const n = Object.keys(v).length;
    return n ? `${n} key${n === 1 ? '' : 's'}` : 'Empty';
  }
  return 'A value';
}

/** Content-width presets (value = the `--sw-container` value; '' = platform default 1200px). */
const CW_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Default (1200px)', value: '' },
  { label: 'Narrow (960px)', value: '960px' },
  { label: 'Wide (1440px)', value: '1440px' },
  { label: 'Full width', value: 'none' },
];

/** Width of the content-width demo bar: the chosen width as a share of a 1600px reference screen. */
function widthDemoPct(value: string): number {
  if (value === 'none') return 100;
  const px = value === '' ? 1200 : parseInt(value, 10) || 1200;
  return Math.max(20, Math.min(100, Math.round((px / 1600) * 100)));
}

const HELP = {
  site: 'Where the site lives, and the data every template can read. The production URL is what sitemap.xml, robots.txt and every absolute link are built from.',
  themes:
    'Opt-in light + dark themes for the published site. When on, the platform adds a dark variant of your theme; pick whether visitors start on light, dark, or follow their device (auto). Add a {{sw-theme-toggle}} to your nav to let visitors switch. For best results use theme color classes (bg-base-100, text-base-content, text-primary) rather than fixed colors so your content adapts automatically.',
  width:
    'The max-width of the main content area, applied site-wide so every section’s content aligns to one width. Pick a preset or a custom pixel width; Full width removes the cap (edge-to-edge).',
  images: 'How images are stored when uploaded, and how {{sw-image}} delivers them.',
  skeleton:
    'Everything that wraps a page. The chrome slots are shared Handlebars partials, validated (no JS): HTML + Tailwind/DaisyUI + {{ company.* }}, {{#each nav.header}}, {{ website.json_data.* }}, {{ website.data.* }}. Head HTML and Scripts are raw, owner-only HTML.',
  redirects: 'Emitted to .htaccess + _redirects on publish. Reorderable, because the first match wins.',
  search:
    'Scripts where marks carry meaning (Thai, Devanagari, Hebrew, Arabic) are never affected either way.',
  shop: "A front-end cart for static sites: drop {{sw-cart}} + {{sw-add-to-cart …}} in a page (or use the global:shop template). The shop's wording (cart labels, currency, channel/field labels) is translatable — edit it in Translations & Labels.",
  consent:
    'A cookie-consent banner that gates third-party scripts + embeds by category, and derives the site CSP. It appears automatically on every page when enabled. Add a “Cookie settings” re-open link anywhere with <a href="#sw-consent">.',
  translations:
    'Shared phrases + UI labels ({{sw-translate}} / data-sw-translate), one row per key and a column per locale. Scoped keys (home.*, shop.*) group into collapsible sections. Inline preview edits land here too.',
};

type SheetKey = 'redirects' | 'security' | 'languages' | 'translations';

/**
 * Website Settings as a BOARD: four fixed bands — Delivery, Document, Site behaviour, Modules. Small
 * sections are edited on their tile; real forms drill in; the document skeleton and the shop are maps
 * whose parts each open their own editor. Every control the old cards held is still here.
 */
export function WebsiteSection({
  form,
  patch,
  saveNow,
  save,
  projectId,
  project,
  onLocalesChanged,
  onReloadSettings,
  onOpenOrders,
}: {
  form: SettingsForm;
  patch: Patch;
  /** Persist immediately (and stage). Rejects when the save failed, so a code editor can keep its draft. */
  saveNow: (p: Partial<SettingsForm>) => void | Promise<void>;
  /** The section save the drill-ins' own Save uses. */
  save: SheetSave;
  projectId: string;
  /** The project — the slot editor previews through its slug. Optional so the section still renders
   *  in contexts that don't have it (the full-editor entry points are then simply not offered). */
  project?: Project;
  /** Bubbles a language add/remove up so the pages list refreshes. */
  onLocalesChanged?: () => void;
  /** Re-hydrate the whole settings form after a server-side change (e.g. main-language relabel). */
  onReloadSettings?: () => Promise<void> | void;
  /** Switches to the project's Orders tab — passed exactly while that tab is showing (payments active). */
  onOpenOrders?: () => void;
}) {
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const close = () => setSheet(null);
  const [dataOpen, setDataOpen] = useState(false);
  // The chrome slot opened in the FULL editor (code + live preview + devices), or null.
  const [slotEdit, setSlotEdit] = useState<ChromeSlotKey | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [pruneMsg, setPruneMsg] = useState('');

  // The "fork existing effect" snippets (built-in effects as ready-to-run custom code). Static platform
  // data, fetched once.
  const [forks, setForks] = useState<EffectForks | null>(null);
  useEffect(() => {
    let on = true;
    api.listEffectForks().then((f) => on && setForks(f)).catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  // Gateways this project may bind to. Fetched once so the checkout channel row can offer them by
  // NAME — an operator should pick "Stripe Checkout", not type an id they have to know.
  const [gateways, setGateways] = useState<AvailableGateway[]>([]);
  useEffect(() => {
    let live = true;
    void api
      .projectPaymentGateways(projectId)
      .then((r) => {
        if (live) setGateways(r.gateways.map((g) => ({ id: g.id, name: g.name })));
      })
      // A project with no payment surface is the normal case, not an error worth surfacing.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);

  // What the shop's Payments part reports, and whether any orders exist. `undefined` = not known (the
  // shop is off, or this member may not read payments — the endpoint is owner/admin only).
  const [binding, setBinding] = useState<PaymentBindingPublic | null | undefined>(undefined);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const refreshPayments = useCallback(() => {
    if (!form.shopEnabled) return;
    // Promise.resolve().then(...) so even a synchronous throw (an older API without the route) lands in
    // the catch — the shop tile is a reader of this state, never a casualty of it.
    void Promise.resolve()
      .then(() => api.getProjectPayment(projectId))
      .then((r) => setBinding(r.binding))
      .catch(() => setBinding(undefined));
    void Promise.resolve()
      .then(() => api.listTransactions(projectId, { limit: 1 }))
      .then((r) => setOrdersTotal(r.total))
      .catch(() => setOrdersTotal(0));
  }, [projectId, form.shopEnabled]);
  useEffect(() => {
    refreshPayments();
  }, [refreshPayments]);

  const localeCodes = localeCodesOf(form);
  const siteUrlError = form.siteUrl.trim() ? siteUrlIssue(form.siteUrl.trim()) : null;
  const gatewayName = binding ? gateways.find((g) => g.id === binding.gatewayId)?.name ?? binding.gatewayId : '';
  const paymentsValue =
    binding === undefined ? '—' : binding === null ? 'Not connected' : binding.complete ? `${gatewayName} · ${binding.mode}` : `${gatewayName} · keys incomplete`;
  // The Shop and Consent modals send the operator to the labels — which now live in a drill-in.
  const editLabels = () => {
    setShopOpen(false);
    setConsentOpen(false);
    setSheet('translations');
  };
  const cwIsPreset = CW_PRESETS.some((o) => o.value === form.containerWidth);
  const coverage = translationCoverage(form);

  return (
    <motion.div variants={cardStagger} className="flex flex-col gap-8">
      <Band title="Delivery">
        <Tile title="Site" icon={<Globe className="h-4 w-4" />} status={siteStatus(form)} span="c6" md={6} help={HELP.site}>
          <Field
            label="Production URL (for sitemap.xml + robots.txt)"
            value={form.siteUrl}
            onChange={(v) => patch({ siteUrl: v })}
            type="url"
            placeholder="https://acme.com"
            error={siteUrlError}
            tip="An absolute URL, e.g. https://acme.com — a trailing slash is optional; no path, query or #fragment. Without it, publish skips sitemap.xml and robots.txt gets no Sitemap line."
          />
          <span className="flex flex-col">
            <Field
              label="JSON data URL → {{ website.json_data }}"
              value={form.jsonDataUrl}
              onChange={(v) => patch({ jsonDataUrl: v })}
              type="url"
              placeholder="https://api.example.com/data.json"
              tip="Public https only. Read on save and kept for the preview; publish re-reads it fresh."
            />
            <JsonDataStatus projectId={projectId} url={form.jsonDataUrl} />
          </span>
          <Labelled label={<>Site data → {'{{ website.data }}'}</>} tip="Your own JSON, edited here and read in any template as {{ website.data.* }}.">
            <span className="flex items-center gap-3">
              <button type="button" onClick={() => setDataOpen(true)} className={ghostButton}>
                Edit data
              </button>
              <span className="min-w-0 truncate pr-0.5 text-sm text-slate-500 dark:text-slate-400">{dataSummary(form.data).toLowerCase()}</span>
            </span>
          </Labelled>
        </Tile>

        <Tile title="Images" icon={<ImageIcon className="h-4 w-4" />} status={imagesStatus(form)} span="c3" md={3} help={HELP.images}>
          <Labelled label="Delivery format" tip="How {{sw-image}} serves responsive images: WebP, or an added AVIF tier — smaller on browsers that support it, at about twice the generated files.">
            <select
              aria-label="Image delivery format"
              className={glassInput}
              value={form.imageDelivery}
              onChange={(e) => patch({ imageDelivery: e.target.value as '' | 'webp' | 'avif' })}
            >
              <option value="">Default (WebP)</option>
              <option value="webp">WebP only</option>
              <option value="avif">AVIF + WebP</option>
            </select>
          </Labelled>
          <Labelled label="Upload size cap (px width)" tip="Originals wider than this are scaled down on upload. Blank keeps full resolution; delivery tops out at 2400px either way.">
            <input
              type="number"
              min={200}
              max={10000}
              aria-label="Upload size cap in pixels"
              className={glassInput}
              placeholder="Uncapped"
              value={form.imageUploadCap}
              onChange={(e) => patch({ imageUploadCap: e.target.value })}
            />
          </Labelled>
          {/* One line, whatever happens: the label names the action and never changes, and the outcome
              sits beside it (truncating), so a result can't grow the tile or rename the button. */}
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 font-medium text-indigo-700 transition hover:underline disabled:opacity-60 dark:text-indigo-300"
              disabled={pruning}
              onClick={async () => {
                setPruning(true);
                setPruneMsg('');
                try {
                  const { removed } = await api.pruneThumbnails(projectId);
                  setPruneMsg(`Cleared ${removed} cached thumbnail${removed === 1 ? '' : 's'}.`);
                } catch {
                  setPruneMsg('Could not clear the cache.');
                } finally {
                  setPruning(false);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {pruning ? 'Clearing…' : 'Clear thumbnail cache'}
            </button>
            {pruneMsg && (
              <span role="status" className="min-w-0 truncate pr-1 text-slate-500 dark:text-slate-400" title={pruneMsg}>
                {pruneMsg}
              </span>
            )}
          </span>
        </Tile>

        <Tile title="Content width" icon={<MoveHorizontal className="h-4 w-4" />} status={contentWidthStatus(form)} span="c3" md={3} help={HELP.width}>
          <span className="grid h-11 place-items-center rounded-lg border border-dashed border-slate-300 p-1.5 dark:border-slate-600" aria-hidden>
            <span
              className="grid h-full place-items-center overflow-hidden whitespace-nowrap rounded-md border border-indigo-300/80 bg-indigo-50/80 font-mono text-xs font-semibold text-slate-700 transition-[width] dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-slate-200"
              style={{ width: `${widthDemoPct(form.containerWidth)}%` }}
            >
              {contentWidthLabel(form.containerWidth)}
            </span>
          </span>
          <Labelled label="Width" tip="Sets the width of the .sw-container class — the content column every section aligns to.">
            {/* A grid, not flex: the shared input style carries `w-full`, which out-ranked a width on the
                custom input — it took the row and squeezed the select down to its arrow. Fixed tracks. */}
            <span className={`grid gap-2 ${cwIsPreset ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_5.5rem]'}`}>
              <select
                aria-label="Content width"
                className={`${glassInput} min-w-0`}
                value={cwIsPreset ? form.containerWidth : 'custom'}
                onChange={(e) => patch({ containerWidth: e.target.value === 'custom' ? '1080px' : e.target.value })}
              >
                {CW_PRESETS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              {!cwIsPreset && (
                <input
                  type="number"
                  min={320}
                  max={2560}
                  aria-label="Custom content width in pixels"
                  className={`${glassInput} min-w-0 tabular-nums`}
                  value={parseInt(form.containerWidth, 10) || ''}
                  onChange={(e) => patch({ containerWidth: e.target.value ? `${e.target.value}px` : '' })}
                />
              )}
            </span>
          </Labelled>
        </Tile>
      </Band>

      <Band title="Document">
        <Tile title="Document skeleton" icon={<PanelTop className="h-4 w-4" />} status={skeletonStatus(form)} span="c8" md={6} tall help={HELP.skeleton}>
          <SkeletonMap form={form} saveNow={saveNow} onOpenFullEditor={project ? setSlotEdit : undefined} />
        </Tile>

        <Tile title="Nav, buttons & preloader" icon={<Sparkles className="h-4 w-4" />} status={effectsStatus(form)} span="c4" md={3} help={EFFECTS_HELP}>
          <EffectsControls form={form} patch={patch} saveNow={saveNow} forks={forks} />
        </Tile>

        <Tile
          title="Light / dark themes"
          icon={<MoonStar className="h-4 w-4" />}
          status={themesStatus(form)}
          span="c4"
          md={3}
          help={HELP.themes}
          off={!form.enableThemes}
          control={
            // Master switch. OFF (default) = single-theme site, byte-identical output; gates the
            // {{sw-theme-toggle}} helper (renders nothing) + the reserved theme.toggle ghost row.
            <input type="checkbox" role="switch" aria-label="Enable themes" className={toggleInput} checked={form.enableThemes} onChange={(e) => patch({ enableThemes: e.target.checked })} />
          }
        >
          <Labelled label="Default theme" tip="The starting theme. A {{sw-theme-toggle}} in your nav lets visitors switch.">
            <select
              aria-label="Default theme"
              className={glassInput}
              disabled={!form.enableThemes}
              value={form.defaultTheme}
              onChange={(e) => patch({ defaultTheme: e.target.value as 'auto' | 'light' | 'dark' })}
            >
              <option value="auto">Auto — follow the visitor’s device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Labelled>
        </Tile>
      </Band>

      <Band title="Site behaviour">
        <Tile title="Redirects" icon={<Signpost className="h-4 w-4" />} status={redirectsStatus(form)} span="c4" md={6} onOpen={() => setSheet('redirects')}>
          <BudgetRows
            n={3}
            items={form.redirects.filter((r) => r.from.trim())}
            empty="None. Add one when a page moves, so old links keep working."
            extra={redirectsExtra(form)}
            render={(r) => <Row key={r.id} mono title={`${r.from} → ${r.to} · ${r.status}`} label={`${r.from} → ${r.to}`} value={String(r.status)} />}
          />
        </Tile>

        <Tile
          title="security.txt"
          icon={<ShieldAlert className="h-4 w-4" />}
          status={securityStatus(form)}
          span="c4"
          md={3}
          off={!form.securityEnabled}
          control={<input type="checkbox" role="switch" className={toggleInput} aria-label="Publish security.txt" checked={form.securityEnabled} onChange={(e) => patch({ securityEnabled: e.target.checked })} />}
        >
          {form.securityEnabled ? (
            <RowBlock n={4}>
              <Row label="Contacts" value={securityContacts(form).join(' · ') || 'none chosen'} />
              <Row label="Valid for" value={`${form.securityExpiryYears} year${form.securityExpiryYears === 1 ? '' : 's'}`} />
              <Row label="Policy" value={form.securityPolicyPageId ? 'a page of this site' : form.securityPolicyUrl.trim() || 'none'} />
              <PartRow label="Contacts & links" ariaLabel="Edit security.txt" onClick={() => setSheet('security')} />
            </RowBlock>
          ) : (
            <EmptyRows n={4}>The RFC 9116 contact file for security researchers. Turn it on, then choose a contact.</EmptyRows>
          )}
        </Tile>

        <Tile title="Site search" icon={<Search className="h-4 w-4" />} status={searchStatus(form)} span="c4" md={3} help={HELP.search}>
          <label className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Match accented letters loosely</span>
              <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                On (default), a search for “Muller” also finds “Müller”. Turn it off where å, ä and ö are separate letters, as in Swedish.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Search: match accented letters loosely"
              className={`${toggleInput} mt-0.5 shrink-0`}
              checked={form.searchFoldDiacritics}
              onChange={(e) => patch({ searchFoldDiacritics: e.target.checked })}
            />
          </label>
        </Tile>
      </Band>

      <Band title="Modules">
        <Tile
          title="Shop"
          icon={<ShoppingCart className="h-4 w-4" />}
          status={shopStatus(form)}
          span="c3"
          md={3}
          help={HELP.shop}
          off={!form.shopEnabled}
          control={
            // Master switch. OFF (default) gates the cart helpers (they render nothing) + the translation
            // table's reserved cart-string ghost rows.
            <input type="checkbox" role="switch" aria-label="Enable shop" className={toggleInput} checked={form.shopEnabled} onChange={(e) => patch({ shopEnabled: e.target.checked })} />
          }
        >
          {form.shopEnabled ? (
            <RowBlock n={5}>
              <Row
                label="Currency"
                value={
                  form.shopCurrencyCode
                    ? `${form.shopCurrencyCode}${form.shopTaxRate ? ` · ${form.shopTaxRate}% ${form.shopTaxMode === 'inclusive' ? 'incl.' : 'added'}` : ''}`
                    : 'not set'
                }
              />
              <Row label="Shipping" value={form.shopShippingFlat ? `${form.shopShippingFlat}${form.shopShippingFreeOver ? ` · free over ${form.shopShippingFreeOver}` : ''}` : 'no charge'} />
              <PartRow label="Shop settings" value={`${form.shopChannels.length} channel${form.shopChannels.length === 1 ? '' : 's'}`} ariaLabel="Edit shop settings" onClick={() => setShopOpen(true)} />
              <PartRow label="Payments" value={paymentsValue} ariaLabel="Edit payments" onClick={() => setPaymentsOpen(true)} />
              {onOpenOrders ? (
                <PartRow label="Orders" value="in the Orders tab" ariaLabel="Open the Orders tab" onClick={onOpenOrders} />
              ) : ordersTotal > 0 ? (
                // Payments are not active, but orders exist — they stay reachable here rather than stranded.
                <PartRow label="Orders" value={`${ordersTotal}`} ariaLabel="Open orders" onClick={() => setOrdersOpen(true)} />
              ) : (
                <Row label="Orders" value="once payments are on" />
              )}
            </RowBlock>
          ) : (
            <EmptyRows n={5}>Prices, tax, shipping, checkout channels and payments. None of it applies until the site sells something.</EmptyRows>
          )}
        </Tile>

        <Tile
          title="Consent"
          icon={<ShieldCheck className="h-4 w-4" />}
          status={consentStatus(form)}
          span="c3"
          md={3}
          help={HELP.consent}
          off={form.consent?.enabled !== true}
          control={
            <input
              type="checkbox"
              role="switch"
              aria-label="Enable consent manager"
              className={toggleInput}
              checked={form.consent?.enabled === true}
              onChange={(e) => patch({ consent: { ...(form.consent ?? {}), enabled: e.target.checked } })}
            />
          }
        >
          {form.consent?.enabled === true ? (
            <RowBlock n={5}>
              {(form.consent.integrations ?? []).length === 0 ? (
                <>
                  <Row label="No integrations gated yet" />
                  <Row label="Embeds wait for consent" />
                </>
              ) : (
                <BudgetRows
                  n={4}
                  items={form.consent.integrations ?? []}
                  empty=""
                  render={(i) => <Row key={i.id} label={i.name || 'Integration'} value={i.category} />}
                />
              )}
              <PartRow label="Consent settings" ariaLabel="Edit consent settings" onClick={() => setConsentOpen(true)} />
            </RowBlock>
          ) : (
            <EmptyRows n={5}>A cookie banner that holds analytics, chat and embeds until the visitor agrees.</EmptyRows>
          )}
        </Tile>

        <Tile title="Languages" icon={<Languages className="h-4 w-4" />} status={languagesStatus(form)} span="c3" md={3} onOpen={() => setSheet('languages')}>
          <BudgetRows
            n={5}
            items={localeCodes}
            empty="No language set."
            render={(l) => <Row key={l} label={l.toUpperCase()} value={l === form.defaultLocale ? 'main language' : 'translated'} />}
          />
        </Tile>

        <Tile title="Translations" icon={<BookOpenText className="h-4 w-4" />} status={translationsStatus(form)} span="c3" md={3} onOpen={() => setSheet('translations')}>
          {coverage.length > 0 ? (
            <BudgetRows
              n={5}
              items={coverage}
              empty=""
              extra={coverage.slice(4).map((c) => `${c.locale.toUpperCase()} ${c.pct}%`).join(', ')}
              render={(c) => (
                <span key={c.locale} className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 text-sm dark:border-slate-700/70 dark:bg-white/5" style={{ height: 30 }}>
                  <span className="w-8 shrink-0 text-xs font-bold text-slate-700 dark:text-slate-200">{c.locale.toUpperCase()}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
                    <span className={`block h-full rounded-full ${c.pct < 90 ? 'bg-amber-500' : 'sw-brand-gradient'}`} style={{ width: `${c.pct}%` }} />
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{c.pct}%</span>
                </span>
              )}
            />
          ) : (
            <BudgetRows
              n={5}
              items={form.translations.filter((r) => r.key.trim())}
              empty="No custom keys yet. The cart, consent and theme labels are edited here too."
              render={(r) => <Row key={r.id} mono title={r.key} label={r.key} value={r.cells[form.defaultLocale] ?? ''} />}
            />
          )}
        </Tile>
      </Band>

      {/* ── Drill-ins: each section's existing form, unchanged. ── */}
      {sheet === 'redirects' && (
        <SettingsSheet title="Redirects" help={HELP.redirects} onClose={close} save={save} size="xl">
          <RedirectsEditor rows={form.redirects} onChange={(redirects) => patch({ redirects })} />
        </SettingsSheet>
      )}
      {sheet === 'security' && <SecuritySheet form={form} patch={patch} projectId={projectId} save={save} onClose={close} />}
      {sheet === 'languages' && (
        <SettingsSheet title="Languages" onClose={close} save={save} size="xl">
          <LocaleManager
            projectId={projectId}
            locales={localeCodes}
            defaultLocale={form.defaultLocale}
            onChange={(next) => patch({ locales: next.map((value) => ({ ...newStr(), value })) })}
            onLocalesChanged={onLocalesChanged}
            onReloadSettings={onReloadSettings}
          />
        </SettingsSheet>
      )}
      {sheet === 'translations' && (
        <SettingsSheet title="Translations & Labels" help={HELP.translations} onClose={close} save={save}>
          <div id="translations-labels">
            <TranslationsEditor
              rows={form.translations}
              localeCodes={localeCodes}
              defaultLocale={form.defaultLocale}
              shopEnabled={form.shopEnabled}
              themesEnabled={form.enableThemes}
              consentEnabled={form.consent?.enabled === true}
              // Auto-surface a ghost row per configured channel/field label (shop.<key>) so the operator fills
              // the wording here instead of hand-typing the keys — only while the shop is on.
              extraGhostGroups={form.shopEnabled ? [{ id: 'shop_labels', label: 'Shop · Channels & fields', keys: shopLabelKeys(form.shopChannels) }] : []}
              onChange={(translations) => patch({ translations })}
            />
          </div>
        </SettingsSheet>
      )}

      {dataOpen && (
        <WebsiteDataModal
          value={form.data}
          // Its own Save is the only Save an author sees from inside that modal, so it persists too —
          // the same reasoning as the code editors, applied to the structured-data one.
          onSave={(data) => saveNow({ data })}
          onClose={() => setDataOpen(false)}
        />
      )}
      {shopOpen && <ShopSettingsModal form={form} patch={patch} onClose={() => setShopOpen(false)} gateways={gateways} onEditLabels={editLabels} />}
      {paymentsOpen && (
        <PaymentCredentialsModal
          projectId={projectId}
          onClose={() => {
            setPaymentsOpen(false);
            // Keys or the mode may have changed: re-read what the tile reports, and let the project tabs
            // re-decide whether Orders should be showing.
            refreshPayments();
            notifyPaymentsChanged(projectId);
          }}
        />
      )}
      {ordersOpen && <TransactionsInbox projectId={projectId} onClose={() => setOrdersOpen(false)} />}
      {consentOpen && <ConsentSettingsModal form={form} patch={patch} onClose={() => setConsentOpen(false)} onEditLabels={editLabels} />}
      {/* The full slot editor, stacked over Settings — the same slot as the map's part, with the live
          preview, device widths and click-to-code the page editor has. Saves through `saveNow`. */}
      {project && slotEdit && (
        <SlotEditor
          key={slotEdit}
          project={project}
          locales={localeCodes}
          slot={slotEdit}
          value={(form[slotEdit] as string | undefined) ?? ''}
          onSave={(key, src) => saveNow({ [key]: src })}
          onSwitchSlot={setSlotEdit}
          onClose={() => setSlotEdit(null)}
        />
      )}
    </motion.div>
  );
}
