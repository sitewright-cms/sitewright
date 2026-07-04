import { describe, it, expect } from 'vitest';
import type { FormPublic } from '@sitewright/schema';
import {
  resolveFormEndpoints,
  resolveFormId,
  renderFormMarkup,
  resolveFormEmbeds,
  unknownFormMessage,
  type RenderForm,
} from '../src/form-embed.js';
import { renderTemplate, TemplateError } from '../src/template.js';

const pub = (over: Partial<FormPublic> = {}): FormPublic => ({
  id: 'contact',
  fields: [
    { name: 'name', label: 'Your name', type: 'text', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@example.com' },
    { name: 'budget', label: 'Budget', type: 'select', required: false, options: ['Under $10k', '$10k & up'] },
    { name: 'message', label: 'Message', type: 'textarea', required: true },
  ],
  submitLabel: 'Send enquiry',
  successMessage: 'Thanks — we got it.',
  errorMessage: 'Sorry, that & failed.',
  hcaptcha: false,
  mode: 'globalSmtp',
  ...over,
});

const ep = (id: string): string => `/f/proj1/${id}`;

/** A resolved one-form map (id `contact` unless overridden). */
const formsOf = (...defs: FormPublic[]): Record<string, RenderForm> =>
  resolveFormEndpoints(Object.fromEntries(defs.map((f) => [f.id, f])), ep);

describe('resolveFormEndpoints — per-mode endpoint precompute', () => {
  it('platform-routed modes get the caller-resolved /f endpoint', () => {
    const out = resolveFormEndpoints({ a: pub({ id: 'a' }), b: pub({ id: 'b', mode: 'userSmtp' }) }, ep);
    expect(out.a!.endpoint).toBe('/f/proj1/a');
    expect(out.b!.endpoint).toBe('/f/proj1/b');
  });
  it('thirdParty carries its own URL; a missing URL yields an empty endpoint', () => {
    const out = resolveFormEndpoints(
      { t: pub({ id: 't', mode: 'thirdParty', thirdPartyUrl: 'https://hooks.example/x' }), bare: pub({ id: 'bare', mode: 'thirdParty' }) },
      ep,
    );
    expect(out.t!.endpoint).toBe('https://hooks.example/x');
    expect(out.bare!.endpoint).toBe('');
  });
  it('contactPhp endpoints are deferred to the pass (empty here)', () => {
    expect(resolveFormEndpoints({ p: pub({ id: 'p', mode: 'contactPhp' }) }, ep).p!.endpoint).toBe('');
  });
  it('skips prototype-polluting ids', () => {
    const out = resolveFormEndpoints({ __proto__: pub({ id: '__proto__' }) } as Record<string, FormPublic>, ep);
    expect(Object.keys(out)).toEqual([]);
  });
});

describe('resolveFormId — locale-aware suffix resolution (dataset convention)', () => {
  const forms = formsOf(pub(), pub({ id: 'contact-de' }), pub({ id: 'contact-pt-br' }));
  it('prefers the locale-suffixed form, else the bare id', () => {
    expect(resolveFormId('contact', 'de', forms)).toBe('contact-de');
    expect(resolveFormId('contact', 'fr', forms)).toBe('contact');
    expect(resolveFormId('contact', undefined, forms)).toBe('contact');
  });
  it('lowercases the locale tag (pt-BR → -pt-br)', () => {
    expect(resolveFormId('contact', 'pt-BR', forms)).toBe('contact-pt-br');
  });
  it('an explicitly-suffixed id resolves itself', () => {
    expect(resolveFormId('contact-de', 'de', forms)).toBe('contact-de');
  });
  it('unknown ids and proto keys miss', () => {
    expect(resolveFormId('nope', 'de', forms)).toBeUndefined();
    expect(resolveFormId('__proto__', undefined, forms)).toBeUndefined();
    expect(resolveFormId('', undefined, forms)).toBeUndefined();
  });
  it('unknownFormMessage names every candidate tried', () => {
    expect(unknownFormMessage('x', 'de')).toContain('"x-de" or "x"');
    expect(unknownFormMessage('x', undefined)).toContain('"x"');
  });
});

describe('renderFormMarkup — the {{sw-form}} markup contract', () => {
  const form = formsOf(pub())['contact']!;
  const html = renderFormMarkup('contact', form);
  it('emits the FORM_CSS/FORM_JS wrapper contract with the reference and NO endpoint', () => {
    expect(html).toContain('<form data-sw-block="Form" data-sw-component="form" data-sw-form="contact" novalidate>');
    expect(html).not.toContain('data-sw-endpoint');
    expect(html).not.toContain('action=');
  });
  it('renders every field type with label/required/placeholder/options', () => {
    expect(html).toContain('<label data-sw-part="field"><span data-sw-part="label">Your name</span><input type="text" name="name" required /></label>');
    expect(html).toContain('<input type="email" name="email" required placeholder="you@example.com" />');
    expect(html).toContain('<select name="budget"><option value="">—</option><option value="Under $10k">Under $10k</option><option value="$10k &amp; up">$10k &amp; up</option></select>');
    expect(html).toContain('<textarea name="message" required></textarea>');
  });
  it('renders a radio group as a fieldset of option inputs (required propagates to the inputs)', () => {
    const f = formsOf(pub({ fields: [{ name: 'plan', label: 'Plan', type: 'radio', required: true, options: ['Basic', 'Pro'] }] }))['contact']!;
    const out = renderFormMarkup('contact', f);
    expect(out).toContain('<fieldset data-sw-part="field"><legend data-sw-part="label">Plan</legend>');
    expect(out).toContain('<label class="sw-form-opt"><input type="radio" name="plan" value="Basic" required /><span>Basic</span></label>');
    expect(out).toContain('<input type="radio" name="plan" value="Pro" required />');
  });
  it('renders a checkbox GROUP (options) — same name, NOT required per-box (no "at least one" HTML rule)', () => {
    const f = formsOf(pub({ fields: [{ name: 'features', label: 'Features', type: 'checkbox', required: true, options: ['SEO', 'Analytics'] }] }))['contact']!;
    const out = renderFormMarkup('contact', f);
    expect(out).toContain('<fieldset data-sw-part="field"><legend data-sw-part="label">Features</legend>');
    expect(out).toContain('<input type="checkbox" name="features" value="SEO" /><span>SEO</span>');
    expect(out).toContain('<input type="checkbox" name="features" value="Analytics" />');
    expect(out).not.toContain('value="SEO" required'); // a checkbox group box is never HTML-required
  });
  it('renders a single (option-less) checkbox as an inline box + label, honouring required', () => {
    const f = formsOf(pub({ fields: [{ name: 'agree', label: 'I agree to the terms', type: 'checkbox', required: true }] }))['contact']!;
    const out = renderFormMarkup('contact', f);
    expect(out).toContain('<label data-sw-part="field" class="sw-form-check"><input type="checkbox" name="agree" value="Yes" required /><span data-sw-part="label">I agree to the terms</span></label>');
    expect(out).not.toContain('<fieldset'); // not a group
  });

  it('renders submit + hidden success/error parts with escaped copy', () => {
    expect(html).toContain('<button type="submit" data-sw-part="submit" class="btn btn-primary">Send enquiry</button>');
    expect(html).toContain('<p data-sw-part="success" role="status" hidden>Thanks — we got it.</p>');
    expect(html).toContain('<p data-sw-part="error" role="alert" hidden>Sorry, that &amp; failed.</p>');
  });
  it('omits the honeypot (the pass injects it) and adds a class= when given', () => {
    expect(html).not.toContain('_hpt');
    expect(renderFormMarkup('contact', form, { class: 'card p-8' })).toContain('<form data-sw-block="Form" class="card p-8" data-sw-component="form"');
  });
  it('emits the inert hCaptcha placeholder only for opted-in platform-routed forms', () => {
    const cap = formsOf(pub({ hcaptcha: true }))['contact']!;
    expect(renderFormMarkup('contact', cap)).toContain('<div data-sw-part="hcaptcha"></div>');
    const third = formsOf(pub({ hcaptcha: true, mode: 'thirdParty', thirdPartyUrl: 'https://x.example/y' }))['contact']!;
    expect(renderFormMarkup('contact', third)).not.toContain('hcaptcha');
  });
});

describe('resolveFormEmbeds — the data-sw-form resolution pass', () => {
  const authored = '<form data-sw-form="contact"><input name="name" /></form>';

  it('injects the platform endpoint + component marker + honeypot, and strips the marker on publish', () => {
    const out = resolveFormEmbeds(authored, { forms: formsOf(pub()) });
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact"');
    expect(out).toContain('data-sw-component="form"');
    expect(out).toContain('name="_hpt"');
    expect(out).not.toContain('data-sw-form');
    // The honeypot carries its OWN inline hiding style so it stays invisible even on a hand-authored
    // <form data-sw-form> that never gets data-sw-block="Form" (FORM_CSS's scoped rule wouldn't apply).
    expect(out).toMatch(/data-sw-part="hp"[^>]*style="position:absolute;left:-9999px/);
  });
  it('keeps the data-sw-form marker in preview', () => {
    const out = resolveFormEmbeds(authored, { forms: formsOf(pub()), preview: true });
    expect(out).toContain('data-sw-form="contact"');
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact"');
  });
  it('resolves the locale-suffixed form on a locale page', () => {
    const out = resolveFormEmbeds(authored, { forms: formsOf(pub(), pub({ id: 'contact-de' })), locale: 'de' });
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact-de"');
  });
  it('thirdParty posts to its own URL', () => {
    const out = resolveFormEmbeds(authored, {
      forms: formsOf(pub({ mode: 'thirdParty', thirdPartyUrl: 'https://hooks.example/x?a=1&b=2' })),
    });
    expect(out).toContain('data-sw-endpoint="https://hooks.example/x?a=1&amp;b=2"');
  });
  it('contactPhp gets the page-relative contact.php + the hidden _form dispatch field', () => {
    const out = resolveFormEmbeds(authored, { forms: formsOf(pub({ mode: 'contactPhp' })), siteRoot: '../../' });
    expect(out).toContain('data-sw-endpoint="../../contact.php"');
    expect(out).toContain('<input type="hidden" name="_form" value="contact"');
  });
  it('does not duplicate an authored _form input or honeypot', () => {
    const src = '<form data-sw-form="contact"><input name="_form" value="contact" /><input name="_hpt" /></form>';
    const out = resolveFormEmbeds(src, { forms: formsOf(pub({ mode: 'contactPhp' })) });
    expect(out.match(/name="_form"/g)).toHaveLength(1);
    expect(out.match(/name="_hpt"/g)).toHaveLength(1);
  });
  it('owns endpoint + redirect: overwrites an authored endpoint, sets/deletes redirect from the definition', () => {
    const src = '<form data-sw-form="contact" data-sw-endpoint="https://evil.example/steal" data-sw-redirect="/stale"></form>';
    const out = resolveFormEmbeds(src, { forms: formsOf(pub()) });
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact"');
    expect(out).not.toContain('data-sw-redirect');
    const withRedirect = resolveFormEmbeds(authored, { forms: formsOf(pub({ redirectUrl: '/thanks' })) });
    expect(withRedirect).toContain('data-sw-redirect="/thanks"');
  });
  describe('hCaptcha widget', () => {
    const cap = formsOf(pub({ hcaptcha: true }));
    it('upgrades an authored/helper placeholder with the sitekey', () => {
      const src = '<form data-sw-form="contact"><div data-sw-part="hcaptcha" class="my-cap"></div></form>';
      const out = resolveFormEmbeds(src, { forms: cap, hcaptchaSiteKey: 'site-1' });
      expect(out).toContain('class="my-cap h-captcha"');
      expect(out).toContain('data-sitekey="site-1"');
    });
    it('appends the widget div when no placeholder exists', () => {
      const out = resolveFormEmbeds(authored, { forms: cap, hcaptchaSiteKey: 'site-1' });
      expect(out).toContain('<div class="h-captcha" data-sw-part="hcaptcha" data-sitekey="site-1"></div>');
    });
    it('withholds the widget without a sitekey (inert placeholder, no .h-captcha)', () => {
      const out = resolveFormEmbeds('<form data-sw-form="contact"><div data-sw-part="hcaptcha"></div></form>', { forms: cap });
      expect(out).not.toContain('h-captcha"');
      expect(out).not.toContain('data-sitekey');
    });
    it('withholds the widget for non-platform-routed modes (cannot be verified)', () => {
      const third = formsOf(pub({ hcaptcha: true, mode: 'thirdParty', thirdPartyUrl: 'https://x.example/y' }));
      const out = resolveFormEmbeds(authored, { forms: third, hcaptchaSiteKey: 'site-1' });
      expect(out).not.toContain('h-captcha');
    });
  });
  it('resolves two distinct forms on the same page independently', () => {
    const html = '<form data-sw-form="contact"></form><form data-sw-form="newsletter"></form>';
    const out = resolveFormEmbeds(html, { forms: formsOf(pub(), pub({ id: 'newsletter' })) });
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact"');
    expect(out).toContain('data-sw-endpoint="/f/proj1/newsletter"');
    // each form gets its own honeypot, not a shared one
    expect(out.match(/name="_hpt"/g)).toHaveLength(2);
  });
  it('throws for a non-<form> carrier', () => {
    expect(() => resolveFormEmbeds('<div data-sw-form="contact"></div>', { forms: formsOf(pub()) })).toThrow(/must be on a <form>/);
  });
  it('throws loudly for an unknown form id, naming every candidate', () => {
    expect(() => resolveFormEmbeds(authored, { forms: formsOf(pub({ id: 'other' })), locale: 'de' })).toThrow(
      /unknown form "contact" — no form "contact-de" or "contact" exists/,
    );
  });
  it('is a byte-identical no-op without a forms map (surface unsupported) or without a real carrier', () => {
    expect(resolveFormEmbeds(authored, {})).toBe(authored);
    const prose = '<p>Use the data-sw-form attribute to embed a form.</p>';
    expect(resolveFormEmbeds(prose, { forms: formsOf(pub()) })).toBe(prose);
  });
  it('survives an attribute round-trip with quotes/ampersands intact', () => {
    const src = '<form data-sw-form="contact" data-x="a &quot;b&quot; &amp; c"><input name="name" /></form>';
    const out = resolveFormEmbeds(src, { forms: formsOf(pub()) });
    expect(out).toContain('data-x="a &quot;b&quot; &amp; c"');
  });
});

describe('{{sw-form}} through renderTemplate (helper + pass composed)', () => {
  const forms = formsOf(pub(), pub({ id: 'contact-de', submitLabel: 'Absenden' }));
  it('renders the full form with the endpoint injected', () => {
    const out = renderTemplate('<section>{{sw-form "contact"}}</section>', { forms });
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact"');
    expect(out).toContain('<button type="submit" data-sw-part="submit" class="btn btn-primary">Send enquiry</button>');
    expect(out).toContain('name="_hpt"');
    expect(out).not.toContain('data-sw-form');
  });
  it('resolves the locale variant from page.locale and keeps the marker in preview', () => {
    const out = renderTemplate('{{sw-form "contact"}}', { forms, page: { locale: 'de' }, preview: true });
    expect(out).toContain('data-sw-form="contact-de"');
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact-de"');
    expect(out).toContain('>Absenden</button>');
  });
  it('passes the class= hash onto the wrapper', () => {
    const out = renderTemplate('{{sw-form "contact" class="card p-8"}}', { forms });
    expect(out).toContain('class="card p-8"');
  });
  it('renders nothing on a surface without a forms map (e.g. snippet hover preview)', () => {
    expect(renderTemplate('<div>{{sw-form "contact"}}</div>', {})).toBe('<div></div>');
  });
  it('throws a TemplateError for an unknown id', () => {
    expect(() => renderTemplate('{{sw-form "nope"}}', { forms })).toThrow(TemplateError);
    expect(() => renderTemplate('{{sw-form "nope"}}', { forms })).toThrow(/unknown form "nope"/);
  });
  it('throws a clear error for a missing/empty form id ({{sw-form}} with no argument)', () => {
    expect(() => renderTemplate('{{sw-form}}', { forms })).toThrow(/needs a form id/);
    expect(() => renderTemplate('<form data-sw-form=""></form>', { forms })).toThrow(/needs a form id/);
  });
  it('throws a TemplateError for an authored unknown data-sw-form reference too', () => {
    expect(() => renderTemplate('<form data-sw-form="nope"></form>', { forms })).toThrow(TemplateError);
  });
  it('exposes the public definitions as {{forms.*}} (recipient is stripped upstream)', () => {
    expect(renderTemplate('{{forms.contact.submitLabel}}', { forms })).toBe('Send enquiry');
  });
  it('composes with data-sw-text directives inside a hand-authored form (directives resolve first)', () => {
    const src = '<form data-sw-form="contact"><span data-sw-text="cta">Default</span><input name="name" /></form>';
    const out = renderTemplate(src, { forms, page: { data: { cta: 'Localized label' } } });
    expect(out).toContain('Localized label');
    expect(out).toContain('data-sw-endpoint="/f/proj1/contact"');
  });
});
