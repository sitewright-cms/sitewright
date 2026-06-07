import { useState } from 'react';
import { GLOBAL_TEMPLATES, pagePath, pagesById } from '@sitewright/core';
import { NAV_SLOTS, type NavSlot, type Page, type Template } from '@sitewright/schema';
import { Modal } from './ui/Modal';
import { AssetField } from './files/AssetField';
import { glassInput } from '../theme';

/** The editable page-settings fields, flattened for form state. */
export interface PageSettingsValues {
  title: string;
  path: string;
  status: 'draft' | 'published';
  navSlots: NavSlot[];
  navTitle: string;
  navOrder: number;
  /** Show this page's CHILD pages in a dropdown under its nav item. */
  navDropdown: boolean;
  /** Parent page id ('' = top-level). */
  parent: string;
  /** Template reference ('' = none; 'global:<key>' or a project template id). */
  template: string;
  /** The page's language ('' = the project default locale). */
  locale: string;
  seoDescription: string;
  seoOgImage: string;
}

/** Extracts the settings form values from a page. */
export function pageSettingsFromPage(page: Page): PageSettingsValues {
  return {
    title: page.title,
    path: page.path,
    status: page.status ?? 'published',
    navSlots: page.nav?.slots ?? [],
    navTitle: page.nav?.title ?? '',
    navOrder: page.nav?.order ?? 0,
    navDropdown: page.nav?.dropdown ?? false,
    parent: page.parent ?? '',
    template: page.template ?? '',
    locale: page.locale ?? '',
    seoDescription: page.seo?.description ?? '',
    seoOgImage: page.seo?.ogImage ?? '',
  };
}

/** Applies settings form values onto a page (immutably; empty fields are dropped). */
export function applyPageSettings(page: Page, v: PageSettingsValues): Page {
  const nav = v.navSlots.length
    ? {
        slots: v.navSlots,
        ...(v.navTitle ? { title: v.navTitle } : {}),
        order: v.navOrder,
        ...(v.navDropdown ? { dropdown: true } : {}),
      }
    : undefined;
  // Pure construction (no delete-mutation): the fields this modal does NOT manage
  // (title/canonical/noindex) pass through; the managed ones come only from the form.
  const { description: droppedDescription, ogImage: droppedOgImage, ...seoRest } = page.seo ?? {};
  void droppedDescription;
  void droppedOgImage;
  const seo = {
    ...seoRest,
    ...(v.seoDescription ? { description: v.seoDescription } : {}),
    ...(v.seoOgImage ? { ogImage: v.seoOgImage } : {}),
  };
  return {
    ...page, // preserves translationGroup (set by "Add translation", not edited here)
    title: v.title,
    path: v.path,
    status: v.status,
    nav,
    parent: v.parent || undefined,
    template: v.template || undefined,
    locale: v.locale || undefined,
    seo: Object.keys(seo).length > 0 ? seo : undefined,
  };
}

/** Ids of `page` and all its descendants (cycle-safe) — invalid parent choices. */
function selfAndDescendants(pageId: string, pages: readonly Page[]): Set<string> {
  const blocked = new Set([pageId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parent && blocked.has(p.parent) && !blocked.has(p.id)) {
        blocked.add(p.id);
        grew = true;
      }
    }
  }
  return blocked;
}

interface PageSettingsModalProps {
  /** The page being configured (identity + home detection). */
  page: Page;
  /** Owning project — for the OG-image file picker. */
  projectId: string;
  initial: PageSettingsValues;
  /** All project pages — feeds the parent selector. */
  pages: readonly Page[];
  /** Project templates (built-in globals are added automatically). */
  templates: readonly Template[];
  /** The project's configured locales (Website Settings) — feeds the Language selector. */
  locales?: readonly string[];
  saving?: boolean;
  onClose: () => void;
  /** Receives the edited values; the CALLER persists (list) or applies to its draft (editor). */
  onSubmit: (values: PageSettingsValues) => void;
}

/**
 * Page settings in their OWN modal — it stacks above the page editor modal when
 * opened from there (Esc/save act on the top modal only). Covers the full set:
 * title, path, status, meta description, OG image, parent page, show-children-
 * in-dropdown, template reference, and nav placement.
 */
export function PageSettingsModal({ page, projectId, initial, pages, templates, locales = [], saving = false, onClose, onSubmit }: PageSettingsModalProps) {
  const [v, setV] = useState<PageSettingsValues>(initial);
  const patch = (next: Partial<PageSettingsValues>) => setV((prev) => ({ ...prev, ...next }));
  const isHome = page.path === '';
  // HOME (the empty-slug root) is the tree root: every other page must have a parent,
  // defaulting to home — so non-home pages are never offered a "None (top-level)" choice.
  // The literal fallback matches the create/copy defaults so the select always has a value.
  const homeId = pages.find((p) => p.path === '')?.id ?? 'home';
  const invalidParents = selfAndDescendants(page.id, pages);
  const parentChoices = pages.filter((p) => !invalidParents.has(p.id) && !p.collection);
  // The effective parent the form will submit for a non-home page (defaults to home).
  const effectiveParent = isHome ? '' : v.parent || homeId || '';
  // Index for the live "full URL" preview as the slug/parent are edited.
  const previewById = pagesById(pages);
  const childCount = pages.filter((p) => p.parent === page.id).length;
  // Sibling locale variants (same translation group), for context.
  const siblings = page.translationGroup ? pages.filter((p) => p.translationGroup === page.translationGroup && p.id !== page.id) : [];

  return (
    <Modal
      title={`Page settings — ${initial.title}`}
      size="lg"
      onClose={onClose}
      // Coerce the parent: home stays parentless; a non-home page submits its chosen
      // parent or falls back to home (there is no "None" for non-home pages).
      onSave={() => onSubmit({ ...v, parent: effectiveParent })}
      saving={saving}
      saveLabel="Save settings"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Title
            <input
              aria-label="Page title"
              className={`mt-1.5 font-normal ${glassInput}`}
              value={v.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Page Slug
            <input
              aria-label="Page path"
              className={`mt-1.5 font-mono font-normal ${glassInput}`}
              value={v.path}
              disabled={isHome}
              placeholder="about"
              title={isHome ? 'The home page is the site root' : 'One segment, no slashes — the URL is built from the parent chain'}
              // No slashes: lowercase + slugify as you type. Nesting comes from the parent.
              onChange={(e) => patch({ path: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '') })}
            />
            <span className="mt-1 font-normal text-[11px] text-slate-400">
              {isHome ? (
                'The home page is the site root (/).'
              ) : (
                <>
                  URL: <code>{pagePath({ ...page, path: v.path, parent: effectiveParent || undefined }, previewById)}</code> — built from the parent chain + this slug.
                </>
              )}
            </span>
          </label>
        </div>

        <label className="flex flex-col text-xs font-semibold text-slate-700">
          Meta Description
          <textarea
            aria-label="Meta description"
            className={`mt-1.5 resize-y font-normal ${glassInput}`}
            rows={2}
            maxLength={1000}
            placeholder="Shown in search results — one or two crisp sentences."
            value={v.seoDescription}
            onChange={(e) => patch({ seoDescription: e.target.value })}
          />
        </label>

        <AssetField
          label="Image (Open Graph)"
          value={v.seoOgImage}
          onChange={(val) => patch({ seoOgImage: val })}
          projectId={projectId}
          placeholder="https://… or /media/… (used in link previews)"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Parent Page
            <select
              aria-label="Parent page"
              className={`mt-1.5 font-normal ${glassInput}`}
              value={effectiveParent}
              // The HOME page is always the root — it can never be nested under another page.
              disabled={isHome}
              title={isHome ? 'The home page is the tree root' : undefined}
              onChange={(e) => patch({ parent: e.target.value })}
            >
              {/* Home is the root (parentless, disabled). Every other page must have a
                  parent — no "None" option — defaulting to Home. */}
              {isHome ? (
                <option value="">None (home is the root)</option>
              ) : (
                parentChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({pagePath(p, previewById)})
                  </option>
                ))
              )}
            </select>
            {isHome ? (
              <span className="mt-1 font-normal text-[11px] text-slate-400">The home page is the tree root.</span>
            ) : (
              <span className="mt-1 font-normal text-[11px] text-slate-400">Sub-pages nest under their parent; defaults to Home.</span>
            )}
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Template
            <select
              aria-label="Page template"
              className={`mt-1.5 font-normal ${glassInput}`}
              value={v.template}
              onChange={(e) => patch({ template: e.target.value })}
            >
              <option value="">None (own code)</option>
              {GLOBAL_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="mt-1 font-normal text-[11px] text-slate-400">
              A templated page renders the template’s code — its editor is locked (fork to customize).
            </span>
          </label>
        </div>

        {locales.length > 1 && (
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Language
            <select
              aria-label="Page language"
              className={`mt-1.5 font-normal ${glassInput}`}
              value={v.locale}
              onChange={(e) => patch({ locale: e.target.value })}
            >
              {/* The default locale is stored as ABSENCE (value ""); the explicit options
                  are the non-default locales only — no duplicate entry for the default. */}
              <option value="">Default ({locales[0]})</option>
              {locales.slice(1).map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <span className="mt-1 font-normal text-[11px] text-slate-400">
              Sets &lt;html lang&gt;; data bindings resolve to the matching <code>&lt;dataset&gt;-{v.locale || locales[0]}</code> variant.
              {siblings.length > 0 && <> Linked translations: {siblings.map((s) => s.locale ?? locales[0]).join(', ')}.</>}
            </span>
          </label>
        )}

        <div className="rounded-2xl border border-white/60 bg-white/40 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Navigation</p>
          <div className="flex flex-wrap items-center gap-4">
            {NAV_SLOTS.map((slot) => (
              <label key={slot} className="flex items-center gap-1.5 text-sm capitalize">
                <input
                  type="checkbox"
                  aria-label={`Nav: ${slot}`}
                  checked={v.navSlots.includes(slot)}
                  onChange={(e) =>
                    patch({
                      navSlots: e.target.checked ? [...v.navSlots, slot] : v.navSlots.filter((x) => x !== slot),
                    })
                  }
                />
                {slot}
              </label>
            ))}
          </div>
          {v.navSlots.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col text-[11px] text-slate-500">
                Menu label
                <input
                  aria-label="Nav menu label"
                  className={glassInput}
                  value={v.navTitle}
                  placeholder={v.title}
                  onChange={(e) => patch({ navTitle: e.target.value })}
                />
              </label>
              <label className="flex flex-col text-[11px] text-slate-500">
                Order
                <input
                  aria-label="Nav order"
                  type="number"
                  className={glassInput}
                  value={v.navOrder}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) patch({ navOrder: n });
                  }}
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Show in dropdown"
                  checked={v.navDropdown}
                  onChange={(e) => patch({ navDropdown: e.target.checked })}
                />
                Show child pages in dropdown
              </label>
            </div>
          )}
          {v.navDropdown && (
            <p className="mt-2 text-[11px] text-slate-400">
              {childCount > 0
                ? `${childCount} child page${childCount === 1 ? '' : 's'} will nest under this item.`
                : 'Pages whose Parent Page is this page will nest under this nav item.'}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-700">Status</p>
          <div className="inline-flex rounded-xl border border-white/60 bg-white/40 p-0.5">
            {(['published', 'draft'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={v.status === s}
                onClick={() => patch({ status: s })}
                className={`rounded-lg px-3 py-1 text-sm capitalize transition ${
                  v.status === s ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white/60'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
