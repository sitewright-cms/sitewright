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
}));
vi.mock('../src/api', () => ({ api, downloadStatsCsv: vi.fn() }));

import { StatisticsTab } from '../src/views/stats/StatisticsTab';
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
});

describe('the Statistics tab', () => {
  it('shows no rankings tab to a client whose site is not tracked', async () => {
    api.getRankings.mockResolvedValue(rankings({ tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} />);
    await waitFor(() => expect(api.getRankings).toHaveBeenCalled());
    await screen.findByRole('group', { name: 'Visitors' });
    expect(screen.queryByRole('tab', { name: /Search rankings/ })).toBeNull();
  });

  it('offers the rankings next to the visits when the site is tracked', async () => {
    api.getRankings.mockResolvedValue(rankings());
    render(<StatisticsTab project={project} />);
    // The switcher is the prominent, SOLID bar (not the frosted one other tab strips use), centred.
    const bar = await screen.findByRole('tablist', { name: 'Statistics' });
    expect(bar).toHaveClass('bg-white', 'dark:bg-slate-800');
    expect(bar).not.toHaveClass('backdrop-blur-3xl');
    expect(bar.parentElement).toHaveClass('justify-center');
    fireEvent.click(await screen.findByRole('tab', { name: /Search rankings/ }));
    expect(await screen.findByRole('heading', { name: 'Search rankings' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Tracked keywords/ })).toBeInTheDocument();
  });

  it('does not tear down and refetch the visits when the rankings tab appears', async () => {
    let answer!: (r: ProjectRankings) => void;
    api.getRankings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<StatisticsTab project={project} />);
    await screen.findByRole('group', { name: 'Visitors' });
    expect(api.getStats).toHaveBeenCalledTimes(1);
    await act(async () => answer(rankings()));
    expect(await screen.findByRole('tab', { name: /Search rankings/ })).toBeInTheDocument();
    expect(api.getStats).toHaveBeenCalledTimes(1);
  });

  it('without the visit counter (a client, statistics off) the rankings are the whole tab', async () => {
    api.getRankings.mockResolvedValue(rankings());
    render(<StatisticsTab project={project} visitsAvailable={false} />);
    expect(await screen.findByRole('heading', { name: 'Search rankings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Visits/ })).toBeNull();
    expect(api.getStats).not.toHaveBeenCalled();
  });

  it('offers staff the tab to set tracking up', async () => {
    api.getRankings.mockResolvedValue(rankings({ tracking: null, keywords: [], canManage: true, status: 'no-provider' }));
    render(<StatisticsTab project={project} />);
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
    fireEvent.change(within(form).getByLabelText('Country'), { target: { value: 'NA' } });
    // The country itself is the starting place.
    await within(form).findByText('Namibia · Country');
    const place = within(form).getByRole('combobox', { name: 'Searched from' });
    fireEvent.focus(place);
    fireEvent.change(place, { target: { value: 'wind' } });
    fireEvent.click(await within(form).findByRole('button', { name: /Windhoek, Khomas Region, Namibia/ }));
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

describe('the place picker', () => {
  async function staffForm() {
    api.getRankings.mockResolvedValue(rankings({ canManage: true, status: 'ok', keywords: [] }));
    render(<RankingsView project={project} />);
    return screen.findByRole('form', { name: 'Add keywords' });
  }

  it('keeps the country as the place even when the field is focused before the list answers', async () => {
    let answer!: (r: { locations: Array<{ name: string; type: string; countryCode: string }> }) => void;
    api.searchRankLocations.mockImplementation((_c: string, q: string) =>
      q === '' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve({ locations: [] }),
    );
    const form = await staffForm();
    fireEvent.change(within(form).getByLabelText('Country'), { target: { value: 'NA' } });
    const place = within(form).getByRole('combobox', { name: 'Searched from' });
    fireEvent.focus(place);
    await act(async () => answer({ locations: [{ name: 'Namibia', type: 'Country', countryCode: 'NA' }] }));
    await waitFor(() => expect(place).toHaveAttribute('placeholder', 'Namibia'));
    fireEvent.change(within(form).getByLabelText('Keywords, one per line'), { target: { value: 'plumber' } });
    expect(within(form).getByRole('button', { name: 'Add keyword' })).toBeEnabled();
  });

  it('never offers the previous country\u2019s places after the country changes', async () => {
    api.searchRankLocations.mockImplementation(async (country: string, q: string) => ({
      locations: q ? [{ name: `${country}-place`, type: 'City', countryCode: country }] : [{ name: country, type: 'Country', countryCode: country }],
    }));
    const form = await staffForm();
    fireEvent.change(within(form).getByLabelText('Country'), { target: { value: 'NA' } });
    const place = within(form).getByRole('combobox', { name: 'Searched from' });
    fireEvent.focus(place);
    fireEvent.change(place, { target: { value: 'p' } });
    await within(form).findByRole('button', { name: /NA-place/ });
    fireEvent.change(within(form).getByLabelText('Country'), { target: { value: 'DE' } });
    expect(within(form).queryByRole('button', { name: /NA-place/ })).toBeNull();
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
