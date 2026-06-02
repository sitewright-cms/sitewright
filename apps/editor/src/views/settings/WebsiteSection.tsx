import type { Patch, SettingsForm } from './model';
import { Field, GlassCard, TextArea } from './ui';
import { RedirectsEditor } from './RedirectsEditor';
import { StringListEditor } from './StringListEditor';

/** Website settings: production URL, injected CSS/HTML, redirects, and localization. */
export function WebsiteSection({ form, patch }: { form: SettingsForm; patch: Patch }) {
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
      </GlassCard>

      <GlassCard title="Critical CSS" icon="◐" wide>
        <TextArea
          label="Project-wide CSS inlined in <head> (after brand tokens)"
          value={form.criticalCss}
          onChange={(v) => patch({ criticalCss: v })}
          rows={5}
          mono
          placeholder=".hero { ... }"
        />
      </GlassCard>

      <GlassCard title="Head HTML" icon="⟨⟩">
        <TextArea
          label="Raw HTML injected into <head> (analytics, meta)"
          value={form.head}
          onChange={(v) => patch({ head: v })}
          rows={5}
          mono
          placeholder="<meta ... />"
        />
      </GlassCard>

      <GlassCard title="Scripts" icon="⟨/⟩">
        <TextArea
          label="Raw HTML injected after the page body (3rd-party scripts/widgets)"
          value={form.scripts}
          onChange={(v) => patch({ scripts: v })}
          rows={5}
          mono
          placeholder="<script ... ></script>"
        />
      </GlassCard>

      <div className="sm:col-span-2 mt-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Skeleton slots — shared Handlebars partials rendered around every page
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Validated (no JS): HTML + Tailwind/DaisyUI + <code>{'{{ company.* }}'}</code>,{' '}
          <code>{'{{#each nav.header}}'}</code>, <code>{'{{ website.json_data.* }}'}</code>.
        </p>
      </div>

      <GlassCard title="Top navigation" icon="≡">
        <TextArea
          label="topNav — top of every page"
          value={form.topNav}
          onChange={(v) => patch({ topNav: v })}
          rows={4}
          mono
          placeholder={'<nav class="navbar">{{ company.name }}</nav>'}
        />
      </GlassCard>

      <GlassCard title="Mobile navigation" icon="☰">
        <TextArea
          label="mobileNav — after topNav"
          value={form.mobileNav}
          onChange={(v) => patch({ mobileNav: v })}
          rows={4}
          mono
          placeholder={'<nav class="drawer">…</nav>'}
        />
      </GlassCard>

      <GlassCard title="Left sidebar" icon="◧">
        <TextArea
          label="sidebarLeft — after the page body (position via classes)"
          value={form.sidebarLeft}
          onChange={(v) => patch({ sidebarLeft: v })}
          rows={4}
          mono
          placeholder={'<aside class="menu">…</aside>'}
        />
      </GlassCard>

      <GlassCard title="Right sidebar" icon="◨">
        <TextArea
          label="sidebarRight — after the page body (position via classes)"
          value={form.sidebarRight}
          onChange={(v) => patch({ sidebarRight: v })}
          rows={4}
          mono
          placeholder={'<aside class="menu">…</aside>'}
        />
      </GlassCard>

      <GlassCard title="Footer" icon="▁">
        <TextArea
          label="footer — below body + sidebars"
          value={form.footer}
          onChange={(v) => patch({ footer: v })}
          rows={4}
          mono
          placeholder={'<footer class="footer">© {{ company.name }}</footer>'}
        />
      </GlassCard>

      <GlassCard title="Bottom" icon="▾">
        <TextArea
          label="bottom — after the footer (global modals, schema.org microdata)"
          value={form.bottom}
          onChange={(v) => patch({ bottom: v })}
          rows={4}
          mono
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
