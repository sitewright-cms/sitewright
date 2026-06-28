import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { Patch, SettingsForm } from './model';
import { api, type MediaAsset } from '../../api';
import { Field, FieldButton, GlassCard, SubLabel, TextArea } from './ui';
import { Building2, Palette, Type, Images, Mail, Share2 } from 'lucide-react';
import { BrandColorsEditor } from './BrandColorsEditor';
import { SocialProfilesEditor } from './SocialProfilesEditor';
import { FontSlotEditor } from './FontSlotEditor';
import { CustomFontSlots } from './CustomFontSlots';
import { BusinessTypeModal, BUSINESS_TYPE_DISABLED } from './BusinessTypeModal';
import { SCHEMA_ORG_TYPES } from './schema-org-types';
import { AssetField } from '../files/AssetField';
import { cardStagger } from './motion';

/** The human label for the current businessType: '' → default, 'disabled' → off, else its known
 *  label (or the raw custom @type). */
function businessTypeLabel(value: string): string {
  if (value === '') return 'Default (Organization)';
  if (value === BUSINESS_TYPE_DISABLED) return 'Disabled — no structured data';
  return SCHEMA_ORG_TYPES.find((t) => t.type === value)?.label ?? value;
}

/**
 * Corporate Identity: the unified company + brand record. Grouped into frosted
 * cards — Identity basics, Brand tokens, Logos & images, Contact & location, Social.
 */
export function IdentitySection({ form, patch, projectId }: { form: SettingsForm; patch: Patch; projectId: string }) {
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
  // The schema.org @type is picked from a searchable modal (a known list + Default/Disabled).
  const [businessTypeOpen, setBusinessTypeOpen] = useState(false);
  return (
    // Single column: every section is full container width; a section may still use 2 columns
    // INTERNALLY (e.g. the address grid below). A `cardStagger` container so the cards cascade in.
    <motion.div variants={cardStagger} className="flex flex-col gap-4">
      <GlassCard title="Identity" icon={<Building2 className="h-4 w-4" />}>
        <div className="flex flex-col gap-3">
          <Field label="Display name" value={form.name} onChange={(v) => patch({ name: v })} placeholder="Acme" required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Legal name" value={form.legalName} onChange={(v) => patch({ legalName: v })} placeholder="Acme Inc." />
            <Field label="Short name" value={form.shortName} onChange={(v) => patch({ shortName: v })} placeholder="Acme" />
          </div>
          <Field label="Slogan" value={form.slogan} onChange={(v) => patch({ slogan: v })} placeholder="We build the future" />
          <TextArea label="Description" value={form.description} onChange={(v) => patch({ description: v })} rows={3} />
          <FieldButton
            label="Business type (schema.org @type)"
            value={businessTypeLabel(form.businessType)}
            onClick={() => setBusinessTypeOpen(true)}
          />
        </div>
      </GlassCard>

      <GlassCard
        title="Brand colors"
        icon={<Palette className="h-4 w-4" />}
        tooltip="The six core colors below always exist and can’t be removed — they theme every page (and any DaisyUI components) automatically. Use them as bg-primary, text-base-content, etc."
      >
        <BrandColorsEditor rows={form.colors} onChange={(colors) => patch({ colors })} />
      </GlassCard>

      <GlassCard
        title="Typography"
        icon={<Type className="h-4 w-4" />}
        tooltip="The heading and body fonts applied across every page — in the editor preview and the published site. Use them anywhere with the font-heading and font-body classes. Fonts can be a system family, a Google webfont, or your own uploaded file — all self-hosted (never loaded from a CDN on your site)."
      >
        {fontsError && <p className="mb-2 text-xs text-rose-500">Couldn’t load your font library. Saved slots still work; try reloading.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FontSlotEditor
            label="Heading font"
            slot={form.heading}
            onChange={(heading) => patch({ heading })}
            projectId={projectId}
            fonts={fontAssets}
            onAddFont={addFont}
          />
          <FontSlotEditor
            label="Body font"
            slot={form.body}
            onChange={(body) => patch({ body })}
            projectId={projectId}
            fonts={fontAssets}
            onAddFont={addFont}
          />
        </div>
        <SubLabel tip="Add extra named fonts you can apply per element with a font-<name> class.">Custom fonts</SubLabel>
        <CustomFontSlots
          slots={form.named}
          onChange={(named) => patch({ named })}
          projectId={projectId}
          fonts={fontAssets}
          onAddFont={addFont}
        />
      </GlassCard>

      <GlassCard title="Logos & images" icon={<Images className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-3">
          <AssetField label="Logo" value={form.logo} onChange={(v) => patch({ logo: v })} projectId={projectId} placeholder="/logo.svg" />
          <AssetField label="Icon (favicon, apple-touch & PWA)" value={form.icon} onChange={(v) => patch({ icon: v })} projectId={projectId} placeholder="/icon.png — one square ≥512px image; all sizes generated" />
          <AssetField label="Logo (light bg)" value={form.logoLight} onChange={(v) => patch({ logoLight: v })} projectId={projectId} placeholder="/logo-light.svg" />
          <AssetField label="Logo (dark bg)" value={form.logoDark} onChange={(v) => patch({ logoDark: v })} projectId={projectId} placeholder="/logo-dark.svg" />
          <AssetField label="Share image (OG)" value={form.image} onChange={(v) => patch({ image: v })} projectId={projectId} placeholder="/og.png" />
        </div>
      </GlassCard>

      <GlassCard title="Contact & location" icon={<Mail className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" value={form.email} onChange={(v) => patch({ email: v })} type="email" placeholder="hi@acme.com" />
          <Field label="Telephone" value={form.telephone} onChange={(v) => patch({ telephone: v })} placeholder="+1 555 0100" />
        </div>
        <SubLabel>Address</SubLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Street" value={form.street} onChange={(v) => patch({ street: v })} />
          <Field label="Locality" value={form.locality} onChange={(v) => patch({ locality: v })} />
          <Field label="Region" value={form.region} onChange={(v) => patch({ region: v })} />
          <Field label="Country" value={form.country} onChange={(v) => patch({ country: v })} />
          <Field label="Postal code" value={form.postalCode} onChange={(v) => patch({ postalCode: v })} />
        </div>
        <SubLabel>Geo</SubLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" value={form.latitude} onChange={(v) => patch({ latitude: v })} placeholder="34.05" />
          <Field label="Longitude" value={form.longitude} onChange={(v) => patch({ longitude: v })} placeholder="-118.24" />
        </div>
        <SubLabel tip="The Google Maps “Embed a map” URL — available in templates as {{ company.mapUrl }} for an <iframe src> (e.g. a footer map).">Map</SubLabel>
        <Field
          label="Map embed URL"
          value={form.mapUrl}
          onChange={(v) => patch({ mapUrl: v })}
          placeholder="https://www.google.com/maps/embed?pb=…"
        />
        <SubLabel tip="An external booking / reservation / appointment link (a scheduling service) — available in templates as {{ company.bookingUrl }} for a “Book now” button.">Booking</SubLabel>
        <Field
          label="Booking URL"
          value={form.bookingUrl}
          onChange={(v) => patch({ bookingUrl: v })}
          type="url"
          placeholder="https://calendly.com/acme/intro"
        />
      </GlassCard>

      <GlassCard
        title="Social profiles"
        icon={<Share2 className="h-4 w-4" />}
        tooltip="Drag to reorder. Entering a URL auto-fills the name + icon (e.g. a WhatsApp link → “WhatsApp”); both are editable. Use them in templates with {{#each company.social}}…{{sw-icon icon}} {{name}}…{{/each}}. The links are also emitted as schema.org sameAs."
      >
        <SocialProfilesEditor rows={form.social} onChange={(social) => patch({ social })} />
      </GlassCard>

      {businessTypeOpen && (
        <BusinessTypeModal
          value={form.businessType}
          onSelect={(businessType) => patch({ businessType })}
          onClose={() => setBusinessTypeOpen(false)}
        />
      )}
    </motion.div>
  );
}
