import { parseDocument } from 'htmlparser2';
import * as DomUtils from 'domutils';
import type { Element } from 'domhandler';
import { CART_PARTS, CART_FIELDS, CART_ACTIONS, CART_REQUIRED_PARTS } from './cart.js';

/**
 * FORK VALIDATION for an authored cart drawer.
 *
 * ★ Authoring freedom needs a way to be told you have broken it. The runtime degrades quietly by
 * design — a part you left out is a feature you left out — but "quietly" is exactly wrong when the
 * omission was a mistake, and the symptom is a drawer that renders beautifully and does nothing.
 *
 * ★ These are WARNINGS, never publish errors. A half-forked drawer must not block deploying the rest
 * of a site: the cart is one feature on one page, and refusing the whole publish over it would make
 * forking feel dangerous, which is the opposite of the point.
 */

export interface CartProblem {
  /** `error` = the drawer cannot work at all; `warning` = something is probably not what was meant. */
  severity: 'error' | 'warning';
  message: string;
}

/** The channel keys a shop has configured, so a button naming something else can be caught. */
export interface CartValidationContext {
  channelKeys: readonly string[];
}

const partSel = (name: string): string => `[data-sw-part="${name}"]`;

/** Every `data-sw-part` value present under `root`. */
function partsIn(root: ReturnType<typeof parseDocument>): Set<string> {
  const found = new Set<string>();
  for (const el of DomUtils.find((n) => n.type === 'tag' && 'data-sw-part' in (n as Element).attribs, root.children, true, 5000) as Element[]) {
    found.add(el.attribs['data-sw-part'] ?? '');
  }
  return found;
}

/**
 * Checks one rendered cart mount's inner markup.
 *
 * `html` is the mount's CONTENT. An empty string means the author did not fork — the runtime builds
 * the platform default — so there is nothing to validate and nothing to say.
 */
export function validateAuthoredCart(html: string, ctx: CartValidationContext): CartProblem[] {
  if (!html.trim()) return [];
  const doc = parseDocument(html, { decodeEntities: true });
  const present = partsIn(doc);
  // An authored drawer is one that declares ANY part — the same test the runtime makes, so the two
  // cannot disagree about whether this markup is authored.
  if (present.size === 0) return [];

  const problems: CartProblem[] = [];

  for (const required of CART_REQUIRED_PARTS) {
    if (!present.has(required)) {
      problems.push({
        severity: 'error',
        message: `the cart drawer has no data-sw-part="${required}" — without it the drawer cannot work at all`,
      });
    }
  }

  // The line template is where most forks go wrong, because it is the one part whose INSIDE matters.
  const tpl = DomUtils.findOne((n) => n.type === 'tag' && n.attribs['data-sw-part'] === CART_PARTS.lineTemplate, doc.children, true);
  if (tpl) {
    if (tpl.tagName.toLowerCase() !== 'template') {
      // A non-<template> renders its contents as a visible empty row before any item exists, and the
      // runtime has no `.content` to clone — so the list stays empty for ever.
      problems.push({
        severity: 'error',
        message: `data-sw-part="${CART_PARTS.lineTemplate}" must be a <template> element (found <${tpl.tagName.toLowerCase()}>)`,
      });
    }
    const fields = new Set(
      (DomUtils.find((n) => n.type === 'tag' && 'data-sw-field' in (n as Element).attribs, [tpl], true, 500) as Element[]).map(
        (e) => e.attribs['data-sw-field'] ?? '',
      ),
    );
    // A line with no name and no price shows the buyer nothing about what they are buying.
    if (!fields.has(CART_FIELDS.name)) {
      problems.push({ severity: 'warning', message: `the line template has no data-sw-field="${CART_FIELDS.name}" — lines will show no product name` });
    }
    if (!fields.has(CART_FIELDS.subtotal) && !fields.has(CART_FIELDS.price)) {
      problems.push({ severity: 'warning', message: 'the line template shows neither a price nor a line total' });
    }
    const actions = new Set(
      (DomUtils.find((n) => n.type === 'tag' && 'data-sw-action' in (n as Element).attribs, [tpl], true, 500) as Element[]).map(
        (e) => e.attribs['data-sw-action'] ?? '',
      ),
    );
    if (!actions.has(CART_ACTIONS.remove) && !(actions.has(CART_ACTIONS.decrement) && actions.has(CART_ACTIONS.increment))) {
      problems.push({
        severity: 'warning',
        message: 'the line template offers no way to change or remove an item — a buyer cannot correct a mistake',
      });
    }
  }

  // ★ A channel button naming a channel that is not configured. This is the one an author hits most:
  // they rename a channel in settings and the drawer keeps a button that now points at nothing, and
  // a dead checkout button looks exactly like a working one.
  const known = new Set(ctx.channelKeys);
  for (const el of DomUtils.find(
    (n) => n.type === 'tag' && typeof (n as Element).attribs['data-sw-action'] === 'string' && (n as Element).attribs['data-sw-action']!.startsWith('channel:'),
    doc.children,
    true,
    200,
  ) as Element[]) {
    const key = (el.attribs['data-sw-action'] ?? '').slice('channel:'.length);
    if (!known.has(key)) {
      problems.push({
        severity: 'error',
        message: `a button names the checkout channel "${key}", which this shop does not configure — it will do nothing when clicked`,
      });
    }
  }

  // A drawer with no way out traps a visitor behind a modal.
  if (!present.has(CART_PARTS.close) && DomUtils.findOne((n) => n.type === 'tag' && n.attribs['data-sw-action'] === CART_ACTIONS.close, doc.children, true) === null) {
    problems.push({ severity: 'warning', message: 'the drawer has no close control — a visitor can only leave it with Esc or the backdrop' });
  }
  // …and one nobody can open is only reachable by adding an item.
  if (!present.has(CART_PARTS.toggle) && DomUtils.findOne((n) => n.type === 'tag' && n.attribs['data-sw-action'] === CART_ACTIONS.open, doc.children, true) === null) {
    problems.push({ severity: 'warning', message: 'the drawer has no toggle or open control — nothing on the page opens the cart' });
  }

  // A part name that is not in the contract is almost always a typo, and silently does nothing.
  const declared = new Set<string>([...(Object.values(CART_PARTS) as string[]), 'channel', 'channel-form', 'order', 'line']);
  for (const name of present) {
    if (name && !declared.has(name)) {
      problems.push({ severity: 'warning', message: `data-sw-part="${name}" is not a part the cart runtime knows — check the spelling` });
    }
  }

  return problems;
}

/** The mount's inner markup, for every cart mount in a rendered page. */
export function cartMountContents(html: string): string[] {
  if (!html.includes('data-sw-cart')) return [];
  const doc = parseDocument(html, { decodeEntities: true });
  const mounts = DomUtils.find(
    (n) => n.type === 'tag' && 'data-sw-cart' in (n as Element).attribs && !('data-sw-cart-add' in (n as Element).attribs),
    doc.children,
    true,
    50,
  ) as Element[];
  return mounts.map((m) => DomUtils.getInnerHTML(m));
}

export { partSel };
