import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectRankings, RankKeywordView, RankTrackingAdminView } from '@sitewright/schema';

const api = vi.hoisted(() => ({
  getStats: vi.fn(),
  getRankings: vi.fn(),
  putRankSettings: vi.fn(),
  addRankKeywords: vi.fn(),
  setRankKeywordPaused: vi.fn(),
  removeRankKeyword: vi.fn(),
  checkRankingsNow: vi.fn(),
  searchRankLocations: vi.fn(),
  getRankTracking: vi.fn(),
  putRankTracking: vi.fn(),
  testRankProvider: vi.fn(),
  getSearchPerformanceAvailability: vi.fn(),
  getSearchPerformance: vi.fn(),
  getSiteRegistration: vi.fn(),
}));
vi.mock('../src/api', () => ({ api, downloadStatsCsv: vi.fn() }));

import { StatisticsTab } from '../src/views/stats/StatisticsTab';
import type { StatisticsAccess } from '../src/lib/statistics-enabled';
import { RankingsView } from '../src/views/stats/RankingsView';
import { RankChart } from '../src/views/stats/RankChart';
import { RankTrackingSettings, type RankTrackingSettingsHandle } from '../src/views/settings/RankTrackingSettings';

const project = { id: 'p1', name: 'Plumbers', slug: 'plumbers', role: 'owner' as const, siteUrl: 'https://www.plumbers.na/' };

function keyword(over: Partial<RankKeywordView> = {}): RankKeywordView {
  return {
    id: 'k1',
    keyword: 'plumber windhoek',
    engine: 'google',
    device: 'desktop',
    location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' },
    languageCode: 'en',
    paused: false,
    latest: { day: '2026-10-20', checkedAt: '2026-10-20T06:00:00.000Z', position: 3, url: 'https://www.plumbers.na/emergency/', depth: 100 },
    change: 2,
    best: 3,
    series: [
      { day: '2026-10-13', position: 5 },
      { day: '2026-10-20', position: 3 },
    ],
    pending: false,
    ...over,
  };
}

function rankings(over: Partial<ProjectRankings> = {}): ProjectRankings {
  return {
    from: '2026-07-23',
    to: '2026-10-20',
    tracking: { domain: 'plumbers.na', includeSubdomains: true, schedule: 'weekly', depth: 100 },
    keywords: [keyword(), keyword({ id: 'k2', keyword: 'geyser repair', latest: { day: '2026-10-20', checkedAt: '2026-10-20T06:00:00.000Z', position: null, url: null, depth: 100 }, change: null, best: null, series: [{ day: '2026-10-20', position: null }] })],
    canManage: false,
    configured: true,
    ...over,
  };
}

const minimalStats = {
  from: '2026-09-21',
  to: '2026-10-20',
  enabled: true,
  human: { views: 0, visitors: 0 },
  botViews: 0,
  daily: [{ day: '2026-10-20', views: 0, visitors: 0, botViews: 0 }],
  devices: [],
  countries: [],
  bots: [],
  pages: [],
  sources: [],
  goals: [],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStats.mockResolvedValue(minimalStats);
  api.searchRankLocations.mockResolvedValue({ locations: [] });
  api.getSearchPerformanceAvailability.mockResolvedValue({ services: [] });
  api.getSiteRegistration.mockRejectedValue(new Error('not staff'));
});

/** App's answer (useStatisticsAccess): which views the project has. Visits on, the rest not live, unless told. */
const access = (over: Partial<StatisticsAccess> = {}): StatisticsAccess => ({ statistics: true, rankings: false, search: [], ...over });

describe('the Statistics tab', () => {
  it('shows no rankings tab to a client whose site is not tracked', async () => {
    api.getRankings.mockResolvedValue(rankings({ tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} access={access()} />);
    await waitFor(() => expect(api.getRankings).toHaveBeenCalled());
    await screen.findByRole('group', { name: 'Visitors' });
    expect(screen.queryByRole('tab', { name: /Search rankings/ })).toBeNull();
  });

  it('offers the rankings next to the visits when the site is tracked', async () => {
    api.getRankings.mockResolvedValue(rankings());
    render(<StatisticsTab project={project} access={access({ rankings: true })} />);
    // The switcher is the prominent, SOLID bar (not the frosted one other tab strips use), centred.
    const bar = await screen.findByRole('tablist', { name: 'Statistics' });
    expect(bar).toHaveClass('bg-white', 'dark:bg-slate-800');
    expect(bar).not.toHaveClass('backdrop-blur-3xl');
    expect(bar.parentElement).toHaveClass('justify-center');
    fireEvent.click(await screen.findByRole('tab', { name: /Search rankings/ }));
    expect(await screen.findByRole('heading', { name: 'Search rankings' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: /Tracked keywords/ })).toBeInTheDocument();
  });

  it('does not tear down and refetch the visits when the rankings tab appears', async () => {
    api.getRankings.mockResolvedValue(rankings());
    const { rerender } = render(<StatisticsTab project={project} access={access({ rankings: undefined })} />);
    await screen.findByRole('group', { name: 'Visitors' });
    expect(api.getStats).toHaveBeenCalledTimes(1);
    rerender(<StatisticsTab project={project} access={access({ rankings: true })} />);
    expect(await screen.findByRole('tab', { name: /Search rankings/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Visitors' })).toBeInTheDocument();
    expect(api.getStats).toHaveBeenCalledTimes(1);
  });

  it('offers the search performance once a search engine verified the site, beside the others', async () => {
    api.getRankings.mockResolvedValue(rankings());
    api.getSearchPerformance.mockResolvedValue({
      service: 'bing',
      siteUrl: 'https://www.plumbers.na/',
      period: { days: 28, start: '2026-09-24', end: '2026-10-21' },
      totals: { clicks: 3, impressions: 40, ctr: 0.075, position: null },
      previous: null,
      daily: [],
      queries: [],
      pages: [],
      fetchedAt: '2026-10-21T10:00:00.000Z',
    });
    render(<StatisticsTab project={project} access={access({ rankings: true, search: ['bing'] })} />);
    const bar = await screen.findByRole('tablist', { name: 'Statistics' });
    await waitFor(() => expect(within(bar).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Visits', 'Search rankings', 'Search performance']));
    // Asked for ahead, while the visits show: the view it opens on is ready (or on its way) when it is opened.
    await waitFor(() => expect(api.getSearchPerformance).toHaveBeenCalledWith('p1', 'bing', 28));
    expect(screen.queryByRole('heading', { name: 'Search performance' })).toBeNull();
    fireEvent.click(within(bar).getByRole('tab', { name: /Search performance/ }));
    expect(await screen.findByRole('heading', { name: 'Search performance' })).toBeInTheDocument();
    await waitFor(() => expect(api.getSearchPerformance).toHaveBeenCalledWith('p1', 'bing', 28));
  });

  it('a search engine that refuses the numbers asked ahead changes nothing until the view is opened', async () => {
    api.getRankings.mockResolvedValue(rankings());
    api.getSearchPerformance.mockRejectedValue(new Error('Google is limiting requests; try again in a minute'));
    render(<StatisticsTab project={project} access={access({ rankings: true, search: ['google'] })} />);
    const bar = await screen.findByRole('tablist', { name: 'Statistics' });
    await waitFor(() => expect(api.getSearchPerformance).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull(); // the visits are not interrupted by it
    fireEvent.click(within(bar).getByRole('tab', { name: /Search performance/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google is limiting requests');
  });

  it('without the visit counter (a client, statistics off) the rankings are the whole tab', async () => {
    api.getRankings.mockResolvedValue(rankings());
    render(<StatisticsTab project={project} access={access({ statistics: false, rankings: true })} />);
    expect(await screen.findByRole('heading', { name: 'Search rankings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Visits/ })).toBeNull();
    expect(api.getStats).not.toHaveBeenCalled();
  });

  it('offers staff the tab to set tracking up', async () => {
    api.getRankings.mockResolvedValue(rankings({ tracking: null, keywords: [], canManage: true, status: 'no-provider', configured: false }));
    render(<StatisticsTab project={project} isStaff access={access()} />);
    fireEvent.click(await screen.findByRole('tab', { name: /Search rankings/ }));
    expect(await screen.findByRole('form', { name: 'Rank tracking setup' })).toBeInTheDocument();
    // The site URL is the suggested domain.
    expect(screen.getByLabelText('Domain the site is published at')).toHaveValue('www.plumbers.na');
  });
});

describe('what a client reads', () => {
  it('lists each keyword with its position, change, best and ranking page — and nothing to manage', async () => {
    api.getRankings.mockResolvedValue(rankings());
    render(<RankingsView project={project} />);
    const table = await screen.findByRole('table', { name: /Tracked keywords/ });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('plumber windhoek');
    expect(rows[1]).toHaveTextContent('Windhoek, Khomas Region, Namibia · Desktop · en');
    expect(rows[1]).toHaveTextContent('up2');
    expect(within(rows[1]!).getByRole('link', { name: '/emergency/' })).toHaveAttribute('href', 'https://www.plumbers.na/emergency/');
    expect(rows[2]).toHaveTextContent('Not in top 100');
    expect(screen.getByText(/plumbers\.na/, { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause|Resume|Remove|Check now|Setup/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Manage keywords/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /Manage keywords/ })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Add keywords' })).toBeNull();
    expect(screen.queryByText(/provider/)).toBeNull();
  });

  it('opens a keyword into a chart of its position, with the editor tooltip and no native one', async () => {
    api.getRankings.mockResolvedValue(rankings());
    const { container } = render(<RankingsView project={project} />);
    fireEvent.click(await screen.findByRole('button', { name: /plumber windhoek/ }));
    const chart = await screen.findByRole('img', { name: /plumber windhoek: 2 checks, best position 3/ });
    expect(container.querySelector('svg title')).toBeNull();
    fireEvent.mouseEnter(chart.querySelector('circle[data-day="2026-10-13"]')!);
    const tip = await screen.findByRole('tooltip');
    expect([...tip.children].map((c) => c.textContent)).toEqual(['Tue, 13 Oct 2026', 'Position 5']);
  });
});

describe('what staff manage', () => {
  it('says why nothing is checked', async () => {
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'budget-reached' }));
    render(<RankingsView project={project} />);
    expect(await screen.findByRole('status')).toHaveTextContent("This month's rank-tracking budget is used up");
  });

  it('keeps the results read-only for staff too: the keyword lifecycle lives in Manage keywords', async () => {
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok' }));
    render(<RankingsView project={project} />);
    const table = await screen.findByRole('table', { name: /Tracked keywords/ });
    expect(within(table).queryByRole('button', { name: /Pause|Resume|Remove/ })).toBeNull();
    expect(within(table).queryAllByRole('columnheader')).toHaveLength(6);
    // With keywords tracked the section starts folded, its summary and "Check now" still in view.
    const section = screen.getByRole('region', { name: /Manage keywords/ });
    expect(within(section).getByRole('button', { name: /Manage keywords/ })).toHaveAttribute('aria-expanded', 'false');
    expect(within(section).getByText('2 tracked')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(within(section).queryByRole('form', { name: 'Add keywords' })).toBeNull();
  });

  it('checks now, pauses, resumes and removes — all inside Manage keywords', async () => {
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok', keywords: [keyword(), keyword({ id: 'k2', keyword: 'geyser repair', paused: true })] }));
    api.checkRankingsNow.mockResolvedValue({ status: 'ok', sent: 2, collected: 0, failed: 0 });
    api.setRankKeywordPaused.mockResolvedValue({ ok: true });
    api.removeRankKeyword.mockResolvedValue({ ok: true });
    render(<RankingsView project={project} />);
    const section = await screen.findByRole('region', { name: /Manage keywords/ });
    expect(within(section).getByText('2 tracked, 1 paused')).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/Sent 2 checks/)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: /Manage keywords/ }));
    const list = within(section).getByRole('list', { name: 'Keywords to manage' });
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('geyser repairWindhoek, Khomas Region, Namibia · Desktop · enPaused');

    fireEvent.click(within(list).getByRole('button', { name: 'Pause plumber windhoek' }));
    await waitFor(() => expect(api.setRankKeywordPaused).toHaveBeenCalledWith('p1', 'k1', true));
    fireEvent.click(within(list).getByRole('button', { name: 'Resume geyser repair' }));
    await waitFor(() => expect(api.setRankKeywordPaused).toHaveBeenCalledWith('p1', 'k2', false));

    fireEvent.click(within(list).getByRole('button', { name: 'Remove geyser repair' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeRankKeyword).toHaveBeenCalledWith('p1', 'k2'));
    // Every change reads the rankings again (the first read, then pause, resume, remove, and the check).
    await waitFor(() => expect(api.getRankings).toHaveBeenCalledTimes(5));
  });

  it('does not remove a keyword the confirmation was cancelled for, and shows a refused change', async () => {
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok' }));
    api.setRankKeywordPaused.mockRejectedValue(new Error('only agency staff can change keyword tracking'));
    render(<RankingsView project={project} />);
    const section = await screen.findByRole('region', { name: /Manage keywords/ });
    fireEvent.click(within(section).getByRole('button', { name: /Manage keywords/ }));
    fireEvent.click(within(section).getByRole('button', { name: 'Remove geyser repair' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Pause plumber windhoek' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('only agency staff can change keyword tracking');
    expect(api.removeRankKeyword).not.toHaveBeenCalled();
  });

  it('filters a long keyword list', async () => {
    const many = Array.from({ length: 9 }, (_, i) => keyword({ id: `k${i}`, keyword: i === 4 ? 'geyser repair' : `plumber ${i}` }));
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok', keywords: many }));
    render(<RankingsView project={project} />);
    const section = await screen.findByRole('region', { name: /Manage keywords/ });
    fireEvent.click(within(section).getByRole('button', { name: /Manage keywords/ }));
    const list = within(section).getByRole('list', { name: 'Keywords to manage' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
    fireEvent.change(within(section).getByLabelText('Filter keywords'), { target: { value: 'GEYSER' } });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('geyser repair')]);
    fireEvent.change(within(section).getByLabelText('Filter keywords'), { target: { value: 'nothing' } });
    expect(within(list).getByRole('listitem')).toHaveTextContent('No keyword matches “nothing”.');
  });

  it('drops the filter when the list shrinks below the length that shows it', async () => {
    const many = Array.from({ length: 9 }, (_, i) => keyword({ id: `k${i}`, keyword: i === 4 ? 'geyser repair' : `plumber ${i}` }));
    api.getRankings.mockResolvedValueOnce(rankings({ canManage: true, status: 'ok', keywords: many }));
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok', keywords: many.filter((k) => k.id !== 'k4') }));
    api.removeRankKeyword.mockResolvedValue({ ok: true });
    render(<RankingsView project={project} />);
    const section = await screen.findByRole('region', { name: /Manage keywords/ });
    fireEvent.click(within(section).getByRole('button', { name: /Manage keywords/ }));
    fireEvent.change(within(section).getByLabelText('Filter keywords'), { target: { value: 'geyser' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Remove geyser repair' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    // Eight left: the filter input is gone, so its text no longer hides rows nobody could then clear.
    await waitFor(() => expect(within(section).queryByLabelText('Filter keywords')).toBeNull());
    expect(within(section).getAllByRole('listitem')).toHaveLength(8);
  });

  it('keeps a row busy until the list has been read again', async () => {
    api.getRankings.mockResolvedValueOnce(rankings({ canManage: true, status: 'ok' }));
    let reread: (v: ProjectRankings) => void = () => {};
    api.getRankings.mockImplementation(() => new Promise<ProjectRankings>((r) => (reread = r)));
    api.setRankKeywordPaused.mockResolvedValue({ ok: true });
    render(<RankingsView project={project} />);
    const section = await screen.findByRole('region', { name: /Manage keywords/ });
    fireEvent.click(within(section).getByRole('button', { name: /Manage keywords/ }));
    const pause = within(section).getByRole('button', { name: 'Pause plumber windhoek' });
    fireEvent.click(pause);
    await waitFor(() => expect(api.setRankKeywordPaused).toHaveBeenCalledTimes(1));
    // The change is saved but the list still shows the old state: a second click must not send it again.
    expect(pause).toBeDisabled();
    fireEvent.click(pause);
    expect(api.setRankKeywordPaused).toHaveBeenCalledTimes(1);
    reread(rankings({ canManage: true, status: 'ok', keywords: [keyword({ paused: true }), keyword({ id: 'k2', keyword: 'geyser repair' })] }));
    expect(await within(section).findByRole('button', { name: 'Resume plumber windhoek' })).toBeEnabled();
  });

  it('adds keywords searched from a place chosen from the provider’s list', async () => {
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok', keywords: [] }));
    api.searchRankLocations.mockImplementation(async (_country: string, q: string) => ({
      locations: q
        ? [{ name: 'Windhoek,Khomas Region,Namibia', type: 'City', countryCode: 'NA' }]
        : [{ name: 'Namibia', type: 'Country', countryCode: 'NA' }],
    }));
    api.addRankKeywords.mockResolvedValue({ added: 2, existing: 0 });
    render(<RankingsView project={project} />);
    // Nothing tracked yet: Manage keywords is open on the form.
    const section = await screen.findByRole('region', { name: /Manage keywords/ });
    expect(within(section).getByText('none tracked yet')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Check now' })).toBeNull();
    const form = within(section).getByRole('form', { name: 'Add keywords' });
    fireEvent.change(within(form).getByLabelText('Keywords, one per line'), { target: { value: 'plumber windhoek\n\nemergency plumber\n' } });
    // Country, Searched from and Language are searchable pickers; their lists are portalled to the body.
    fireEvent.click(within(form).getByRole('combobox', { name: 'Country' }));
    fireEvent.change(screen.getByLabelText('Search Country'), { target: { value: 'namib' } });
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Country' })).getByText('Namibia'));
    // The country itself is the starting place.
    const place = within(form).getByRole('combobox', { name: 'Searched from' });
    await waitFor(() => expect(place).toHaveTextContent('NamibiaCountry'));
    fireEvent.click(place);
    fireEvent.change(screen.getByLabelText('Search places'), { target: { value: 'wind' } });
    fireEvent.click(await within(screen.getByRole('listbox', { name: 'Searched from' })).findByText('Windhoek, Khomas Region, Namibia'));
    expect(place).toHaveTextContent('Windhoek, Khomas Region, NamibiaCity');
    fireEvent.click(within(form).getByRole('radio', { name: 'Mobile' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add 2 keywords' }));
    await waitFor(() =>
      expect(api.addRankKeywords).toHaveBeenCalledWith('p1', {
        keywords: ['plumber windhoek', 'emergency plumber'],
        location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' },
        languageCode: 'en',
        device: 'mobile',
      }),
    );
    expect(await screen.findByText(/Added 2 keywords\./)).toBeInTheDocument();
  });
});

describe('RankChart', () => {
  it('marks a check outside the results on the bottom line and breaks the line there', () => {
    const { container } = render(
      <RankChart
        keyword="k"
        from="2026-10-01"
        to="2026-10-31"
        depth={100}
        series={[
          { day: '2026-10-01', position: 10 },
          { day: '2026-10-08', position: 8 },
          { day: '2026-10-15', position: null },
          { day: '2026-10-22', position: 4 },
        ]}
      />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(1); // only the 10→8 run has two points
    const missing = container.querySelector('circle[data-day="2026-10-15"]')!;
    expect(Number(missing.getAttribute('cy'))).toBe(180 - 22);
    expect(screen.getByRole('img')).toHaveAccessibleName('k: 4 checks, best position 4, latest position 4');
  });

  it('keeps an older, deeper position on the chart rather than pinning it to the bottom', () => {
    const { container } = render(
      <RankChart keyword="k" from="2026-10-01" to="2026-10-31" depth={10} series={[{ day: '2026-10-01', position: 40 }, { day: '2026-10-08', position: null }, { day: '2026-10-15', position: 6 }]} />,
    );
    const deep = Number(container.querySelector('circle[data-day="2026-10-01"]')!.getAttribute('cy'));
    const miss = Number(container.querySelector('circle[data-day="2026-10-08"]')!.getAttribute('cy'));
    expect(deep).toBeLessThan(miss); // 40 sits above the "not in the results" line of a 50-deep axis
    expect(screen.getByRole('img')).toHaveAccessibleName('k: 3 checks, best position 6, latest position 6');
  });
});

describe('System Settings: rank tracking', () => {
  const view: RankTrackingAdminView = {
    activeProvider: null,
    monthlyBudgetUsd: 10,
    spentThisMonthUsd: 0.006,
    projectsTracked: 1,
    keywordsTracked: 3,
    lastError: { message: 'The DataForSEO balance is too low; add funds to the account', at: '2026-10-20T06:00:00.000Z' },
    providers: [
      {
        id: 'dataforseo',
        label: 'DataForSEO',
        signupUrl: 'https://app.dataforseo.com/register',
        configured: true,
        values: { login: 'api@agency.test' },
        secretsSet: { password: true },
        fields: [
          { key: 'login', label: 'API login', type: 'text', required: true },
          { key: 'password', label: 'API password', type: 'secret', required: true },
          { key: 'environment', label: 'Searches', type: 'select', required: false, options: [{ value: 'production', label: 'Live' }, { value: 'sandbox', label: 'Sandbox' }] },
        ],
      },
    ],
  };

  it('shows the spend and the last refusal, never a secret, and saves only what changed', async () => {
    api.getRankTracking.mockResolvedValue(view);
    api.putRankTracking.mockResolvedValue({ ...view, activeProvider: 'dataforseo', monthlyBudgetUsd: 25 });
    const ref = createRef<RankTrackingSettingsHandle>();
    render(<RankTrackingSettings ref={ref} />);
    expect(await screen.findByText(/\$0\.006 spent this month · 3 keywords in 1 project$/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('balance is too low');

    // Nothing changed: nothing sent.
    await act(async () => ref.current!.save());
    expect(api.putRankTracking).not.toHaveBeenCalled();

    // An emptied budget is a mistake, caught before any save.
    fireEvent.change(screen.getByLabelText('Monthly budget in US dollars'), { target: { value: '' } });
    expect(ref.current!.validate()).toMatch(/budget must be a number/);

    fireEvent.change(screen.getByLabelText('Rank tracking provider'), { target: { value: 'dataforseo' } });
    // The select shows the default the server assumes, and saving it untouched would not send it.
    expect(screen.getByLabelText('Searches')).toHaveValue('production');
    expect(screen.getByLabelText('API password')).toHaveValue('');
    expect(screen.getByLabelText('API password')).toHaveAttribute('placeholder', '•••••• (leave blank to keep)');
    fireEvent.change(screen.getByLabelText('Monthly budget in US dollars'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Searches'), { target: { value: 'sandbox' } });
    await act(async () => ref.current!.save());
    expect(api.putRankTracking).toHaveBeenCalledWith({
      activeProvider: 'dataforseo',
      monthlyBudgetUsd: 25,
      credentials: { dataforseo: { environment: 'sandbox' } },
    });
  });

  it('tests the saved credentials and shows the balance', async () => {
    api.getRankTracking.mockResolvedValue({ ...view, activeProvider: 'dataforseo', lastError: null });
    api.testRankProvider.mockResolvedValue({ ok: true, balanceUsd: 48.25 });
    render(<RankTrackingSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test saved credentials' }));
    expect(await screen.findByText('✓ Connected · balance $48.25')).toBeInTheDocument();
  });
});
