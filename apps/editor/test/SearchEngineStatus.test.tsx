import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { SiteRegistrationEntry, SiteRegistrationView } from '@sitewright/schema';

/** The staff line under the Production URL: what each search engine made of the site, and nothing for no account. */

const getSiteRegistration = vi.fn<(projectId: string) => Promise<SiteRegistrationView>>();
vi.mock('../src/api', () => ({ api: { getSiteRegistration: (p: string) => getSiteRegistration(p) } }));

const { SearchEngineStatus } = await import('../src/views/settings/website/SearchEngineStatus');

const entry = (over: Partial<SiteRegistrationEntry> = {}): SiteRegistrationEntry => ({
  configured: true,
  status: 'none',
  detail: null,
  verifiedAt: null,
  checkedAt: null,
  ...over,
});
const view = (over: Partial<SiteRegistrationView> = {}): SiteRegistrationView => ({
  siteUrl: 'https://www.example.com/',
  notice: null,
  google: entry(),
  bing: entry(),
  ...over,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getSiteRegistration.mockReset();
});

describe('SearchEngineStatus', () => {
  it('says per search engine whether the site is verified, waiting, or refused and why', async () => {
    getSiteRegistration.mockResolvedValue(
      view({
        google: entry({ status: 'verified', verifiedAt: '2026-10-21T15:00:00.000Z' }),
        bing: entry({ status: 'failed', detail: 'Bing could not verify https://www.example.com/: it did not find the verification tag on the home page' }),
      }),
    );
    render(<SearchEngineStatus projectId="p1" siteUrl="https://www.example.com" />);
    const list = await screen.findByRole('list', { name: 'Search engine registration' });
    expect(list).toHaveTextContent(/Google Search Console: verified on .*2026/);
    expect(list).toHaveTextContent(
      'Bing Webmaster Tools: not registered. Bing could not verify https://www.example.com/: it did not find the verification tag on the home page. The next publish or deploy tries again.',
    );
    expect(getSiteRegistration).toHaveBeenCalledWith('p1');
  });

  it('lists only the search engines the platform has an account for, and nothing when it has none', async () => {
    getSiteRegistration.mockResolvedValue(view({ bing: entry({ configured: false }) }));
    const { unmount } = render(<SearchEngineStatus projectId="p1" siteUrl="https://www.example.com" />);
    const list = await screen.findByRole('list', { name: 'Search engine registration' });
    expect(list).toHaveTextContent('Google Search Console: registers at the next publish or deploy');
    expect(list).not.toHaveTextContent('Bing');
    unmount();

    getSiteRegistration.mockResolvedValue(view({ google: entry({ configured: false }), bing: entry({ configured: false }) }));
    const { container } = render(<SearchEngineStatus projectId="p1" siteUrl="https://www.example.com" />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('says an https Production URL is what gets registered', async () => {
    getSiteRegistration.mockResolvedValue(view({ siteUrl: null, notice: 'not-https' }));
    render(<SearchEngineStatus projectId="p1" siteUrl="http://www.example.com" />);
    expect(await screen.findByText('Only an https Production URL is registered with the platform’s Google and Bing accounts.')).toBeInTheDocument();
  });

  it('shows nothing when the read is refused (not agency staff, or an older instance)', async () => {
    getSiteRegistration.mockRejectedValue(new Error('forbidden'));
    const { container } = render(<SearchEngineStatus projectId="p1" siteUrl="https://www.example.com" />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('looks again while a search engine has not confirmed yet', async () => {
    vi.useFakeTimers();
    getSiteRegistration.mockResolvedValueOnce(view({ google: entry({ status: 'pending' }) })).mockResolvedValue(view({ google: entry({ status: 'verified' }) }));
    render(<SearchEngineStatus projectId="p1" siteUrl="https://www.example.com" />);
    await act(async () => {});
    expect(screen.getByRole('list')).toHaveTextContent('Google Search Console: waiting for it to confirm the published tag');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('list')).toHaveTextContent('Google Search Console: verified');
    expect(getSiteRegistration).toHaveBeenCalledTimes(2);
  });
});
