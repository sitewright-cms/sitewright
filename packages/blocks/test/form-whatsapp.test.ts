// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { componentAssets } from '../src/components.js';
import { resolveFormEmbeds } from '../src/form-embed.js';
import { toPublicForm, FormSchema } from '@sitewright/schema';

/**
 * The WhatsApp hand-off mode: the browser compiles the filled form into a `wa.me` deep link and
 * opens it, the same shape the mini-shop's whatsapp channel uses for a cart.
 *
 * Nothing is posted, so the thing to prove is that the MESSAGE is right — the labels the visitor
 * actually saw, the values they actually entered — and that no request is made.
 */

const FORM_JS = componentAssets(['Form']).js;

function mountAndRun(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  (0, eval)(FORM_JS);
  return document.querySelector('form') as HTMLFormElement;
}

/** The message text the runtime handed to wa.me, decoded back out of the URL. */
function sentText(open: ReturnType<typeof vi.fn>): string {
  const url = new URL(open.mock.calls[0]![0] as string);
  return url.searchParams.get('text') ?? '';
}

let open: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  open = vi.fn();
  fetchSpy = vi.fn(() => Promise.resolve({ ok: true } as Response));
  vi.stubGlobal('open', open);
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('form → WhatsApp hand-off', () => {
  it('compiles the filled fields into a wa.me link, labelled as the visitor saw them', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-whatsapp="+14155550123" data-sw-wa-intro="New enquiry">' +
        '<label for="f-name">Your name</label><input id="f-name" type="text" name="name" />' +
        '<label for="f-msg">Message</label><textarea id="f-msg" name="message"></textarea>' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '<div data-sw-part="success" hidden>Thanks</div>' +
        '</form>',
    );
    form.querySelector<HTMLInputElement>('input[name="name"]')!.value = 'Ada Lovelace';
    form.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!.value = 'Hello there';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(open).toHaveBeenCalledTimes(1);
    // Digits ONLY — a leading '+' makes wa.me 404 instead of opening a chat.
    expect(open.mock.calls[0]![0]).toContain('https://wa.me/14155550123?text=');
    expect(sentText(open)).toBe('New enquiry\n\nYour name: Ada Lovelace\nMessage: Hello there');
  });

  it('★ posts NOTHING — the whole point is that there is no endpoint', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-whatsapp="+14155550123">' +
        '<label for="f-a">A</label><input id="f-a" name="a" />' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '</form>',
    );
    form.querySelector<HTMLInputElement>('input[name="a"]')!.value = 'x';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('joins a checkbox GROUP onto one line and skips unchecked options and empties', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-whatsapp="+14155550123">' +
        '<label for="f-n">Name</label><input id="f-n" name="name" />' +
        '<fieldset><legend>Features</legend>' +
        '<label><input type="checkbox" name="features" value="SEO" /></label>' +
        '<label><input type="checkbox" name="features" value="Analytics" /></label>' +
        '<label><input type="checkbox" name="features" value="Hosting" /></label>' +
        '</fieldset>' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '</form>',
    );
    const boxes = form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    boxes[0]!.checked = true;
    boxes[2]!.checked = true;
    // `name` left EMPTY — an unfilled optional field must not produce a bare "Name:" line.
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(sentText(open)).toBe('Features: SEO, Hosting');
  });

  it('shows the inline success panel and resets, since there is no server answer to wait for', () => {
    const form = mountAndRun(
      '<form data-sw-component="form" data-sw-whatsapp="+14155550123">' +
        '<label for="f-a">A</label><input id="f-a" name="a" />' +
        '<button type="submit" data-sw-part="submit">Send</button>' +
        '<div data-sw-part="success" hidden>Thanks</div>' +
        '</form>',
    );
    const input = form.querySelector<HTMLInputElement>('input[name="a"]')!;
    input.value = 'x';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(form.querySelector<HTMLElement>('[data-sw-part="success"]')!.hidden).toBe(false);
    expect(form.getAttribute('data-sw-submitted')).toBe('true');
    expect(input.value).toBe('');
  });
});

describe('form → WhatsApp rendering', () => {
  const def = (over: Record<string, unknown> = {}) =>
    FormSchema.parse({
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'name', label: 'Name', type: 'text' }],
      recipient: 'a@b.test',
      mode: 'whatsapp',
      whatsappNumber: '+14155550123',
      ...over,
    });

  /** Run the embed pass over an authored `data-sw-form` placeholder for this definition. */
  const render = (form: ReturnType<typeof def>) =>
    resolveFormEmbeds('<form data-sw-form="contact"></form>', {
      forms: { contact: { ...toPublicForm(form), endpoint: '' } },
    });

  it('emits the number onto the form and NO endpoint', () => {
    const out = render(def());
    expect(out).toContain('data-sw-whatsapp="+14155550123"');
    expect(out).not.toContain('data-sw-endpoint');
    expect(out).not.toContain('data-sw-routed');
  });

  it('carries the intro line when set, and omits the attribute when not', () => {
    expect(render(def({ whatsappIntro: 'New enquiry' }))).toContain('data-sw-wa-intro="New enquiry"');
    expect(render(def())).not.toContain('data-sw-wa-intro');
  });

  it('★ the RECIPIENT email never reaches the markup, as for every other mode', () => {
    expect(render(def())).not.toContain('a@b.test');
  });

  it('rejects a whatsapp form with no number, and a number that is not E.164', () => {
    expect(() => def({ whatsappNumber: undefined })).toThrow(/whatsappNumber is required/);
    expect(() => def({ whatsappNumber: '0415 555 0123' })).toThrow(/E\.164/);
  });
});
