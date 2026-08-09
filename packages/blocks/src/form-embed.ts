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
//   contactPhp /          → `${siteRoot}contact.php` (the exported PHP mailer, page-relative). BOTH
//   contactPhpSmtp          php modes post to the same file; they differ only in how that file
//                           delivers (host mail() vs authenticated SMTP), which is invisible here.
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
import {
  RECAPTCHA_RESPONSE_FIELD,
  type CaptchaRenderConfig, HONEYPOT_FIELD, FORM_ID_FIELD, isContactPhpMode, isPlatformRoutedMode, type FormPublic } from '@sitewright/schema';
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
   * The platform endpoint for swRouted modes / the thirdParty URL; '' for the php modes. NOT meant
   * for direct template use — `{{forms.x.endpoint}}` in a hand-rolled form bypasses the embed
   * pass (no honeypot, no hCaptcha, no component wiring → a silently dead form). Reference the
   * form via `data-sw-form` / `{{sw-form}}` instead.
   */
  endpoint: string;
}

/** Platform-routed delivery (the only modes Sitewright can server-side verify, incl. hCaptcha). */
function isSwRouted(form: FormPublic): boolean {
  return isPlatformRoutedMode(form.mode);
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
  const labelHtml = escapeHtml(field.label);
  const options = field.options ?? [];

  // A radio group, or a checkbox GROUP (a checkbox WITH options) → a <fieldset> of option rows. A radio
  // group carries native `required` on its inputs (the browser enforces "exactly one selected"). A checkbox
  // group has no native "at least one" rule, so a REQUIRED checkbox group instead carries `data-sw-required`
  // on the fieldset and FORM_JS enforces it via `setCustomValidity` (see components.ts) so the browser still
  // blocks + focuses it. Each checked box submits under the same name and the endpoint joins the values.
  if (field.type === 'radio' || (field.type === 'checkbox' && options.length > 0)) {
    const req = field.type === 'radio' ? required : '';
    const groupReq = field.type === 'checkbox' && field.required ? ' data-sw-required' : '';
    const rows = options
      .map((o) => `<label class="sw-form-opt"><input type="${field.type}" name="${name}" value="${escapeAttr(o)}"${req} /><span>${escapeHtml(o)}</span></label>`)
      .join('');
    return `<fieldset data-sw-part="field"${groupReq}><legend data-sw-part="label">${labelHtml}</legend>${rows}</fieldset>`;
  }

  // A single (boolean) checkbox — no options → the label sits beside the box; submits "Yes" when checked.
  if (field.type === 'checkbox') {
    return `<label data-sw-part="field" class="sw-form-check"><input type="checkbox" name="${name}" value="Yes"${required} /><span data-sw-part="label">${labelHtml}</span></label>`;
  }

  let control: string;
  if (field.type === 'textarea') {
    control = `<textarea name="${name}"${required}${ph}></textarea>`;
  } else if (field.type === 'select') {
    const opts = options.map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join('');
    control = `<select name="${name}"${required}><option value="">—</option>${opts}</select>`;
  } else {
    control = `<input type="${field.type}" name="${name}"${required}${ph} />`;
  }
  return `<label data-sw-part="field"><span data-sw-part="label">${labelHtml}</span>${control}</label>`;
}

/**
 * The COMPLETE form markup for a stored definition — the {{sw-form}} helper body. Carries the
 * `data-sw-form` reference and NO endpoint/redirect/honeypot: those are injected by
 * `resolveFormEmbeds` (one resolution code path for helper-emitted and hand-authored markup
 * alike). There is deliberately no `action=` — submission is JS-only (no JS → cannot submit).
 * Native constraint validation is ON (no `novalidate`): clicking submit with a required field empty
 * fires the browser's own "please fill this in" prompt on the first invalid field and blocks the submit
 * (the JS runtime's `submit` handler only runs once the form is valid). The CAPTCHA PLACEHOLDER is
 * positioned before the submit button; the pass upgrades it with the provider + sitekey only when the
 * PROJECT has configured one.
 */
export function renderFormMarkup(resolvedId: string, form: RenderForm, opts: { class?: string } = {}): string {
  const cls = opts.class ? ` class="${escapeAttr(opts.class)}"` : '';
  const fields = form.fields.map(renderFormField).join('');
  const captcha = form.captcha && isSwRouted(form) ? '<div data-sw-part="captcha"></div>' : '';
  return (
    `<form data-sw-block="Form"${cls} data-sw-component="form" data-sw-form="${escapeAttr(resolvedId)}">` +
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
  /**
   * The PROJECT's captcha provider + site key (both public — the site key ships in the markup).
   * Absent → captcha-flagged forms render the inert placeholder only: no widget class, no provider
   * marker, so the vendor script never loads and the flag is INERT rather than broken. That is the
   * same forgiving behaviour the missing-site-key case always had, now that the credentials live
   * with the project rather than the instance.
   */
  captcha?: CaptchaRenderConfig;
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

/** Does the form already carry a `data-sw-part="…"` descendant (author-placed status markup)? */
function hasPart(el: Element, part: string): boolean {
  return findAll((e) => e.attribs['data-sw-part'] === part, el.children).length > 0;
}

/**
 * The form's own submit control. A `<button>` with no `type` submits, so the default matters; a
 * `type="button"` (a stepper, a modal close) must never be mistaken for it.
 */
function submitControl(el: Element): Element | undefined {
  return findAll(
    (e) =>
      (e.tagName === 'button' && (e.attribs.type ?? 'submit').toLowerCase() === 'submit') ||
      (e.tagName === 'input' && (e.attribs.type ?? '').toLowerCase() === 'submit'),
    el.children,
  )[0];
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
    // A PLATFORM-ROUTED form carries only its ID; the runtime assembles the URL from the encoded blob
    // renderDocument emits (window.__swf). The endpoint must not sit in the markup as a ready-to-POST
    // address for a scraper to lift — see formApiScript.
    if (!isSwRouted(form)) {
      // contactPhp → a SAME-ORIGIN relative path with nothing to harvest, and an exported site has to
      // work with no blob at all. thirdParty → the AUTHOR'S OWN external endpoint, which is not ours to
      // hide and cannot be assembled from a project id. Both keep the plain attribute.
      el.attribs['data-sw-endpoint'] = isContactPhpMode(form.mode) ? `${ctx.siteRoot ?? ''}contact.php` : form.endpoint;
    } else {
      delete el.attribs['data-sw-endpoint']; // the pass OWNS this: drop any authored/stale value
      // ONE attribute doing both jobs: it marks the form as platform-routed (the published CSP keys on
      // it to allow the cross-origin submit, without caring where the URL lives) and carries the RESOLVED
      // id the runtime feeds to window.__swf. It cannot be `data-sw-form`: that is the AUTHORING marker
      // and is stripped on publish, which would leave the published form with nothing to submit to.
      el.attribs['data-sw-routed'] = resolvedId;
      // Proof-of-work is per-form and opt-in; the runtime only fetches and solves a challenge when the
      // form actually asks for one, so an unprotected form costs its visitors nothing.
      if (form.pow) el.attribs['data-sw-pow'] = '';
      else delete el.attribs['data-sw-pow'];
    }
    if (form.redirectUrl) el.attribs['data-sw-redirect'] = form.redirectUrl;
    else delete el.attribs['data-sw-redirect'];
    // Without the component marker FORM_JS never wires the submit — a silently dead form.
    el.attribs['data-sw-component'] = 'form';
    if (isContactPhpMode(form.mode) && !hasNamedInput(el, FORM_ID_FIELD)) {
      // contact.php dispatches by form id (one contact.php serves every form on the export).
      appendFragment(el, `<input type="hidden" name="${escapeAttr(FORM_ID_FIELD)}" value="${escapeAttr(resolvedId)}" />`);
    }
    if (!hasNamedInput(el, HONEYPOT_FIELD)) appendFragment(el, honeypotBlock());
    if (form.captcha && isSwRouted(form) && ctx.captcha) {
      const { provider, siteKey } = ctx.captcha;
      // The provider marker goes on the FORM, always — it is what the runtime switches on and what the
      // published page's CSP is keyed to. It cannot be inferred from a widget class, because reCAPTCHA
      // v3 HAS no widget: it is a script that runs on submit.
      el.attribs['data-sw-captcha'] = provider;
      if (provider === 'recaptcha-v3') {
        // v3 is invisible. The runtime fetches a token and writes it into this hidden field, so there
        // is nothing to place and an authored placeholder is left alone (Google's badge floats).
        if (!hasNamedInput(el, RECAPTCHA_RESPONSE_FIELD)) {
          appendFragment(el, `<input type="hidden" name="${escapeAttr(RECAPTCHA_RESPONSE_FIELD)}" data-sw-part="captcha" />`);
        }
      } else {
        // hCaptcha and reCAPTCHA v2 both render an interactive widget the vendor script finds by
        // class and configures from `data-sitekey`.
        const widgetClass = provider === 'hcaptcha' ? 'h-captcha' : 'g-recaptcha';
        const placeholder = findAll((e) => e.attribs['data-sw-part'] === 'captcha', el.children)[0];
        if (placeholder) {
          const classes = (placeholder.attribs.class ?? '').split(/\s+/).filter(Boolean);
          if (!classes.includes(widgetClass)) classes.push(widgetClass);
          placeholder.attribs.class = classes.join(' ');
          placeholder.attribs['data-sitekey'] = siteKey;
        } else {
          // No authored placeholder → append the widget div (functional anywhere inside the form;
          // authors control placement by adding their own `data-sw-part="captcha"` div).
          appendFragment(el, `<div class="${widgetClass}" data-sw-part="captcha" data-sitekey="${escapeAttr(siteKey)}"></div>`);
        }
      }
    }
    // STATUS MARKERS. FORM_JS reveals `success` on a 2xx, `error` on a failure, and disables `submit`
    // for the duration of the request. `renderFormMarkup` (the {{sw-form}} helper) emits all three; this
    // CODE-FIRST path emitted none of them, so a hand-authored `<form data-sw-form>` succeeded SILENTLY,
    // said nothing when delivery failed, and could be double-posted — while the definition's own
    // successMessage/errorMessage were rendered nowhere at all. Since code-first is the primary authoring
    // model, that was the default experience, and it is exactly the class of defect this project keeps
    // finding: the platform knows, and doesn't say.
    //
    // Injected only when ABSENT, keyed on the part rather than the element, so an author who has placed
    // their own status markup (or marked a specific button among several) keeps their placement, their
    // wording and their classes untouched.
    if (!hasPart(el, 'submit')) {
      const submit = submitControl(el);
      if (submit) submit.attribs['data-sw-part'] = 'submit';
    }
    if (!hasPart(el, 'success')) {
      appendFragment(el, `<p data-sw-part="success" role="status" hidden>${escapeHtml(form.successMessage)}</p>`);
    }
    if (!hasPart(el, 'error')) {
      appendFragment(el, `<p data-sw-part="error" role="alert" hidden>${escapeHtml(form.errorMessage)}</p>`);
    }
    // eslint-disable-next-line security/detect-object-injection -- FORM_ATTR is a module constant
    if (!ctx.preview) delete el.attribs[FORM_ATTR];
  }
  // utf8 entity mode: markup-significant chars only, non-ASCII stays literal (matches directives.ts).
  return render(doc, { encodeEntities: 'utf8' });
}
