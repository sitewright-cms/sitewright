import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { listProjectDomains, claimProjectDomain, verifyProjectDomain, forceVerifyProjectDomain, setPrimaryProjectDomain, releaseProjectDomain } =
  vi.hoisted(() => ({
    listProjectDomains: vi.fn(),
    claimProjectDomain: vi.fn(),
    verifyProjectDomain: vi.fn(),
    forceVerifyProjectDomain: vi.fn(),
    setPrimaryProjectDomain: vi.fn(),
    releaseProjectDomain: vi.fn(),
  }));
const { confirmFn } = vi.hoisted(() => ({ confirmFn: vi.fn() }));

vi.mock('../src/api', () => ({
  // ★ Mirrors the REAL constructor `(status, message, …)`. A single-argument stub passes at runtime
  // (the panel only reads `.message`) while failing typecheck against the real class — and worse, it
  // would put the STATUS in `message` the moment a caller passed both.
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: {
    listProjectDomains: (p: string) => listProjectDomains(p),
    claimProjectDomain: (p: string, h: string) => claimProjectDomain(p, h),
    verifyProjectDomain: (p: string, i: string) => verifyProjectDomain(p, i),
    forceVerifyProjectDomain: (p: string, i: string) => forceVerifyProjectDomain(p, i),
    setPrimaryProjectDomain: (p: string, i: string) => setPrimaryProjectDomain(p, i),
    releaseProjectDomain: (p: string, i: string) => releaseProjectDomain(p, i),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: (o: unknown) => confirmFn(o), prompt: vi.fn(), dialog: null }) }));

import { CustomDomainsPanel } from '../src/views/publish/CustomDomainsPanel';

function domain(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd1',
    host: 'www.client.com',
    isPrimary: true,
    verified: false,
    verificationToken: 'sw-verify-tok',
    verifiedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    dns: { type: 'TXT', name: '_sitewright.www.client.com', value: 'sw-verify-tok' },
    ...over,
  };
}

beforeEach(() => {
  for (const m of [listProjectDomains, claimProjectDomain, verifyProjectDomain, forceVerifyProjectDomain, setPrimaryProjectDomain, releaseProjectDomain, confirmFn]) m.mockReset();
  listProjectDomains.mockResolvedValue({ items: [] });
});

describe('CustomDomainsPanel', () => {
  it('shows the exact DNS record to publish for an unverified domain', async () => {
    // The panel must not make the operator assemble `_sitewright.<host>` themselves.
    listProjectDomains.mockResolvedValue({ items: [domain()] });
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    expect(await screen.findByText('_sitewright.www.client.com')).toBeInTheDocument();
    expect(screen.getByText('sw-verify-tok')).toBeInTheDocument();
    expect(screen.getByText('not serving yet')).toBeInTheDocument();
  });

  it('★ reports a not-yet-propagated record as neutral status, not an error', async () => {
    // A TXT record that has not propagated is the expected first answer. Showing it in red would send
    // the operator editing DNS that is already correct.
    listProjectDomains.mockResolvedValue({ items: [domain()] });
    verifyProjectDomain.mockResolvedValue({ verified: false, state: 'pending', detail: 'no TXT record found yet', domain: domain() });
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check DNS' }));
    const msg = await screen.findByText('no TXT record found yet');
    expect(msg.className).not.toMatch(/rose/);
    expect(msg.className).toMatch(/slate/);
  });

  it('reports a WRONG record value in an error tone (that one is actionable)', async () => {
    listProjectDomains.mockResolvedValue({ items: [domain()] });
    verifyProjectDomain.mockResolvedValue({ verified: false, state: 'failed', detail: 'not the expected value', domain: domain() });
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check DNS' }));
    expect((await screen.findByText('not the expected value')).className).toMatch(/rose/);
  });

  it('a verified domain states that the certificate is the proxy’s job', async () => {
    // The platform routes the hostname but cannot issue TLS; saying so here beats a browser warning.
    listProjectDomains.mockResolvedValue({ items: [domain({ verified: true, verifiedAt: '2026-01-02T00:00:00Z' })] });
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    expect(await screen.findByText('verified')).toBeInTheDocument();
    expect(screen.getByText(/must hold a TLS certificate/)).toBeInTheDocument();
    // No DNS instructions once it is verified — they would be noise.
    expect(screen.queryByText('_sitewright.www.client.com')).not.toBeInTheDocument();
  });

  it('hides the force-verify escape hatch from non-staff and offers it to staff', async () => {
    listProjectDomains.mockResolvedValue({ items: [domain()] });
    const { unmount } = render(<CustomDomainsPanel projectId="p1" isStaff={false} />);
    await screen.findByRole('button', { name: 'Check DNS' });
    expect(screen.queryByRole('button', { name: 'Verify without DNS' })).not.toBeInTheDocument();
    unmount();

    render(<CustomDomainsPanel projectId="p1" isStaff />);
    expect(await screen.findByRole('button', { name: 'Verify without DNS' })).toBeInTheDocument();
  });

  it('force-verify asks for confirmation first and does nothing if declined', async () => {
    listProjectDomains.mockResolvedValue({ items: [domain()] });
    confirmFn.mockResolvedValue(false);
    render(<CustomDomainsPanel projectId="p1" isStaff />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verify without DNS' }));
    await waitFor(() => expect(confirmFn).toHaveBeenCalled());
    expect(forceVerifyProjectDomain).not.toHaveBeenCalled();
  });

  it('claims a hostname and reloads', async () => {
    claimProjectDomain.mockResolvedValue({ domain: domain() });
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    fireEvent.change(await screen.findByLabelText('Custom domain to add'), { target: { value: 'www.client.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
    await waitFor(() => expect(claimProjectDomain).toHaveBeenCalledWith('p1', 'www.client.com'));
    await waitFor(() => expect(listProjectDomains.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('surfaces a refused claim inline rather than silently doing nothing', async () => {
    const { ApiError } = await import('../src/api');
    claimProjectDomain.mockRejectedValue(new ApiError(409, 'is an address of this platform itself'));
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    fireEvent.change(await screen.findByLabelText('Custom domain to add'), { target: { value: 'cms.agency.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('is an address of this platform itself');
  });

  it('offers "Make primary" only on a verified non-primary domain', async () => {
    listProjectDomains.mockResolvedValue({
      items: [domain({ id: 'a', host: 'client.com', isPrimary: true, verified: true }), domain({ id: 'b', host: 'www.client.com', isPrimary: false, verified: true })],
    });
    render(<CustomDomainsPanel projectId="p1" isStaff={false} />);

    // Exactly one, awaited directly: the primary has nothing to promote, and the other row is the only
    // candidate. (Querying by host text would be ambiguous — a verified row prints its host twice, once
    // as the heading and once in the certificate note.)
    expect(await screen.findAllByRole('button', { name: 'Make primary' })).toHaveLength(1);
  });
});
