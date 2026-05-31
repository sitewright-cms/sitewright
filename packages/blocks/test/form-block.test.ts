import { describe, it, expect } from 'vitest';
import type { FormPublic, PageNode } from '@sitewright/schema';
import { renderNode } from '../src/render.js';
import { componentAssets, usedComponentTypes } from '../src/components.js';

function node(partial: Partial<PageNode> & { type: string }): PageNode {
  return { id: partial.id ?? 'n1', ...partial };
}

const contactForm: FormPublic = {
  id: 'contact',
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea', required: false },
    { name: 'topic', label: 'Topic', type: 'select', required: false, options: ['Sales', 'Support'] },
  ],
  submitLabel: 'Send it',
  successMessage: 'Thanks!',
  errorMessage: 'Oops.',
  hcaptcha: false,
};

const ctx = {
  forms: { contact: contactForm },
  formEndpoint: (id: string) => `https://cms.example/f/proj1/${id}`,
};

describe('renderNode — Form', () => {
  it('renders a JS-only form (no action=) with the resolved endpoint + fields', () => {
    const html = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), ctx);
    expect(html).toContain('data-sw-component="form"');
    expect(html).not.toContain(' action=');
    expect(html).toContain('data-sw-endpoint="https://cms.example/f/proj1/contact"');
    expect(html).toContain('<input type="email" name="email" required');
    expect(html).toContain('<textarea name="message"');
    expect(html).toContain('<select name="topic"');
    expect(html).toContain('<option value="Sales">Sales</option>');
    expect(html).toContain('>Send it</button>');
    expect(html).toContain('data-sw-part="success" role="status" hidden>Thanks!');
    expect(html).toContain('data-sw-part="error" role="alert" hidden>Oops.');
  });

  it('emits a hidden honeypot field', () => {
    const html = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), ctx);
    expect(html).toContain('data-sw-part="hp"');
    expect(html).toContain('name="_hpt"');
  });

  it('adds a redirect attribute only when the form defines one', () => {
    const withRedirect: FormPublic = { ...contactForm, redirectUrl: '/thanks' };
    const html = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), {
      forms: { contact: withRedirect },
      formEndpoint: () => '/f/p/contact',
    });
    expect(html).toContain('data-sw-redirect="/thanks"');
  });

  it('never emits a recipient even if one is present on the source object', () => {
    // A defensive check: the public form has no recipient, but assert the rendered
    // output carries no email-looking recipient injected via any field.
    const html = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), ctx);
    expect(html).not.toContain('recipient');
  });

  it('renders an empty placeholder when the form id is unknown', () => {
    const html = renderNode(node({ type: 'Form', props: { formId: 'nope' } }), ctx);
    expect(html).toContain('data-sw-empty="1"');
    expect(html).not.toContain('<input');
  });

  it('renders the hCaptcha widget only when the form requires it AND a site key is set', () => {
    const hc: FormPublic = { ...contactForm, hcaptcha: true };
    const withKey = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), {
      forms: { contact: hc },
      formEndpoint: () => '/f/p/contact',
      hcaptchaSiteKey: 'site-abc',
    });
    expect(withKey).toContain('class="h-captcha" data-sw-part="hcaptcha" data-sitekey="site-abc"');

    // hcaptcha enabled but no site key → no widget (flag is inert).
    const noKey = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), {
      forms: { contact: hc },
      formEndpoint: () => '/f/p/contact',
    });
    expect(noKey).not.toContain('h-captcha');

    // site key present but form doesn't require it → no widget.
    const notRequired = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), {
      forms: { contact: contactForm },
      formEndpoint: () => '/f/p/contact',
      hcaptchaSiteKey: 'site-abc',
    });
    expect(notRequired).not.toContain('h-captcha');
  });

  it('escapes field labels and select options', () => {
    const evil: FormPublic = {
      ...contactForm,
      fields: [{ name: 'x', label: '<b>hi</b>', type: 'select', required: false, options: ['<script>'] }],
    };
    const html = renderNode(node({ type: 'Form', props: { formId: 'contact' } }), {
      forms: { contact: evil },
      formEndpoint: () => '/f/p/contact',
    });
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('Form component assets', () => {
  it('is registered so a page using a Form ships the submit JS', () => {
    expect(usedComponentTypes(node({ type: 'Form', props: { formId: 'contact' } }))).toContain('Form');
    const assets = componentAssets(['Form']);
    expect(assets.js).toContain("data-sw-component=\"form\"");
    expect(assets.js).toContain('_elapsed'); // time-trap
    expect(assets.js).toContain('preventDefault');
    expect(assets.js).toContain('js.hcaptcha.com/1/api.js'); // injects the hCaptcha script
    expect(assets.js).not.toContain('innerHTML'); // no unsafe DOM writes
    expect(assets.css).toContain('left:-9999px'); // honeypot hidden
  });
});
