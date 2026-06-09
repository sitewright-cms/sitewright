import { useState } from 'react';
import type { JsonValue } from '@sitewright/schema';
import type { Patch, SettingsForm } from './model';
import { Field, GlassCard } from './ui';
import { CodeField } from '../ui/CodeField';
import { RedirectsEditor } from './RedirectsEditor';
import { StringListEditor } from './StringListEditor';
import { WebsiteDataModal } from './WebsiteDataModal';
import { ghostButton } from '../../theme';

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
export function WebsiteSection({ form, patch }: { form: SettingsForm; patch: Patch }) {
  const [dataOpen, setDataOpen] = useState(false);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <GlassCard title="Site" icon="🌐" wide>
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

      <GlassCard title="Critical CSS" icon="◐" wide>
        <CodeField
          label="Project-wide CSS inlined in <head> (after brand tokens)"
          title="Critical CSS"
          language="css"
          value={form.criticalCss}
          onChange={(v) => patch({ criticalCss: v })}
          placeholder=".hero { ... }"
        />
      </GlassCard>

      <GlassCard title="Head HTML" icon="⟨⟩">
        <CodeField
          label="Raw HTML injected into <head> (analytics, meta)"
          title="Head HTML"
          value={form.head}
          onChange={(v) => patch({ head: v })}
          placeholder="<meta ... />"
        />
      </GlassCard>

      <GlassCard title="Scripts" icon="⟨/⟩">
        <CodeField
          label="Raw HTML injected after the page body (3rd-party scripts/widgets)"
          title="Scripts"
          value={form.scripts}
          onChange={(v) => patch({ scripts: v })}
          placeholder="<script ... ></script>"
        />
      </GlassCard>

      <div className="sm:col-span-2 mt-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Skeleton slots — shared Handlebars partials rendered around every page
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Validated (no JS): HTML + Tailwind/DaisyUI + <code>{'{{ company.* }}'}</code>,{' '}
          <code>{'{{#each nav.header}}'}</code>, <code>{'{{ website.json_data.* }}'}</code>,{' '}
          <code>{'{{ website.data.* }}'}</code>.
        </p>
      </div>

      <GlassCard title="Top navigation" icon="≡">
        <CodeField
          label="topNav — top of every page"
          title="topNav partial"
          hint={SLOT_HINT}
          value={form.topNav}
          onChange={(v) => patch({ topNav: v })}
          placeholder={'<div class="navbar">{{ company.name }}</div>'}
        />
      </GlassCard>

      <GlassCard title="Mobile navigation" icon="☰">
        <CodeField
          label="mobileNav — after topNav"
          title="mobileNav partial"
          hint={SLOT_HINT}
          value={form.mobileNav}
          onChange={(v) => patch({ mobileNav: v })}
          placeholder={'<div class="drawer">…</div>'}
        />
      </GlassCard>

      <GlassCard title="Left sidebar" icon="◧">
        <CodeField
          label="sidebarLeft — after the page body (position via classes)"
          title="sidebarLeft partial"
          hint={SLOT_HINT}
          value={form.sidebarLeft}
          onChange={(v) => patch({ sidebarLeft: v })}
          placeholder={'<div class="menu">…</div>'}
        />
      </GlassCard>

      <GlassCard title="Right sidebar" icon="◨">
        <CodeField
          label="sidebarRight — after the page body (position via classes)"
          title="sidebarRight partial"
          hint={SLOT_HINT}
          value={form.sidebarRight}
          onChange={(v) => patch({ sidebarRight: v })}
          placeholder={'<div class="menu">…</div>'}
        />
      </GlassCard>

      <GlassCard title="Footer" icon="▁">
        <CodeField
          label="footer — below body + sidebars"
          title="footer partial"
          hint={SLOT_HINT}
          value={form.footer}
          onChange={(v) => patch({ footer: v })}
          placeholder={'<div class="footer">© {{ company.name }}</div>'}
        />
      </GlassCard>

      <GlassCard title="Bottom" icon="▾">
        <CodeField
          label="bottom — after the footer (global modals, schema.org microdata)"
          title="bottom partial"
          hint={SLOT_HINT}
          value={form.bottom}
          onChange={(v) => patch({ bottom: v })}
          placeholder={'<div class="modal">…</div>'}
        />
      </GlassCard>

      <GlassCard title="Redirects" icon="↪" wide>
        <p className="mb-2 text-xs text-slate-500">Emitted to <code>.htaccess</code> + <code>_redirects</code> on publish.</p>
        <RedirectsEditor rows={form.redirects} onChange={(redirects) => patch({ redirects })} />
      </GlassCard>

      <GlassCard title="Localization" icon="🗺" wide>
        <Field label="Default locale" value={form.defaultLocale} onChange={(v) => patch({ defaultLocale: v })} placeholder="en" />
        <p className="mb-2 mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">Locales</p>
        <StringListEditor
          items={form.locales}
          onChange={(locales) => patch({ locales })}
          placeholder="en"
          ariaLabel="Locale"
          addLabel="+ Add locale"
        />
      </GlassCard>
    </div>
  );
}
