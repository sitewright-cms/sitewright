import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SiteStats, StatsQuery } from '@sitewright/schema';

const { getStats, downloadStatsCsv } = vi.hoisted(() => ({ getStats: vi.fn(), downloadStatsCsv: vi.fn() }));
vi.mock('../src/api', () => ({
  api: { getStats: (p: string, q: StatsQuery) => getStats(p, q) },
  downloadStatsCsv: (...args: unknown[]) => downloadStatsCsv(...args),
}));

import { StatsView } from '../src/views/stats/StatsView';
import { shadeOf } from '../src/views/stats/WorldMap';
import { pct, rangeDays } from '../src/views/stats/format';

const project = { id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' as const };

function stats(over: Partial<SiteStats> = {}): SiteStats {
  return {
    from: '2026-09-20',
    to: '2026-10-19',
    enabled: true,
    human: { views: 120, visitors: 40 },
    botViews: 80,
    daily: [
      { day: '2026-10-18', views: 70, visitors: 25, botViews: 50 },
      { day: '2026-10-19', views: 50, visitors: 15, botViews: 30 },
    ],
    devices: [
      { device: 'desktop', views: 80, visitors: 25 },
      { device: 'mobile', views: 35, visitors: 13 },
      { device: 'tablet', views: 5, visitors: 2 },
    ],
    countries: [
      { country: 'DE', views: 90, visitors: 30 },
      { country: 'US', views: 20, visitors: 8 },
      { country: 'ZZ', views: 10, visitors: 2 },
    ],
    bots: [
      { class: 'search', views: 50 },
      { class: 'ai', views: 30 },
    ],
    pages: [{ path: '/', views: 100, botViews: 60 }],
    sources: [
      { source: 'search', host: 'google.com', visitors: 20 },
      { source: 'direct', host: '', visitors: 20 },
    ],
    goals: [{ goal: 'form:contact', label: 'Contact us', count: 4 }],
    ...over,
  };
}

beforeEach(() => {
  getStats.mockReset();
  downloadStatsCsv.mockReset();
  getStats.mockResolvedValue(stats());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('StatsView', () => {
  it('shows the headline numbers, human and bot', async () => {
    render(<StatsView project={project} />);
    const kpi = (label: string) => screen.getByRole('group', { name: label });
    await screen.findByRole('group', { name: 'Visitors' });
    expect(kpi('Visitors')).toHaveTextContent('40');
    expect(kpi('Pageviews')).toHaveTextContent('120');
    expect(kpi('Pageviews')).toHaveTextContent('3.0 per visitor');
    expect(kpi('Bot pageviews')).toHaveTextContent('80');
    expect(kpi('Bot pageviews')).toHaveTextContent('40% of all traffic');
    expect(kpi('Goals')).toHaveTextContent('4');
    expect(kpi('Goals')).toHaveTextContent('10% of visitors');
  });

  it('asks for the last 30 days by default, and another period on request', async () => {
    render(<StatsView project={project} />);
    await screen.findByText('Visitors');
    expect(getStats).toHaveBeenLastCalledWith('p1', rangeDays('30d'));
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(getStats).toHaveBeenLastCalledWith('p1', rangeDays('7d')));
    expect(screen.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true');
  });

  it('★ filters by a device and a country, together, and clears each filter', async () => {
    render(<StatsView project={project} />);
    const devices = await screen.findByRole('region', { name: 'Devices' });
    fireEvent.click(within(devices).getByRole('button', { name: /Mobile/ }));
    await waitFor(() => expect(getStats).toHaveBeenLastCalledWith('p1', { ...rangeDays('30d'), device: 'mobile' }));
    const countries = screen.getByRole('region', { name: 'Countries' });
    fireEvent.click(within(countries).getByRole('button', { name: /Germany/ }));
    await waitFor(() => expect(getStats).toHaveBeenLastCalledWith('p1', { ...rangeDays('30d'), device: 'mobile', country: 'DE' }));
    // A filtered view has no meaningful conversion rate: goals are not split by device or country.
    await waitFor(() => expect(screen.getByRole('group', { name: 'Goals' })).not.toHaveTextContent('of visitors'));
    fireEvent.click(within(devices).getByRole('button', { name: 'Clear Device: Mobile' }));
    await waitFor(() => expect(getStats).toHaveBeenLastCalledWith('p1', { ...rangeDays('30d'), country: 'DE' }));
  });

  it('★ shows each filter at the top AND in its own section, and either copy clears it', async () => {
    render(<StatsView project={project} />);
    const devices = await screen.findByRole('region', { name: 'Devices' });
    const countries = screen.getByRole('region', { name: 'Countries' });
    // Presence guard: no pill anywhere before a filter is set.
    expect(screen.queryAllByRole('button', { name: /^Clear / })).toHaveLength(0);
    fireEvent.click(within(devices).getByRole('button', { name: /Mobile/ }));
    await waitFor(() => expect(within(devices).getByRole('button', { name: 'Clear Device: Mobile' })).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Clear Device: Mobile' })).toHaveLength(2); // the top row + Devices
    expect(within(countries).queryByRole('button', { name: /^Clear / })).toBeNull(); // not in a section it isn't about

    fireEvent.click(within(countries).getByRole('button', { name: /Germany/ }));
    await waitFor(() => expect(within(countries).getByRole('button', { name: 'Clear Country: Germany' })).toBeInTheDocument());
    const map = await screen.findByRole('region', { name: 'Map' });
    expect(within(map).getByRole('button', { name: 'Clear Country: Germany' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear Country: Germany' })).toHaveLength(3); // top, Countries, Map

    // Cleared from the MAP section, it goes everywhere.
    fireEvent.click(within(map).getByRole('button', { name: 'Clear Country: Germany' }));
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Clear Country: Germany' })).toHaveLength(0));
    expect(getStats).toHaveBeenLastCalledWith('p1', { ...rangeDays('30d'), device: 'mobile' });
  });

  it('★ a day in the chart shows the editor tooltip, one figure per line', async () => {
    const { container } = render(<StatsView project={project} />);
    await screen.findByRole('group', { name: 'Visitors' });
    const day = container.querySelector('[data-day="2026-10-18"]')!;
    // No native SVG <title> left: it would show a second, browser-styled tooltip over this one.
    expect(container.querySelector('svg title')).toBeNull();
    fireEvent.mouseEnter(day);
    const tip = screen.getByRole('tooltip');
    expect([...tip.children].map((line) => line.textContent)).toEqual(['Sun, 18 Oct 2026', '70 pageviews', '25 visitors', '50 bot pageviews']);
    fireEvent.mouseLeave(day);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('★ a country on the map shows the editor tooltip at the pointer, saying a click filters', async () => {
    const { container } = render(<StatsView project={project} />);
    await screen.findByRole('img', { name: /Visitors by country/ });
    const de = container.querySelector('path[data-country="DE"]')!;
    fireEvent.mouseMove(de, { clientX: 200, clientY: 120 });
    expect([...screen.getByRole('tooltip').children].map((l) => l.textContent)).toEqual(['Germany', '30 visitors', 'Click to filter by it']);
    // A click filters — and closes the bubble, whose "Click to filter by it" would now be wrong.
    fireEvent.click(de);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await waitFor(() => expect(getStats).toHaveBeenLastCalledWith('p1', { ...rangeDays('30d'), country: 'DE' }));
    const fr = container.querySelector('path[data-country="FR"]')!;
    fireEvent.mouseMove(fr, { clientX: 150, clientY: 120 });
    // Nothing to filter by, so no promise of one.
    expect([...screen.getByRole('tooltip').children].map((l) => l.textContent)).toEqual(['France', 'No visitors']);
  });

  it('names countries, and the unknown ones', async () => {
    render(<StatsView project={project} />);
    const countries = await screen.findByRole('region', { name: 'Countries' });
    expect(within(countries).getByText('Germany')).toBeInTheDocument();
    expect(within(countries).getByText('United States')).toBeInTheDocument();
    expect(within(countries).getByText('Unknown')).toBeInTheDocument();
  });

  it('lists bots by kind, pages, sources and goals', async () => {
    render(<StatsView project={project} />);
    expect(await screen.findByText('Search engines')).toBeInTheDocument();
    expect(screen.getByText('AI crawlers and assistants')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Top pages' })).getByText('/')).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(within(sources).getByText('google.com')).toBeInTheDocument();
    expect(within(sources).getByText('Direct')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Goals' })).getByText('Contact us')).toBeInTheDocument();
  });

  it('★ says when statistics are off, and opens Website Settings', async () => {
    getStats.mockResolvedValue(stats({ enabled: false }));
    const onOpenSettings = vi.fn();
    render(<StatsView project={project} onOpenSettings={onOpenSettings} />);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Statistics are off for this site');
    const open = within(status).getByRole('button', { name: 'Open Website Settings' });
    // The editor's primary button, not an unstyled DaisyUI `btn`.
    expect(open).toHaveClass('sw-brand-gradient');
    expect(open).not.toHaveClass('btn');
    fireEvent.click(open);
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('★ explains why pages on another host are not counted when the platform has no public address', async () => {
    getStats.mockResolvedValue(stats({ notice: 'no-public-url' }));
    render(<StatsView project={project} />);
    expect(await screen.findByRole('note')).toHaveTextContent('no public address (SW_PUBLIC_URL)');
  });

  it('says a deploy is needed when statistics are on but nothing was counted yet', async () => {
    getStats.mockResolvedValue(stats({ human: { views: 0, visitors: 0 }, botViews: 0, goals: [] }));
    render(<StatsView project={project} />);
    expect(await screen.findByRole('note')).toHaveTextContent('deploy once after switching statistics on');
  });

  it('shows a load error', async () => {
    getStats.mockRejectedValue(new Error('server unavailable'));
    render(<StatsView project={project} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('server unavailable');
  });

  it('downloads a table as CSV for the shown period', async () => {
    render(<StatsView project={project} />);
    await screen.findByText('Visitors');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pages' }));
    const { from, to } = rangeDays('30d');
    expect(downloadStatsCsv).toHaveBeenCalledWith('p1', from, to, 'pages');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('★ carries the DB-IP attribution the licence requires', async () => {
    render(<StatsView project={project} />);
    await screen.findByText('Visitors');
    expect(screen.getByRole('link', { name: 'IP Geolocation by DB-IP' })).toHaveAttribute('href', 'https://db-ip.com');
  });

  it('★ draws the world map, shading countries with visitors, and filters on a click', async () => {
    const { container } = render(<StatsView project={project} />);
    await screen.findByRole('img', { name: /Visitors by country — busiest: Germany 30/ });
    const de = container.querySelector('path[data-country="DE"]')!;
    const fr = container.querySelector('path[data-country="FR"]')!;
    expect(de.getAttribute('class')).toContain('fill-indigo');
    expect(fr.getAttribute('class')).toContain('fill-slate-200');
    fireEvent.click(de);
    await waitFor(() => expect(getStats).toHaveBeenLastCalledWith('p1', { ...rangeDays('30d'), country: 'DE' }));
  });

  it('★ ignores a slow answer for a period that is no longer shown', async () => {
    let resolveOld!: (s: SiteStats) => void;
    getStats.mockImplementationOnce(() => new Promise<SiteStats>((r) => (resolveOld = r)));
    getStats.mockResolvedValue(stats({ human: { views: 7, visitors: 7 } }));
    render(<StatsView project={project} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Visitors' })).toHaveTextContent('7'));
    resolveOld(stats({ human: { views: 999, visitors: 999 } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('group', { name: 'Visitors' })).not.toHaveTextContent('999');
  });
});

describe('statistics formatting', () => {
  it('shades on a log scale, so one big market does not flatten the rest', () => {
    expect(shadeOf(0, 1000)).toBe(-1);
    expect(shadeOf(1000, 1000)).toBe(4);
    expect(shadeOf(1, 1000)).toBe(0);
    expect(shadeOf(30, 1000)).toBeGreaterThan(shadeOf(1, 1000));
  });

  it('writes percentages for people', () => {
    expect(pct(0, 0)).toBe('0%');
    expect(pct(1, 1000)).toBe('<1%');
    expect(pct(1, 3)).toBe('33%');
  });

  it('ends every range today, in UTC', () => {
    const now = new Date('2026-10-19T23:30:00Z');
    expect(rangeDays('today', now)).toEqual({ from: '2026-10-19', to: '2026-10-19' });
    expect(rangeDays('7d', now)).toEqual({ from: '2026-10-13', to: '2026-10-19' });
    expect(rangeDays('12m', now)).toEqual({ from: '2025-10-20', to: '2026-10-19' });
  });
});
