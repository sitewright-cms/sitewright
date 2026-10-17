import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { projectPaymentGateways, getProjectPayment, putProjectPayment, putProjectPaymentMode, deleteProjectPayment, listGatewayDefinitions } = vi.hoisted(() => ({
  listGatewayDefinitions: vi.fn(),
  projectPaymentGateways: vi.fn(),
  getProjectPayment: vi.fn(),
  putProjectPayment: vi.fn(),
  putProjectPaymentMode: vi.fn(),
  deleteProjectPayment: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    projectPaymentGateways: (p: string) => projectPaymentGateways(p),
    getProjectPayment: (p: string) => getProjectPayment(p),
    putProjectPayment: (p: string, b: unknown) => putProjectPayment(p, b),
    putProjectPaymentMode: (p: string, m: string, g: string) => putProjectPaymentMode(p, m, g),
    deleteProjectPayment: (p: string, g: string) => deleteProjectPayment(p, g),
    listGatewayDefinitions: () => listGatewayDefinitions(),
  },
}));

import { PaymentCredentialsModal } from '../src/views/settings/PaymentCredentialsModal';

/**
 * A project may hold keys for SEVERAL payment providers — each checkout channel names the one it
 * charges through — so the dialog edits one provider at a time, each with its own mode and webhook.
 */
const field = { key: 'apiKey', label: 'API key', kind: 'secret', required: true, perMode: true };
const gateways = [
  { id: 'stripe', name: 'Stripe', credentialFields: [field], refunds: true },
  { id: 'mollie', name: 'Mollie', credentialFields: [field], refunds: true },
];
const binding = (gatewayId: string, mode: 'test' | 'live') => ({
  gatewayId,
  mode,
  fields: { test: [{ key: 'apiKey', hasValue: true, display: '••••' }], live: [{ key: 'apiKey', hasValue: mode === 'live', display: '••••' }] },
  missing: [],
  orphaned: [],
  complete: true,
  webhookUrl: `https://sw.test/pay/p/webhook/${gatewayId}`,
});

beforeEach(() => {
  for (const m of [projectPaymentGateways, getProjectPayment, putProjectPayment, putProjectPaymentMode, deleteProjectPayment, listGatewayDefinitions]) m.mockReset();
  // Not an instance admin, unless a test says otherwise.
  listGatewayDefinitions.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  projectPaymentGateways.mockResolvedValue({ gateways });
  getProjectPayment.mockResolvedValue({ bindings: [binding('mollie', 'test'), binding('stripe', 'live')] });
  putProjectPayment.mockResolvedValue({});
  putProjectPaymentMode.mockResolvedValue({});
  deleteProjectPayment.mockResolvedValue(undefined);
});

const picker = () => screen.getByLabelText('Provider') as HTMLSelectElement;

describe('PaymentCredentialsModal — several providers', () => {
  it('says which providers are set up, and shows each one’s own mode and webhook URL', async () => {
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().value).toBe('mollie'));
    expect([...picker().options].map((o) => o.textContent)).toEqual(['Stripe — set up (live)', 'Mollie — set up (test)']);
    expect(screen.getByText(/Mollie is in/)).toHaveTextContent('Mollie is in test mode.');
    expect(screen.getByText('https://sw.test/pay/p/webhook/mollie')).toBeInTheDocument();

    fireEvent.change(picker(), { target: { value: 'stripe' } });
    expect(screen.getByText(/Stripe is in/)).toHaveTextContent('Stripe is in live mode.');
    expect(screen.getByText('https://sw.test/pay/p/webhook/stripe')).toBeInTheDocument();
  });

  it('★ switches the mode of the provider in view — by name', async () => {
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().value).toBe('mollie'));
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    await waitFor(() => expect(putProjectPaymentMode).toHaveBeenCalledWith('p', 'live', 'mollie'));
  });

  it('removes only the provider in view, after asking', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().value).toBe('mollie'));
    fireEvent.change(picker(), { target: { value: 'stripe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove these keys' }));
    await waitFor(() => expect(deleteProjectPayment).toHaveBeenCalledWith('p', 'stripe'));
  });

  it('a provider that is not set up offers no removal and says so', async () => {
    getProjectPayment.mockResolvedValue({ bindings: [binding('stripe', 'test')] });
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().value).toBe('stripe'));
    fireEvent.change(picker(), { target: { value: 'mollie' } });
    expect(screen.getByText('Mollie is not set up for this project yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove these keys' })).not.toBeInTheDocument();
  });
});

describe('PaymentCredentialsModal — an instance admin proving a provider', () => {
  const definition = (id: string, name: string, verified: boolean) => ({
    id,
    name,
    enabled: true,
    verified,
    builtin: false,
    kind: 'declarative',
    apiBase: { test: `https://api.${id}.example/v1`, live: `https://api.${id}.example/v1` },
    allowedOrigins: [`https://api.${id}.example`, `https://checkout.${id}.example`],
    credentialFields: [field],
    auth: { kind: 'none' },
    checkout: { request: { method: 'POST', path: '/s', format: 'json', headers: {} }, refPath: 'id', redirectUrlPath: 'url' },
    verification: { scheme: 'remote-verify', path: '/v', resultPath: 'ok', successValue: 'yes' },
    events: { refPath: 'id', types: {} },
  });

  it('★ offers a provider that is enabled but not proven yet — the only way to enter its test keys here', async () => {
    getProjectPayment.mockResolvedValue({ bindings: [] });
    listGatewayDefinitions.mockResolvedValue({ gateways: [definition('stripe', 'Stripe', true), definition('acme', 'Acme Pay', false)] });
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect([...picker().options].map((o) => o.textContent)).toEqual(['Stripe — not set up', 'Mollie — not set up', 'Acme Pay (not proven yet) — not set up']));
  });

  it('★ shows where the provider in view sends the keys and the buyer, before anyone proves it', async () => {
    getProjectPayment.mockResolvedValue({ bindings: [] });
    listGatewayDefinitions.mockResolvedValue({ gateways: [definition('stripe', 'Stripe', true), definition('acme', 'Acme Pay', false)] });
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().options).toHaveLength(3));
    fireEvent.change(picker(), { target: { value: 'acme' } });
    expect(screen.getByText(/Not proven yet/)).toBeInTheDocument();
    expect(screen.getByText(/Test keys are sent to/)).toHaveTextContent('Test keys are sent to https://api.acme.example, live keys to https://api.acme.example.');
    expect(screen.getByText(/Buyers may be sent to/)).toHaveTextContent('https://api.acme.example, https://checkout.acme.example');
  });

  it('★ says in red when a definition named like a built-in reaches other addresses — and what it counts as paid', async () => {
    getProjectPayment.mockResolvedValue({ bindings: [] });
    const lookalike = {
      ...definition('stripe_eu', 'Stripe', false),
      forkedFrom: 'stripe',
      events: { refPath: 'id', typePath: 'type', types: { 'payment.failed': 'paid', 'checkout.session.completed': 'paid' } },
    };
    // The proven built-in is stored (builtin:false after a proof) — only `shipped` says what is real.
    const shipped = { name: 'Stripe Checkout', apiBase: definition('stripe', 'Stripe', true).apiBase, allowedOrigins: definition('stripe', 'Stripe', true).allowedOrigins };
    // A sibling the same author wrote, with the same hostile addresses, must not vouch for the lookalike.
    const sibling = { ...definition('evil_src', 'Evil', false), enabled: false };
    listGatewayDefinitions.mockResolvedValue({
      gateways: [{ ...definition('stripe', 'Stripe', true), builtin: false, shipped }, { ...lookalike, forkedFrom: 'stripe' }, { ...definition('acme', 'Stripe', false) }, sibling, { ...definition('stripe_two', 'Payments', false), forkedFrom: 'evil_src' }],
    });
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().options).toHaveLength(5));
    // Forked from the built-in, on other addresses.
    fireEvent.change(picker(), { target: { value: 'stripe_eu' } });
    expect(screen.getByRole('alert')).toHaveTextContent('These addresses differ from Stripe Checkout (stripe): https://api.stripe.example, https://checkout.stripe.example');
    expect(screen.getByText(/An order counts as paid on/)).toHaveTextContent('webhook "payment.failed", webhook "checkout.session.completed"');
    // Not forked, but NAMED like the built-in — the same red line.
    fireEvent.change(picker(), { target: { value: 'acme' } });
    expect(screen.getByRole('alert')).toHaveTextContent('These addresses differ from Stripe Checkout (stripe)');
    // forkedFrom naming an author-written sibling is no reference at all: nothing to compare, no false all-clear claimed.
    fireEvent.change(picker(), { target: { value: 'stripe_two' } });
    expect(screen.queryByRole('alert')).toBeNull();
    // The proven built-in itself raises no alarm.
    fireEvent.change(picker(), { target: { value: 'stripe' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows none of it to anyone else — and only proven providers', async () => {
    render(<PaymentCredentialsModal projectId="p" onClose={() => {}} />);
    await waitFor(() => expect(picker().value).toBe('mollie'));
    expect(picker().options).toHaveLength(2);
    expect(screen.queryByText(/Test keys are sent to/)).toBeNull();
  });
});
