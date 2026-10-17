import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { projectPaymentGateways, getProjectPayment, putProjectPayment, putProjectPaymentMode, deleteProjectPayment } = vi.hoisted(() => ({
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
  for (const m of [projectPaymentGateways, getProjectPayment, putProjectPayment, putProjectPaymentMode, deleteProjectPayment]) m.mockReset();
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
