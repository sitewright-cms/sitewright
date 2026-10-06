import { fromMinorUnits, type TransactionLine } from '@sitewright/schema';
import type { SubmissionMail, SubmissionMailer, ProjectMailer } from '../mail/mailer.js';
import type { TransactionRow } from '../repo/shop-transactions.js';

/**
 * ORDER NOTIFICATIONS — the shop admin's, and the customer's.
 *
 * ★★ TWO INDEPENDENT DELIVERIES, NOT ONE. They fail independently: a merchant address that bounces
 * must not block the buyer's receipt, and retrying one must never re-send the other. A single shared
 * state column would make "the merchant was not told" and "the customer was not told"
 * indistinguishable, and those differ enormously in urgency — one is a missed order, the other is a
 * customer wondering whether their money went anywhere.
 *
 * ★★ AND THE RENDER CONTEXT IS ENUMERATED, NEVER HANDED THE SETTINGS BUNDLE. These templates are
 * author-editable, and `settings` holds the SMTP password and every payment credential. This is the
 * same rule the `data-sw-*` directives follow — scoped deliberately to the author-owned bag so a
 * binding can never address `identity.colors` or a deploy secret — restated for mail, where the
 * output leaves the building.
 */

/** Everything a mail template may see. Nothing outside this object is reachable. */
export interface OrderMailContext {
  order: {
    reference: string;
    currency: string;
    subtotal: string;
    shipping: string;
    tax: string;
    total: string;
    lines: Array<{ name: string; qty: number; amount: string }>;
    placedAt: string;
    /** `test` orders say so, loudly — a merchant must never mistake a rehearsal for a sale. */
    mode: 'test' | 'live';
  };
  /** The buyer's own submitted fields. Text only, exactly as stored. */
  buyer: Record<string, string>;
  shop: { name: string };
}

/** Shapes a transaction into the narrow context above. */
export function orderMailContext(txn: TransactionRow, shopName: string): OrderMailContext {
  const money = (minor: number): string => fromMinorUnits(minor, txn.currency);
  return {
    order: {
      // The buyer's handle on their own order. The opaque public token, not the internal id.
      reference: txn.publicToken.slice(0, 12),
      currency: txn.currency,
      subtotal: money(txn.amounts.subtotalMinor),
      shipping: money(txn.amounts.shippingMinor),
      tax: money(txn.amounts.taxMinor),
      total: money(txn.amounts.totalMinor),
      lines: txn.lines.map((l: TransactionLine) => ({ name: l.name, qty: l.qty, amount: money(l.lineMinor) })),
      placedAt: (txn.paidAt ?? txn.createdAt).toISOString(),
      mode: txn.mode,
    },
    buyer: txn.buyer,
    shop: { name: shopName },
  };
}

/** Escapes text for an HTML mail body. Mail clients are not forgiving, and neither is an injected tag. */
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** A line-items table shared by both bodies. */
function linesTable(ctx: OrderMailContext): string {
  const rows = ctx.order.lines
    .map((l) => `<tr><td style="padding:4px 8px">${esc(String(l.qty))}&#215;</td><td style="padding:4px 8px">${esc(l.name)}</td><td style="padding:4px 8px;text-align:right">${esc(l.amount)}</td></tr>`)
    .join('');
  const row = (label: string, value: string): string =>
    `<tr><td></td><td style="padding:2px 8px">${esc(label)}</td><td style="padding:2px 8px;text-align:right">${esc(value)}</td></tr>`;
  return (
    `<table role="presentation" style="border-collapse:collapse;font:14px/1.5 system-ui,sans-serif">${rows}` +
    row('Subtotal', ctx.order.subtotal) +
    (ctx.order.shipping !== '0.00' && ctx.order.shipping !== '0' ? row('Shipping', ctx.order.shipping) : '') +
    (ctx.order.tax !== '0.00' && ctx.order.tax !== '0' ? row('Tax', ctx.order.tax) : '') +
    `<tr><td></td><td style="padding:6px 8px;font-weight:600">Total</td><td style="padding:6px 8px;text-align:right;font-weight:600">${esc(ctx.order.total)} ${esc(ctx.order.currency)}</td></tr></table>`
  );
}

/** The same figures as plain text. ★ Multipart matters: plenty of order filters want a text part. */
function linesText(ctx: OrderMailContext): string {
  const rows = ctx.order.lines.map((l) => `  ${l.qty} x ${l.name}  ${l.amount}`).join('\n');
  const parts = [rows, `  Subtotal: ${ctx.order.subtotal}`];
  if (ctx.order.shipping !== '0.00' && ctx.order.shipping !== '0') parts.push(`  Shipping: ${ctx.order.shipping}`);
  if (ctx.order.tax !== '0.00' && ctx.order.tax !== '0') parts.push(`  Tax: ${ctx.order.tax}`);
  parts.push(`  TOTAL: ${ctx.order.total} ${ctx.order.currency}`);
  return parts.join('\n');
}

/** ★ A test order says so in the subject AND the body. A merchant must never mistake one for a sale. */
const testBanner = (ctx: OrderMailContext): string =>
  ctx.order.mode === 'test' ? '<p style="padding:8px;background:#fff3cd;border:1px solid #ffe69c">This is a TEST order. No money has changed hands.</p>' : '';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** The order notification the SHOP receives. Carries the buyer's fields so it is actionable. */
export function renderAdminMail(ctx: OrderMailContext, subject?: string): RenderedMail {
  const buyerRows = Object.entries(ctx.buyer)
    .map(([k, v]) => `<tr><td style="padding:2px 8px;color:#555">${esc(k)}</td><td style="padding:2px 8px">${esc(v)}</td></tr>`)
    .join('');
  const prefix = ctx.order.mode === 'test' ? '[TEST] ' : '';
  return {
    subject: `${prefix}${subject || `New order ${ctx.order.reference}`}`,
    html:
      `<div style="font:14px/1.5 system-ui,sans-serif">${testBanner(ctx)}` +
      `<h2 style="font-size:18px">New order ${esc(ctx.order.reference)}</h2>` +
      linesTable(ctx) +
      (buyerRows ? `<h3 style="font-size:15px;margin-top:16px">Customer</h3><table role="presentation" style="border-collapse:collapse">${buyerRows}</table>` : '') +
      `</div>`,
    text:
      (ctx.order.mode === 'test' ? 'THIS IS A TEST ORDER. No money has changed hands.\n\n' : '') +
      `New order ${ctx.order.reference}\n\n${linesText(ctx)}\n\n` +
      Object.entries(ctx.buyer)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n'),
  };
}

/** The confirmation the CUSTOMER receives. ★ Never carries the merchant's own address or refs. */
export function renderCustomerMail(ctx: OrderMailContext): RenderedMail {
  const prefix = ctx.order.mode === 'test' ? '[TEST] ' : '';
  return {
    subject: `${prefix}Your order ${ctx.order.reference}`,
    html:
      `<div style="font:14px/1.5 system-ui,sans-serif">${testBanner(ctx)}` +
      `<h2 style="font-size:18px">Thank you for your order</h2>` +
      `<p>We have received your payment. Your reference is <strong>${esc(ctx.order.reference)}</strong>.</p>` +
      linesTable(ctx) +
      `<p style="margin-top:16px;color:#555">${esc(ctx.shop.name)}</p></div>`,
    text:
      (ctx.order.mode === 'test' ? 'THIS IS A TEST ORDER. No money has changed hands.\n\n' : '') +
      `Thank you for your order\n\nWe have received your payment. Your reference is ${ctx.order.reference}.\n\n` +
      `${linesText(ctx)}\n\n${ctx.shop.name}`,
  };
}

/** Which of the two mails to send. They are addressed to different people and fail independently. */
export type OrderMailKind = 'admin' | 'customer';

export interface OrderMailerDeps {
  globalMailer: SubmissionMailer;
  projectMailer: ProjectMailer;
}

/**
 * Sends one of the two order mails.
 *
 * Reuses the submission mail path, so an operator's existing globalSmtp / userSmtp configuration —
 * and its retry, its allowlists and its STARTTLS hardening — covers orders too without a second
 * thing to set up or a second thing to get wrong.
 */
export async function sendOrderMail(
  deps: OrderMailerDeps,
  projectId: string,
  mode: 'globalSmtp' | 'userSmtp',
  recipient: string,
  rendered: RenderedMail,
  replyTo?: string,
): Promise<boolean> {
  const mail: SubmissionMail = {
    recipient,
    subject: rendered.subject,
    formName: 'order',
    // The transport renders `fields` into a body; passing the composed text here keeps ONE body
    // rather than letting the transport invent a second formatting of the same order.
    fields: { body: rendered.text },
    ...(replyTo ? { replyTo } : {}),
  };
  return mode === 'userSmtp' ? deps.projectMailer.send(projectId, mail) : deps.globalMailer.send(mail);
}
