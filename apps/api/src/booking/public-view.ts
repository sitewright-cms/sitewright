import { minorUnitExponent, type BookingConfig, type BookingOffering } from '@sitewright/schema';

/*
 * What a visitor may see of a booking set-up. The booking routes answer with these, and a demo copy's build
 * embeds the same views (see publish/demo-build.ts), so the widget meets one shape whichever answers it.
 */

/** The offering as the widget needs it: how it is booked, never who else booked it. */
export function publicOffering(o: BookingOffering, config: BookingConfig): Record<string, unknown> {
  const timeZone = config.resources.find((r) => r.id === o.resourceIds[0])?.timeZone;
  // All of an offering's resources share one time zone (the schema insists), so the first one's is the offering's.
  const base = {
    id: o.id,
    name: o.name,
    mode: o.mode,
    confirmation: o.confirmation,
    maxQuantity: o.maxQuantity,
    minNoticeMin: o.minNoticeMin,
    maxAdvanceDays: o.maxAdvanceDays,
    timeZone,
    // A paid offering: what it costs, in the currency's own decimals, so the widget shows the total before the
    // visitor goes to pay. The server prices the booking itself; this is only what is shown.
    ...(o.price && config.payment
      ? { price: { amountMinor: o.price.amountMinor, per: o.price.per, currency: config.payment.currency, digits: minorUnitExponent(config.payment.currency) } }
      : {}),
  };
  const resources = o.chooseResource
    ? { resources: o.resourceIds.map((id) => ({ id, name: config.resources.find((r) => r.id === id)?.name ?? id })) }
    : {};
  if (o.mode === 'duration') return { ...base, durationMin: o.durationMin, ...resources };
  if (o.mode === 'range') return { ...base, minMin: o.minMin, maxMin: o.maxMin, stepMin: o.stepMin, ...resources };
  if (o.mode === 'days') return { ...base, unit: o.unit, minUnits: o.minUnits, maxUnits: o.maxUnits, checkIn: o.checkIn, checkOut: o.checkOut, ...resources };
  return { ...base, ...resources };
}

/** The offering as a booking's own page shows it. */
export function bookingSummary(o: BookingOffering, config: BookingConfig): Record<string, unknown> {
  const timeZone = config.resources.find((r) => r.id === o.resourceIds[0])?.timeZone;
  return {
    id: o.id,
    name: o.name,
    mode: o.mode,
    timeZone,
    ...(o.mode === 'days' ? { unit: o.unit } : {}),
  };
}
