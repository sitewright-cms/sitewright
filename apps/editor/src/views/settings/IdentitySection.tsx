import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Building2, Palette, Type, Images, Mail, Share2, Braces, Plus, X, FileImage, ChevronRight } from 'lucide-react';
import { DEFAULT_BRAND_COLORS } from '@sitewright/schema';
import type { Patch, SettingsForm } from './model';
import { api, type MediaAsset } from '../../api';
import { Field, FieldButton, SubLabel, TextArea } from './ui';
import { BrandColorsEditor, withColorToken } from './BrandColorsEditor';
import { TokenEditor } from './TokenEditor';
import { SocialProfilesEditor } from './SocialProfilesEditor';
import { FontSlotEditor } from './FontSlotEditor';
import { CustomFontSlots } from './CustomFontSlots';
import { BusinessTypeModal, BUSINESS_TYPE_DISABLED } from './BusinessTypeModal';
import { SCHEMA_ORG_TYPES } from './schema-org-types';
import { cssTokenError } from './css-token-error';
import { FilePicker } from '../files/FilePicker';
import { ACCEPT } from '../files/FileBrowser';
import { looksLikeImage } from '../files/AssetField';
import { fontFaceCss } from '../../lib/font-face-css';
import { ColorSwatchButton } from '../ui/ColorPicker';
import { cardStagger } from './motion';
import { Band, BudgetRows, KV, MoreRow, Note, Row, RowBlock, Tile } from './board/Tile';
import { SettingsSheet, type SheetSave } from './board/Sheet';
import {
  LOGO_WELLS,
  addressLine,
  colorSwatches,
  colorsStatus,
  contactStatus,
  cssTokensStatus,
  identityStatus,
  logosStatus,
  socialStatus,
  typographyRows,
  typographyStatus,
  budget,
  type LogoWellKey,
  type TypographyRow,
} from './board/summaries';

/** The human label for the current businessType: '' → default, 'disabled' → off, else its known
 *  label (or the raw custom @type). */
function businessTypeLabel(value: string): string {
  if (value === '') return 'Default (Organization)';
  if (value === BUSINESS_TYPE_DISABLED) return 'Disabled — no structured data';
  return SCHEMA_ORG_TYPES.find((t) => t.type === value)?.label ?? value;
}

type SheetKey = 'identity' | 'colors' | 'typography' | 'tokens' | 'contact' | 'social';

const HELP = {
  colors:
    'The six core colors always exist and can’t be removed — they theme every page (and any DaisyUI components) automatically. Use them as bg-primary, text-base-content, etc.',
  tokens:
    'Reusable CSS values that aren’t a colour or a font — a gradient, a shadow, a transition curve. Each becomes a --sw-<name> variable you can use anywhere CSS is allowed: Critical CSS, a <style> block, an inline style, or a Tailwind arbitrary value like [box-shadow:var(--sw-z1)]. They don’t create utility classes; reach them with var(). Images aren’t allowed here — url() is rejected; use the file manager.',
  typography:
    'The heading and body fonts applied across every page — in the editor preview and the published site. Use them anywhere with the font-heading and font-body classes. Fonts can be a system family, a Google webfont, or your own uploaded file — all self-hosted (never loaded from a CDN on your site).',
  social:
    'Drag to reorder. Entering a URL auto-fills the name + icon (e.g. a WhatsApp link → “WhatsApp”); both are editable. Use them in templates with {{#each company.social}}…{{sw-icon icon}} {{name}}…{{/each}}. The links are also emitted as schema.org sameAs.',
};

/**
 * Corporate Identity as a BOARD: three fixed bands — Identity & Brand Assets, Business details, Design tokens.
 * Every tile drills into the section's existing editor, except where the picture is the control: the logo
 * wells open the media picker and the six core colours open the colour picker, right on the board.
 */
export function IdentitySection({ form, patch, projectId, save }: { form: SettingsForm; patch: Patch; projectId: string; save: SheetSave }) {
  // The project's font library assets (kind 'font') — resolve the slots' @font-face previews + the
  // family names. Loaded once; a newly added/uploaded font is merged in via `addFont`.
  const [fontAssets, setFontAssets] = useState<MediaAsset[]>([]);
  const [fontsError, setFontsError] = useState(false);
  useEffect(() => {
    let alive = true;
    setFontsError(false);
    void api
      .listMedia(projectId, 'font')
      .then((r) => alive && setFontAssets(r.items.filter((a) => a.kind === 'font')))
      .catch(() => alive && setFontsError(true));
    return () => {
      alive = false;
    };
  }, [projectId]);
  const addFont = (font: MediaAsset) => setFontAssets((prev) => [...prev.filter((f) => f.id !== font.id), font]);
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [picking, setPicking] = useState<LogoWellKey | null>(null);
  // The schema.org @type is picked from a searchable modal (a known list + Default/Disabled).
  const [businessTypeOpen, setBusinessTypeOpen] = useState(false);
  const close = () => setSheet(null);
  const pickingWell = LOGO_WELLS.find((w) => w.key === picking);

  return (
    <motion.div variants={cardStagger} className="flex flex-col gap-8">
      <Band title="Identity & Brand Assets">
        <Tile title="Identity" icon={<Building2 className="h-4 w-4" />} status={identityStatus(form)} span="c4" md={6} onOpen={() => setSheet('identity')}>
          <span className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 dark:border-slate-700/70 dark:bg-white/5">
            <span className={`truncate pr-1 text-base font-bold ${form.name.trim() ? 'text-slate-900 dark:text-slate-100' : 'text-amber-700 dark:text-amber-400'}`} title={form.name}>
              {form.name.trim() || 'No display name'}
            </span>
            <span className={`truncate pr-1 text-sm ${form.slogan ? 'italic text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}`} title={form.slogan}>
              {form.slogan || 'No slogan'}
            </span>
          </span>
          <span className="flex flex-col gap-1.5">
            <KV label="Legal" value={form.legalName || '—'} tone={form.legalName ? 'normal' : 'muted'} />
            <KV label="Short" value={form.shortName || '—'} tone={form.shortName ? 'normal' : 'muted'} />
            <KV label="Type" value={businessTypeLabel(form.businessType)} tone={form.businessType ? 'normal' : 'muted'} />
          </span>
          <Note>{form.description || 'No description yet.'}</Note>
        </Tile>

        <Tile title="Logos & images" icon={<Images className="h-4 w-4" />} status={logosStatus(form)} span="c8" md={6}>
          <span className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {LOGO_WELLS.map((w) => (
              <LogoWell
                key={w.key}
                label={w.label}
                fieldLabel={w.fieldLabel}
                value={w.get(form)}
                dark={w.key === 'logoDark'}
                onBrowse={() => setPicking(w.key)}
                onClear={() => patch({ [w.key]: '' } as Partial<SettingsForm>)}
              />
            ))}
          </span>
          <Note>Each well is its own picker: click to choose from the media library, upload, or paste a URL.</Note>
        </Tile>
      </Band>

      <Band title="Business details">
        <Tile title="Contact & location" icon={<Mail className="h-4 w-4" />} status={contactStatus(form)} span="c8" md={6} onOpen={() => setSheet('contact')}>
          <span className="flex flex-col gap-1.5">
            <KV label="Email" value={form.email || '—'} tone={form.email ? 'normal' : 'muted'} />
            <KV label="Phone" value={form.telephone || '—'} tone={form.telephone ? 'normal' : 'muted'} />
            <KV label="Address" value={addressLine(form) || '—'} tone={addressLine(form) ? 'normal' : 'muted'} />
            <KV
              label="Map"
              value={form.latitude && form.longitude ? `${form.latitude}, ${form.longitude}${form.mapUrl ? ' · embed set' : ''}` : form.mapUrl ? 'Embed set' : '—'}
              tone={form.latitude || form.mapUrl ? 'normal' : 'muted'}
            />
            <KV label="Booking" value={form.bookingUrl || '—'} tone={form.bookingUrl ? 'normal' : 'muted'} />
          </span>
        </Tile>
        <Tile title="Social profiles" icon={<Share2 className="h-4 w-4" />} status={socialStatus(form)} span="c4" md={6} onOpen={() => setSheet('social')}>
          <BudgetRows
            n={4}
            items={form.social.filter((s) => s.link.trim())}
            empty="No profiles yet. They feed the footer and the schema.org sameAs list."
            render={(s) => <Row key={s.id} title={s.link} label={s.name || 'Profile'} value={hostOf(s.link)} />}
          />
        </Tile>
      </Band>

      <Band title="Design tokens">
        <Tile title="Brand colors" icon={<Palette className="h-4 w-4" />} status={colorsStatus(form)} span="c5" md={6} help={HELP.colors}>
          <ColorPreview form={form} onPick={(key, value) => patch({ colors: withColorToken(form.colors, key, value) })} onEditCustom={() => setSheet('colors')} />
        </Tile>
        <Tile title="Typography" icon={<Type className="h-4 w-4" />} status={typographyStatus(form)} span="c4" md={3} onOpen={() => setSheet('typography')}>
          <TypographyPreview form={form} fonts={fontAssets} />
        </Tile>
        <Tile title="CSS tokens" icon={<Braces className="h-4 w-4" />} status={cssTokensStatus(form)} span="c3" md={3} onOpen={() => setSheet('tokens')}>
          <BudgetRows
            n={3}
            items={form.cssTokens.filter((t) => t.key.trim() || t.value.trim())}
            empty="None. Add a gradient, a shadow or an easing."
            render={(t) => (
              <Row key={t.id} mono title={`--sw-${t.key}: ${t.value}`} label={<><b className="font-semibold text-slate-800 dark:text-slate-100">--sw-{t.key}</b>: {t.value}</>} />
            )}
          />
        </Tile>
      </Band>

      {/* ── Drill-ins: each section's existing form, unchanged. ── */}
      {sheet === 'identity' && (
        <SettingsSheet title="Identity" onClose={close} save={save} size="xl">
          <Field label="Display name" value={form.name} onChange={(v) => patch({ name: v })} placeholder="Acme" required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Legal name" value={form.legalName} onChange={(v) => patch({ legalName: v })} placeholder="Acme Inc." />
            <Field label="Short name" value={form.shortName} onChange={(v) => patch({ shortName: v })} placeholder="Acme" />
          </div>
          <Field label="Slogan" value={form.slogan} onChange={(v) => patch({ slogan: v })} placeholder="We build the future" />
          <TextArea label="Description" value={form.description} onChange={(v) => patch({ description: v })} rows={3} />
          <FieldButton label="Business type (schema.org @type)" value={businessTypeLabel(form.businessType)} onClick={() => setBusinessTypeOpen(true)} />
        </SettingsSheet>
      )}
      {sheet === 'colors' && (
        <SettingsSheet title="Brand colors" help={HELP.colors} onClose={close} save={save} size="xl">
          <BrandColorsEditor rows={form.colors} onChange={(colors) => patch({ colors })} />
        </SettingsSheet>
      )}
      {sheet === 'typography' && (
        <SettingsSheet title="Typography" help={HELP.typography} onClose={close} save={save}>
          {fontsError && <p className="text-xs text-rose-500 dark:text-rose-300">Couldn’t load your font library. Saved slots still work; try reloading.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <FontSlotEditor label="Heading font" slot={form.heading} onChange={(heading) => patch({ heading })} projectId={projectId} fonts={fontAssets} onAddFont={addFont} />
            <FontSlotEditor label="Body font" slot={form.body} onChange={(body) => patch({ body })} projectId={projectId} fonts={fontAssets} onAddFont={addFont} />
          </div>
          <div>
            <SubLabel tip="Add extra named fonts you can apply per element with a font-<name> class.">Custom fonts</SubLabel>
            <CustomFontSlots slots={form.named} onChange={(named) => patch({ named })} projectId={projectId} fonts={fontAssets} onAddFont={addFont} />
          </div>
        </SettingsSheet>
      )}
      {sheet === 'tokens' && (
        <SettingsSheet title="CSS tokens" help={HELP.tokens} onClose={close} save={save} size="xl">
          <TokenEditor
            rows={form.cssTokens}
            onChange={(cssTokens) => patch({ cssTokens })}
            keyPlaceholder="grad-hero"
            valuePlaceholder="linear-gradient(135deg,#06f,#0cf)"
            addLabel="+ Add CSS token"
            validateValue={cssTokenError}
          />
        </SettingsSheet>
      )}
      {sheet === 'contact' && (
        <SettingsSheet title="Contact & location" onClose={close} save={save} size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Email" value={form.email} onChange={(v) => patch({ email: v })} type="email" placeholder="hi@acme.com" />
            <Field label="Telephone" value={form.telephone} onChange={(v) => patch({ telephone: v })} placeholder="+1 555 0100" />
          </div>
          <div>
            <SubLabel>Address</SubLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Street" value={form.street} onChange={(v) => patch({ street: v })} />
              <Field label="Locality" value={form.locality} onChange={(v) => patch({ locality: v })} />
              <Field label="Region" value={form.region} onChange={(v) => patch({ region: v })} />
              <Field label="Country" value={form.country} onChange={(v) => patch({ country: v })} />
              <Field label="Postal code" value={form.postalCode} onChange={(v) => patch({ postalCode: v })} />
            </div>
          </div>
          <div>
            <SubLabel>Geo</SubLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude" value={form.latitude} onChange={(v) => patch({ latitude: v })} placeholder="34.05" />
              <Field label="Longitude" value={form.longitude} onChange={(v) => patch({ longitude: v })} placeholder="-118.24" />
            </div>
          </div>
          <div>
            <SubLabel tip="The Google Maps “Embed a map” URL — available in templates as {{ company.mapUrl }} for an <iframe src> (e.g. a footer map).">Map</SubLabel>
            <Field label="Map embed URL" value={form.mapUrl} onChange={(v) => patch({ mapUrl: v })} placeholder="https://www.google.com/maps/embed?pb=…" />
          </div>
          <div>
            <SubLabel tip="An external booking / reservation / appointment link (a scheduling service) — available in templates as {{ company.bookingUrl }} for a “Book now” button.">Booking</SubLabel>
            <Field label="Booking URL" value={form.bookingUrl} onChange={(v) => patch({ bookingUrl: v })} type="url" placeholder="https://calendly.com/acme/intro" />
          </div>
        </SettingsSheet>
      )}
      {sheet === 'social' && (
        <SettingsSheet title="Social profiles" help={HELP.social} onClose={close} save={save} size="xl">
          <SocialProfilesEditor rows={form.social} onChange={(social) => patch({ social })} />
        </SettingsSheet>
      )}

      {businessTypeOpen && (
        <BusinessTypeModal value={form.businessType} onSelect={(businessType) => patch({ businessType })} onClose={() => setBusinessTypeOpen(false)} />
      )}
      {pickingWell && (
        <FilePicker
          projectId={projectId}
          accept={ACCEPT.image}
          title={`Choose ${pickingWell.fieldLabel.toLowerCase()}`}
          onPick={(url) => patch({ [pickingWell.key]: url } as Partial<SettingsForm>)}
          onClose={() => setPicking(null)}
        />
      )}
    </motion.div>
  );
}

/** A social link's host, for the row's right-hand side. */
function hostOf(link: string): string {
  try {
    return new URL(link).host.replace(/^www\./, '');
  } catch {
    return link;
  }
}

/**
 * One brand-image well: a preview that opens the media picker, and the slot's name. The
 * well's button keeps the old field's accessible name ("Browse for Logo"), and Clear keeps its own.
 */
function LogoWell({ label, fieldLabel, value, dark, onBrowse, onClear }: { label: string; fieldLabel: string; value: string; dark: boolean; onBrowse: () => void; onClear: () => void }) {
  const isImage = value !== '' && looksLikeImage(value);
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        aria-label={`Browse for ${fieldLabel}`}
        title={value || 'Not set'}
        data-value={value}
        onClick={onBrowse}
        className={`waves-effect grid aspect-square w-full place-items-center overflow-hidden rounded-xl border p-3 transition hover:border-indigo-400 ${
          value === ''
            ? 'border-dashed border-slate-300 text-slate-400 dark:border-slate-600'
            : dark
              ? 'border-white/15 bg-slate-950'
              : 'border-slate-200 bg-white dark:border-slate-700'
        }`}
      >
        {value === '' ? (
          <Plus aria-hidden className="h-6 w-6" />
        ) : isImage ? (
          <img src={value} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <FileImage aria-hidden className="h-6 w-6 text-slate-400" />
        )}
      </button>
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate pr-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {value !== '' && (
          <button
            type="button"
            aria-label={`Clear ${fieldLabel}`}
            onClick={onClear}
            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:text-rose-600 dark:hover:text-rose-400"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </span>
  );
}

const defaultColorOf = (key: string): string => Object.entries(DEFAULT_BRAND_COLORS).find(([k]) => k === key)?.[1] ?? '';

/**
 * The six core colours, each a swatch that opens the colour picker with its value written inside it, then
 * the custom colours as a strip of dots on a row that opens the full editor (where custom colours live).
 */
function ColorPreview({ form, onPick, onEditCustom }: { form: SettingsForm; onPick: (key: string, value: string) => void; onEditCustom: () => void }) {
  const { core, custom } = colorSwatches(form);
  const MAX_DOTS = 10;
  return (
    <>
      {/* Three columns, two rows: at six across, names like "secondary" and "base-content" would truncate. */}
      <span className="grid grid-cols-3 gap-2.5">
        {core.map((c) => (
          <span key={c.key} className="flex min-w-0 flex-col gap-1">
            {/* A cleared core colour publishes as the platform default, so that is what it shows. */}
            <ColorSwatchButton label={c.key} value={c.value.trim() || defaultColorOf(c.key)} onChange={(v) => onPick(c.key, v)} className="h-11 w-full rounded-lg" />
            <span className="truncate px-1 text-center text-xs font-semibold text-slate-700 dark:text-slate-200">{c.key}</span>
          </span>
        ))}
      </span>
      <button
        type="button"
        onClick={onEditCustom}
        aria-label="Edit custom colors"
        className="waves-effect flex h-[30px] min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border border-indigo-300/70 bg-indigo-50/70 px-2.5 text-left transition hover:border-indigo-500 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:hover:border-indigo-400"
      >
        <span className="mr-1 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Custom</span>
        {custom.length === 0 ? (
          <span className="min-w-0 flex-1 truncate pr-1 text-sm text-slate-500 dark:text-slate-400">None yet. Each one adds bg-&lt;name&gt; and text-&lt;name&gt;.</span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {custom.slice(0, MAX_DOTS).map((c) => (
              <span key={c.key} title={`${c.key} ${c.value}`} className="h-4 w-4 shrink-0 rounded-full border border-slate-200 dark:border-slate-600" style={{ background: c.value }} />
            ))}
            {custom.length > MAX_DOTS && <span className="text-xs font-bold tabular-nums text-slate-500">+{custom.length - MAX_DOTS}</span>}
          </span>
        )}
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-indigo-500" />
      </button>
    </>
  );
}

/**
 * One row per typography slot, with the face shown in itself. Self-hosted faces get their @font-face
 * injected the same way the slot editor does, so "Aa" is the real face rather than a fallback.
 */
function TypographyPreview({ form, fonts }: { form: SettingsForm; fonts: MediaAsset[] }) {
  // Aligned index-for-index with `typographyRows` — the same filter (a named slot with a blank name is
  // not a slot yet), so row i and slot i always describe the same font.
  const slots = useMemo(
    () => [form.heading, form.body, ...form.named.filter((n) => n.name.trim() !== '').map((n) => n.slot)],
    [form.heading, form.body, form.named],
  );
  const used = useMemo(
    () => fonts.filter((f) => f.kind === 'font' && slots.some((s) => s.source === 'asset' && s.assetId === f.id)),
    [fonts, slots],
  );
  useEffect(() => {
    const css = used.map((f) => (f.kind === 'font' ? fontFaceCss(f) : '')).join('');
    if (!css) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [used]);
  const familyFor = (row: TypographyRow, index: number): string => {
    const slot = slots[index];
    if (slot?.source !== 'asset') return row.family;
    const asset = fonts.find((f) => f.id === slot.assetId);
    return asset?.kind === 'font' ? `'${asset.family}', ${asset.fallback ?? 'sans-serif'}` : `'${row.family}'`;
  };
  const rows = typographyRows(form);
  const N = 4;
  const fontRow = (r: TypographyRow, i: number) => (
    <span key={r.utility} title={`${r.family} · ${r.weight} · ${r.source}`} className="flex shrink-0 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-lg border border-slate-200/80 bg-slate-50/80 pr-2.5 text-sm dark:border-slate-700/70 dark:bg-white/5" style={{ height: 30 }}>
      <span className="grid w-8 shrink-0 place-items-center text-lg leading-none text-slate-900 dark:text-slate-100" style={{ fontFamily: familyFor(r, i), fontWeight: r.weight }} aria-hidden>
        Aa
      </span>
      <span className="hidden shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400 xl:inline">{r.utility}</span>
      <span className="min-w-0 flex-1 truncate pr-1 font-semibold text-slate-800 dark:text-slate-100">{r.family}</span>
      <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {r.weight} · {r.source}
      </span>
    </span>
  );
  if (rows.length <= 2) {
    return (
      <RowBlock n={N}>
        {rows.map(fontRow)}
        <span className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 px-3 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
          No custom fonts. Each one adds a font-&lt;name&gt; class.
        </span>
      </RowBlock>
    );
  }
  const { shown, more } = budget(rows, N);
  return (
    <RowBlock n={N}>
      {shown.map(fontRow)}
      {more > 0 && <MoreRow count={more} extra={rows.slice(shown.length).map((r) => r.utility).join(', ')} />}
    </RowBlock>
  );
}
