import type { PaymentGatewayStored, PaymentKeysStatus, Shop } from '@sitewright/schema';

/** What {@link checkoutReadiness} needs to know about one gateway. */
export interface GatewayReadiness {
  gateway: Pick<PaymentGatewayStored, 'id' | 'enabled' | 'verified' | 'currencies'>;
  /** The project's keys for it, or null when it has none. */
  keys: PaymentKeysStatus | null;
}

export interface CheckoutReadiness {
  /** What stops a checkout channel taking a payment in the mode it is in. Empty: none of these. */
  problems: string[];
  /** True and worth saying, but not a failure — a channel still taking only TEST payments. */
  notes: string[];
}

type ShopChannel = NonNullable<Shop['channels']>[number];
type CheckoutChannel = Extract<ShopChannel, { kind: 'checkout' }>;

/** Items of a list-shaped settings field, or none. Shop settings are read raw, so do not trust the shape. */
function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Why a shop's online checkout would fail, in plain sentences, and what is worth knowing besides.
 *
 * ★ These are the failures that otherwise surface first as a BUYER unable to pay: a channel pointed
 * at a gateway this instance does not offer, a gateway the project has no keys for, keys missing for
 * the mode it transacts in, and a market charging a currency its provider does not take. Each one is
 * checked again at checkout; this is what lets whoever builds the shop see them beforehand. It does
 * not cover everything a checkout needs (a published price list, the buyer's fields) — an empty list
 * means none of THESE, not a guarantee.
 */
export function checkoutReadiness(shop: Shop | null, gateways: readonly GatewayReadiness[]): CheckoutReadiness {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!shop) return { problems, notes };
  const byId = new Map(gateways.map((g) => [g.gateway.id, g]));
  const checkout = listOf<ShopChannel | null>(shop.channels).filter(
    (c): c is CheckoutChannel => c?.kind === 'checkout' && typeof c.gatewayId === 'string',
  );
  /** Channels whose gateway can be asked for a payment at all, in the mode the project is in. */
  const usable = new Set<string>();
  for (const channel of checkout) {
    const at = `checkout channel "${channel.key}"`;
    const rec = byId.get(channel.gatewayId);
    if (!rec || !rec.gateway.enabled) {
      problems.push(`${at} charges through "${channel.gatewayId}", which this instance does not offer (unknown or disabled) — buyers cannot pay there`);
      continue;
    }
    if (!rec.keys) {
      problems.push(`${at}: the project has no keys for "${channel.gatewayId}" yet — a person enters them in Settings → Website → Payments`);
      continue;
    }
    const { mode } = rec.keys;
    const active = rec.keys[mode];
    if (!active.complete) {
      problems.push(`${at}: "${channel.gatewayId}" is in ${mode} mode but is missing ${active.missing.join(', ')}`);
      continue;
    }
    if (mode === 'live' && !rec.gateway.verified) {
      problems.push(`${at}: "${channel.gatewayId}" is in live mode but has not been proven — live payments are refused until a person proves it ("Prove it works")`);
      continue;
    }
    usable.add(channel.key);
    if (mode === 'test') {
      notes.push(`${at} takes TEST payments only — no real money moves until a person switches "${channel.gatewayId}" to live${rec.gateway.verified ? '' : ' (and proves it first)'}`);
    }
  }

  // A market charges in its own currency, through the channels it offers (absent = every one).
  const markets = listOf<NonNullable<Shop['markets']>[number]>(shop.markets);
  const charges =
    markets.length > 0
      ? markets.map((m) => ({ where: `market "${m.id}"`, currency: m.currency, channels: Array.isArray(m.channels) ? m.channels : undefined }))
      : shop.currency?.code
        ? [{ where: 'the shop', currency: shop.currency.code, channels: undefined }]
        : [];
  for (const { where, currency, channels } of charges) {
    for (const channel of checkout) {
      // A channel already reported above would only repeat itself here.
      if (!usable.has(channel.key)) continue;
      if (channels !== undefined && !channels.includes(channel.key)) continue;
      const accepted = byId.get(channel.gatewayId)?.gateway.currencies;
      if (accepted?.length && !accepted.includes(currency)) {
        problems.push(`${where} charges ${currency} through "${channel.key}", but "${channel.gatewayId}" only takes ${accepted.join(', ')}`);
      }
    }
  }
  return { problems, notes };
}
