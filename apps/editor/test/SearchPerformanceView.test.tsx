import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SearchPerformanceView as View } from '@sitewright/schema';

/**
 * Statistics → Search performance: the figures against the period before (a lower position is the better one),
 * clicks and impressions per day, the top searches and pages, the search engine and period choices, and what it
 * says when a search engine has nothing yet or refused.
 */

const api = vi.hoisted(() => ({ getSearchPerformance: vi.fn() }));
vi.mock('../src/api', () => ({ api }));

import { SearchPerformanceView } from '../src/views/stats/SearchPerformanceView';

const SITE = 'https://www.example.com/';
const view = (over: Partial<View> = {}): View => ({
  service: 'google',
  siteUrl: SITE,
  period: { days: 28, start: '2026-09-24', end: '2026-10-21' },
  totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 7.4 },
  previous: { clicks: 80, impressions: 5000, ctr: 0.016, position: 9.1 },
  daily: [
    { date: '2026-10-18', clicks: 5, impressions: 100 },
    { date: '2026-10-19', clicks: 0, impressions: 0 },
  ],
  queries: [{ key: 'roofing windhoek', clicks: 40, impressions: 600, ctr: 0.0667, position: 3.2 }],
  pages: [{ key: `${SITE}services/roofing/`, clicks: 30, impressions: 500, ctr: 0.06, position: 4.1 }],
  fetchedAt: '2026-10-21T10:00:00.000Z',
  ...over,
});

beforeEach(() => api.getSearchPerformance.mockReset());

describe('Search performance', () => {
  it('shows the figures against the period before — a lower position is better', async () => {
    api.getSearchPerformance.mockResolvedValue(view());
    render(<SearchPerformanceView projectId="p1" services={['google']} />);
    const clicks = await screen.findByRole('group', { name: 'Clicks' });
    expect(clicks).toHaveTextContent('120');
    expect(within(clicks).getByText(/80 before/).closest('span')).toHaveClass('text-emerald-700');
    expect(within(screen.getByRole('group', { name: 'Impressions' })).getByText(/5,000 before/).closest('span')).toHaveClass('text-rose-700');
    expect(screen.getByRole('group', { name: 'Click-through rate' })).toHaveTextContent('3.0%');
    const pos = screen.getByRole('group', { name: 'Average position' });
    expect(pos).toHaveTextContent('7.4');
    expect(within(pos).getByText(/9.1 before/).closest('span')).toHaveClass('text-emerald-700'); // 9.1 → 7.4 is up the results
    expect(screen.queryByRole('radiogroup', { name: 'Search engine' })).toBeNull(); // one search engine: no choice
    expect(api.getSearchPerformance).toHaveBeenCalledWith('p1', 'google', 28);
  });

  it('shows the shape of the numbers, and a spinner in its title bar, while a search engine answers', async () => {
    let answer!: (v: View) => void;
    api.getSearchPerformance.mockImplementationOnce(() => new Promise<View>((r) => (answer = r)));
    render(<SearchPerformanceView projectId="p1" services={['google']} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Asking Google…');
    expect(status.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByTestId('search-performance-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Clicks' })).toBeNull();
    answer(view());
    expect(await screen.findByRole('group', { name: 'Clicks' })).toHaveTextContent('120');
    expect(screen.queryByTestId('search-performance-skeleton')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Another period: the numbers on screen stay (dimmed), and the spinner comes back until it answers.
    let next!: (v: View) => void;
    api.getSearchPerformance.mockImplementationOnce(() => new Promise<View>((r) => (next = r)));
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    expect(screen.getByRole('status')).toHaveTextContent('Asking Google…');
    expect(screen.queryByTestId('search-performance-skeleton')).toBeNull();
    expect(screen.getByRole('group', { name: 'Clicks' }).parentElement?.parentElement).toHaveClass('opacity-50');
    next(view({ totals: { clicks: 7, impressions: 70, ctr: 0.1, position: 2 } }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Clicks' })).toHaveTextContent('7'));
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('charts the days and lists the top searches and pages, a page as its path', async () => {
    api.getSearchPerformance.mockResolvedValue(view());
    render(<SearchPerformanceView projectId="p1" services={['google']} />);
    expect(await screen.findByRole('img', { name: /Clicks and impressions per day from .*: 5 clicks, 100 impressions/ })).toBeInTheDocument();
    const searches = screen.getByRole('region', { name: 'Top searches' });
    expect(within(searches).getByRole('row', { name: /roofing windhoek 40 600 6.7% 3.2/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Top pages' })).getByText('/services/roofing/')).toBeInTheDocument();
    expect(screen.getByText(/From the platform’s Google Search Console. The newest days can still change./)).toBeInTheDocument();
  });

  it('links every page to its live address in a new tab, and never a search', async () => {
    const row = { clicks: 1, impressions: 10, ctr: 0.1, position: 5 };
    api.getSearchPerformance.mockResolvedValue(
      view({
        pages: [
          { key: `${SITE}services/roofing/`, ...row },
          { key: 'https://blog.example.com/post', ...row }, // another host: still a page, shown in full
          { key: '/contact/', ...row }, // a relative address: resolved against the site
          // The page list is the search engine's text. A scheme that would run script is never a link.
          { key: 'javascript:alert(1)', ...row },
        ],
      }),
    );
    render(<SearchPerformanceView projectId="p1" services={['google']} />);
    const pages = await screen.findByRole('region', { name: 'Top pages' });
    const roofing = within(pages).getByRole('link', { name: /^\/services\/roofing\/ ?\(opens in a new tab\)$/ });
    expect(roofing).toHaveAttribute('href', `${SITE}services/roofing/`);
    expect(roofing).toHaveAttribute('target', '_blank');
    expect(roofing).toHaveAttribute('rel', 'noopener noreferrer');
    // The editor's tooltip still carries the whole address (the cell shows the path).
    expect(roofing.closest('[data-tip]')).toHaveAttribute('data-tip', `${SITE}services/roofing/`);
    expect(within(pages).getByRole('link', { name: /^https:\/\/blog\.example\.com\/post/ })).toHaveAttribute('href', 'https://blog.example.com/post');
    expect(within(pages).getByRole('link', { name: /^\/contact\// })).toHaveAttribute('href', `${SITE}contact/`);
    expect(within(pages).getAllByRole('link')).toHaveLength(3);
    expect(within(pages).getByText('javascript:alert(1)').closest('a')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Top searches' })).queryByRole('link')).toBeNull();
  });

  it('never shows an address on a look-alike host as a path on the site', async () => {
    // A site URL saved without its trailing slash used to prefix `https://www.example.com.evil.net/…` as text.
    const row = { clicks: 1, impressions: 10, ctr: 0.1, position: 5 };
    api.getSearchPerformance.mockResolvedValue(
      view({
        siteUrl: 'https://www.example.com',
        pages: [
          { key: 'https://www.example.com/services/', ...row },
          { key: 'https://www.example.com.evil.net/x', ...row },
        ],
      }),
    );
    render(<SearchPerformanceView projectId="p1" services={['google']} />);
    const pages = await screen.findByRole('region', { name: 'Top pages' });
    expect(within(pages).getByRole('link', { name: /^\/services\// })).toHaveAttribute('href', 'https://www.example.com/services/');
    const lookalike = within(pages).getByRole('link', { name: /evil\.net/ });
    expect(lookalike).toHaveTextContent('https://www.example.com.evil.net/x');
    expect(lookalike).toHaveAttribute('href', 'https://www.example.com.evil.net/x');
  });

  it('switches the search engine and the period', async () => {
    api.getSearchPerformance.mockImplementation(async (_p: string, service: 'google' | 'bing', days: number) =>
      view({ service, period: { days: days as 7, start: '2026-10-15', end: '2026-10-21' }, totals: { clicks: 9, impressions: 90, ctr: 0.1, position: null }, previous: null }),
    );
    render(<SearchPerformanceView projectId="p1" services={['google', 'bing']} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Bing' }));
    await waitFor(() => expect(api.getSearchPerformance).toHaveBeenLastCalledWith('p1', 'bing', 28));
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    await waitFor(() => expect(api.getSearchPerformance).toHaveBeenLastCalledWith('p1', 'bing', 90));
    expect(await screen.findByText(/Bing updates searches and pages once a week, and gives no overall position./)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Average position' })).toHaveTextContent('—');
  });

  it('says when a search engine has nothing yet, and when it refused', async () => {
    api.getSearchPerformance.mockResolvedValueOnce(
      view({ totals: { clicks: 0, impressions: 0, ctr: null, position: null }, previous: null, daily: [], queries: [], pages: [] }),
    );
    const { unmount } = render(<SearchPerformanceView projectId="p1" services={['google']} />);
    expect(await screen.findByRole('note')).toHaveTextContent('Google has no searches for this site in this period yet. A newly verified site takes a few days to show data.');
    unmount();
    api.getSearchPerformance.mockRejectedValueOnce(new Error('Google is unavailable (HTTP 503)'));
    render(<SearchPerformanceView projectId="p1" services={['google']} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Google is unavailable (HTTP 503)');
  });
});
