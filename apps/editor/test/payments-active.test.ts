import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getSettings, getProjectPayment } = vi.hoisted(() => ({ getSettings: vi.fn(), getProjectPayment: vi.fn() }));
vi.mock('../src/api', () => ({
  api: {
    getSettings: (p: string) => getSettings(p),
    getProjectPayment: (p: string) => getProjectPayment(p),
  },
}));

import { fetchPaymentsActive } from '../src/lib/payments-active';

const complete = { gatewayId: 'stripe', mode: 'test', fields: { test: [], live: [] }, missing: [], orphaned: [], complete: true };

beforeEach(() => {
  getSettings.mockReset();
  getProjectPayment.mockReset();
});

describe('fetchPaymentsActive — when the Orders tab may show', () => {
  it('is true only with the shop ON (as saved) AND a complete gateway binding', async () => {
    getSettings.mockResolvedValue({ item: { website: { shop: { enabled: true } } } });
    getProjectPayment.mockResolvedValue({ binding: complete });
    expect(await fetchPaymentsActive('p')).toBe(true);
  });

  it('is false while the shop is off, even with a bound gateway', async () => {
    getSettings.mockResolvedValue({ item: { website: { shop: { enabled: false } } } });
    getProjectPayment.mockResolvedValue({ binding: complete });
    expect(await fetchPaymentsActive('p')).toBe(false);
  });

  it('is false with no binding, or an incomplete one (no checkout can be attempted)', async () => {
    getSettings.mockResolvedValue({ item: { website: { shop: { enabled: true } } } });
    getProjectPayment.mockResolvedValue({ binding: null });
    expect(await fetchPaymentsActive('p')).toBe(false);
    getProjectPayment.mockResolvedValue({ binding: { ...complete, missing: ['secret'], complete: false } });
    expect(await fetchPaymentsActive('p')).toBe(false);
  });

  it('★ treats a REFUSAL as "not active" — the server decides who may know about payments', async () => {
    getSettings.mockResolvedValue({ item: { website: { shop: { enabled: true } } } });
    getProjectPayment.mockRejectedValue(Object.assign(new Error('insufficient role for this operation'), { status: 403 }));
    expect(await fetchPaymentsActive('p')).toBe(false);
  });

  it('survives an API without the route (a synchronous throw) and a settings read that fails', async () => {
    getSettings.mockRejectedValue(new Error('boom'));
    getProjectPayment.mockImplementation(() => {
      throw new TypeError('api.getProjectPayment is not a function');
    });
    expect(await fetchPaymentsActive('p')).toBe(false);
  });
});
