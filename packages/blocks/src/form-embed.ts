// Code-first FORM EMBEDDING — the `data-sw-form` resolution pass + the {{sw-form}} markup builder.
//
// An author references a platform form by ID ONLY: `<form data-sw-form="contact">…</form>` (hand-
// written markup) or `{{sw-form "contact"}}` (full markup from the stored definition — see the
// helper in template.ts, which emits the same `data-sw-form` attribute and nothing more). The
// submission endpoint is NEVER hand-authored: this pass runs server-side AFTER Handlebars +
// resolveDirectives (inside renderTemplate, preview AND publish, page bodies AND chrome slots) and
// injects `data-sw-endpoint` from the form's delivery mode:
//
//   globalSmtp / userSmtp → the platform endpoint (precomputed: absolute on export when a
//                           publicBaseUrl is set, same-origin `/f/<projectId>/<formId>` otherwise)
//   thirdParty            → the form's own https endpoint (posted to directly, cross-origin)
//   contactPhp            → `${siteRoot}contact.php` (the exported PHP mailer, page-relative)
//
// It also injects `data-sw-redirect` (from the definition — the single source of truth), the
// honeypot block, the contactPhp `_form` dispatch field, and the hCaptcha widget div (platform-
// routed modes only — Sitewright cannot verify a solve for contact.php / third-party endpoints).
// The client runtime (FORM_JS in components.ts) is unchanged: it still only reads
// `data-sw-endpoint`/`data-sw-redirect` and the `data-sw-part` markers.
//
// Resolution is LOCALE-AWARE, mirroring the dataset convention (`resolveLocaleDatasets` in
// @sitewright/core): on a `de` page, `data-sw-form="contact"` resolves the form `contact-de`
// when it exists, else `contact` — so inherit-mode locale variants share the page code while
// each locale gets its own translated form definition.
//
// Failure model: a dangling form reference is a HARD error (a silently dead contact form loses
// leads with no signal — same precedent as an unknown {{> partial}} or template ref). The one
// graceful case is a surface that provides NO forms map at all (ctx.forms === undefined, e.g.
// the snippet hover preview): then the pass is a no-op and {{sw-form}} renders ''. This module
// throws plain Errors; renderTemplate wraps them into TemplateError (avoids an import cycle).
import { parseDocument } from 'htmlparser2';
import type { Element } from 'domhandler';
import { findAll, appendChild } from 'domutils';
import render from 'dom-serializer';
import { HONEYPOT_FIELD, FORM_ID_FIELD, type FormPublic } from '@sitewright/schema';
import { escapeAttr, escapeHtml } from './escape.js';

/** Form-id keys that must never index the forms map (prototype-pollution guard). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** The author-facing form-reference attribute (kept in preview, stripped on publish). */
const FORM_ATTR = 'data-sw-form';

/**
 * A public form definition + its precomputed platform submission endpoint. PURE DATA — the render
 * context crosses the render-pool's JSON IPC, so no callback can ride along; the per-mode endpoint
 * choice that needs page state (contactPhp's `${siteRoot}contact.php`) is derived in the pass.
 */
export interface RenderForm extends FormPublic {
  /**
   * The platform endpoint for swRouted modes / the thirdParty URL; '' for contactPhp. NOT meant
   * for direct template use — `{{forms.x.endpoint}}` in a hand-rolled form bypasses the embed
   * pass (no honeypot, no hCaptcha, no component wiring → a silently dead form). Reference the
   * form via `data-sw-form` / `{{sw-form}}` instead.
   */
  endpoint: string;
}

/** Platform-routed delivery (the only modes Sitewright can server-side verify, incl. hCaptcha). */
function isSwRouted(form: FormPublic): boolean {
  return form.mode === 'globalSmtp' || form.mode === 'userSmtp';
}

/**
 * Precomputes each form's submission endpoint for a render surface. The caller supplies its own
 * `/f/<projectId>/<formId>` resolver — publish passes the publicBaseUrl-absolute one, preview the
 * same-origin one (mirrors `resolveShopChannels` in cart.ts). Pure; shallow copies.
 */
export function resolveFormEndpoints(
  forms: Record<string, FormPublic>,
  formEndpoint: (formId: string) => string,
): Record<string, RenderForm> {
  const out: Record<string, RenderForm> = Object.create(null);
  for (const [id, form] of Object.entries(forms)) {
    if (DANGEROUS_KEYS.has(id)) continue;
    const endpoint = isSwRouted(form) ? formEndpoint(id) : form.mode === 'thirdParty' ? (form.thirdPartyUrl ?? '') : '';
    // eslint-disable-next-line security/detect-object-injection -- null-proto map + DANGEROUS_KEYS guarded
    out[id] = { ...form, endpoint };
  }
  return out;
}

/** Own-property read of the forms map, proto-guarded (the id is author input). */
function formAt(forms: Record<string, RenderForm>, id: string): RenderForm | undefined {
  if (id === '' || DANGEROUS_KEYS.has(id) || !Object.prototype.hasOwnProperty.call(forms, id)) return undefined;
  // eslint-disable-next-line security/detect-object-injection -- own-property + DANGEROUS_KEYS guarded above
  return forms[id];
}

/**
 * Locale-aware form-id resolution — `<id>-<locale.toLowerCase()>` wins when that form exists, else
 * the bare `<id>` (the exact convention of `localizedDatasetName` in @sitewright/core, so datasets
 * and forms localize the same way). Undefined → no such form on this surface.
 */
export function resolveFormId(id: string, locale: string | undefined, forms: Record<string, RenderForm>): string | undefined {
  if (locale) {
    const localized = `${id}-${locale.toLowerCase()}`;
    if (formAt(forms, localized)) return localized;
  }
  return formAt(forms, id) ? id : undefined;
}

/** The loud unknown-form message, naming every id that was tried. */
export function unknownFormMessage(id: string, locale: string | undefined): string {
  if (id === '') return 'a form reference needs a form id (e.g. {{sw-form "contact"}} or data-sw-form="contact")';
  const tried = locale ? `"${id}-${locale.toLowerCase()}" or "${id}"` : `"${id}"`;
  return `unknown form "${id}" — no form ${tried} exists in this project`;
}

/** One form field as the FORM_CSS-styled control (the recovered Form-block contract). */
function renderFormField(field: FormPublic['fields'][number]): string {
  const name = escapeAttr(field.name);
  const required = field.required ? ' required' : '';
  const ph = field.placeholder ? ` placeholder="${escapeAttr(field.placeholder)}"` : '';
  let control: string;
  if (field.type === 'textarea') {
    control = `<textarea name="${name}"${required}${ph}></textarea>`;
  } else if (field.type === 'select') {
    const opts = (field.options ?? []).map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join('');
    control = `<select name="${name}"${required}><option value="">—</option>${opts}</select>`;
  } else {
    control = `<input type="${field.type}" name="${name}"${required}${ph} />`;
  }
  return `<label data-sw-part="field"><span data-sw-part="label">${escapeHtml(field.label)}</span>${control}</label>`;
}

/**
 * The COMPLETE form markup for a stored definition — the {{sw-form}} helper body. Carries the
 * `data-sw-form` reference and NO endpoint/redirect/honeypot: those are injected by
 * `resolveFormEmbeds` (one resolution code path for helper-emitted and hand-authored markup
 * alike). There is deliberately no `action=` — submission is JS-only (no JS → cannot submit).
 * The hCaptcha PLACEHOLDER is positioned before the submit button; the pass upgrades it with the
 * sitekey only when the instance has one configured.
 */
export function renderFormMarkup(resolvedId: string, form: RenderForm, opts: { class?: string } = {}): string {
  const cls = opts.class ? ` class="${escapeAttr(opts.class)}"` : '';
  const fields = form.fields.map(renderFormField).join('');
  const captcha = form.hcaptcha && isSwRouted(form) ? '<div data-sw-part="hcaptcha"></div>' : '';
  return (
    `<form data-sw-block="Form"${cls} data-sw-component="form" data-sw-form="${escapeAttr(resolvedId)}" novalidate>` +
    `<div data-sw-part="fields">${fields}</div>` +
    captcha +
    `<button type="submit" data-sw-part="submit" class="btn btn-primary">${escapeHtml(form.submitLabel)}</button>` +
    `<p data-sw-part="success" role="status" hidden>${escapeHtml(form.successMessage)}</p>` +
    `<p data-sw-part="error" role="alert" hidden>${escapeHtml(form.errorMessage)}</p>` +
    `</form>`
  );
}

export interface FormEmbedContext {
  /** Public form definitions + precomputed endpoints, keyed by id. ABSENT → forms unsupported
   * on this surface; the pass is a byte-identical no-op (not an authoring error). */
  forms?: Record<string, RenderForm>;
  /** The rendering page's locale (ctx.page.locale) — drives the `-<locale>` suffix resolution. */
  locale?: string;
  /** Page-relative path to the site root ('' at the root / in preview) — the contactPhp endpoint
   * is emitted page-relative because relativizeInternalLinks never rewrites data-* attributes. */
  siteRoot?: string;
  /** Instance hCaptcha site key (public). Absent → hcaptcha-flagged forms render the inert
   * placeholder only (no `.h-captcha` class, so the widget script never loads — flag is inert). */
  hcaptchaSiteKey?: string;
  /** PREVIEW keeps the `data-sw-form` marker (parity with the data-sw-* directives); publish
   * strips it, leaving clean static HTML. */
  preview?: boolean;
}

/** Parses an HTML fragment and appends its nodes as the element's last children. */
function appendFragment(el: Element, fragment: string): void {
  for (const kid of parseDocument(fragment, { decodeEntities: true }).children) appendChild(el, kid);
}

/** Does the form already contain an `<input name="…">` descendant (honeypot / `_form` dedupe)? */
function hasNamedInput(el: Element, name: string): boolean {
  return findAll((e) => e.tagName === 'input' && e.attribs.name === name, el.children).length > 0;
}

/**
 * The bot-bait honeypot block (the endpoint drops filled posts). Carries its OWN inline hiding style so
 * it stays invisible even on a HAND-AUTHORED `<form data-sw-form>` — that form gets the honeypot injected
 * but NOT the `data-sw-block="Form"` marker the FORM_CSS `[data-sw-part="hp"]` rule keys on (and FORM_CSS
 * may not ship at all for a non-component form), so a scoped rule alone would leave "Leave this field
 * empty" visible on the page. Platform-generated markup, so the inline style is safe.
 */
function honeypotBlock(): string {
  return (
    `<div data-sw-part="hp" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">` +
    `<label>Leave this field empty<input type="text" name="${escapeAttr(HONEYPOT_FIELD)}" tabindex="-1" autocomplete="off" /></label></div>`
  );
}

/**
 * The `data-sw-form` resolution pass. Runs inside renderTemplate after resolveDirectives; no-op
 * when the fragment carries no reference or the surface provides no forms map. Throws a plain
 * Error for a non-`<form>` carrier or an unknown form id (renderTemplate wraps it).
 */
export function resolveFormEmbeds(html: string, ctx: FormEmbedContext): string {
  if (typeof html !== 'string' || !html.includes(FORM_ATTR)) return html;
  const forms = ctx.forms;
  if (!forms) return html;
  const doc = parseDocument(html, { decodeEntities: true });
  const targets = findAll((el) => Object.prototype.hasOwnProperty.call(el.attribs, FORM_ATTR), doc.children);
  // The substring can match prose ("…use data-sw-form…") — only re-serialize when a real
  // attribute carrier exists, so such pages keep byte-identical output.
  if (targets.length === 0) return html;
  for (const el of targets) {
    if (el.tagName !== 'form') {
      throw new Error(`data-sw-form must be on a <form> element (found on <${el.tagName}>)`);
    }
    // eslint-disable-next-line security/detect-object-injection -- FORM_ATTR is a module constant
    const requested = el.attribs[FORM_ATTR] ?? '';
    const resolvedId = resolveFormId(requested, ctx.locale, forms);
    if (resolvedId === undefined) throw new Error(unknownFormMessage(requested, ctx.locale));
    const form = formAt(forms, resolvedId)!;
    // The pass OWNS the endpoint/redirect attributes — the stored definition is the single source
    // of truth, so an authored endpoint is overwritten and a stale authored redirect is dropped.
    el.attribs['data-sw-endpoint'] = form.mode === 'contactPhp' ? `${ctx.siteRoot ?? ''}contact.php` : form.endpoint;
    if (form.redirectUrl) el.attribs['data-sw-redirect'] = form.redirectUrl;
    else delete el.attribs['data-sw-redirect'];
    // Without the component marker FORM_JS never wires the submit — a silently dead form.
    el.attribs['data-sw-component'] = 'form';
    if (form.mode === 'contactPhp' && !hasNamedInput(el, FORM_ID_FIELD)) {
      // contact.php dispatches by form id (one contact.php serves every form on the export).
      appendFragment(el, `<input type="hidden" name="${escapeAttr(FORM_ID_FIELD)}" value="${escapeAttr(resolvedId)}" />`);
    }
    if (!hasNamedInput(el, HONEYPOT_FIELD)) appendFragment(el, honeypotBlock());
    if (form.hcaptcha && isSwRouted(form) && ctx.hcaptchaSiteKey) {
      const placeholder = findAll((e) => e.attribs['data-sw-part'] === 'hcaptcha', el.children)[0];
      if (placeholder) {
        const classes = (placeholder.attribs.class ?? '').split(/\s+/).filter(Boolean);
        if (!classes.includes('h-captcha')) classes.push('h-captcha');
        placeholder.attribs.class = classes.join(' ');
        placeholder.attribs['data-sitekey'] = ctx.hcaptchaSiteKey;
      } else {
        // No authored placeholder → append the widget div (functional anywhere inside the form;
        // authors control placement by adding their own `data-sw-part="hcaptcha"` div).
        appendFragment(el, `<div class="h-captcha" data-sw-part="hcaptcha" data-sitekey="${escapeAttr(ctx.hcaptchaSiteKey)}"></div>`);
      }
    }
    // eslint-disable-next-line security/detect-object-injection -- FORM_ATTR is a module constant
    if (!ctx.preview) delete el.attribs[FORM_ATTR];
  }
  // utf8 entity mode: markup-significant chars only, non-ASCII stays literal (matches directives.ts).
  return render(doc, { encodeEntities: 'utf8' });
}
