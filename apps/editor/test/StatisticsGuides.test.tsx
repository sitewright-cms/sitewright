import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectRankings, RankKeywordView, SiteRegistrationEntry, SiteRegistrationView } from '@sitewright/schema';

/**
 * The Statistics tab's three views by WHO is looking and WHAT is set up:
 *   - a client sees a view only while its feature is set up (System Settings) AND enabled (this project);
 *   - staff always see all three, and a view that is not live holds (a) a staff-only note, (b) how to set it up in
 *     System Settings, (c) how to enable it for the project — never empty charts. A client never sees a holding message.
 */
const api = vi.hoisted(() => ({
  getStats: vi.fn(),
  getRankings: vi.fn(),
  getSearchPerformanceAvailability: vi.fn(),
  getSearchPerformance: vi.fn(),
  getSiteRegistration: vi.fn(),
  searchRankLocations: vi.fn(),
  putRankSettings: vi.fn(),
  addRankKeywords: vi.fn(),
  setRankKeywordPaused: vi.fn(),
  removeRankKeyword: vi.fn(),
  checkRankingsNow: vi.fn(),
}));
vi.mock('../src/api', () => ({ api, downloadStatsCsv: vi.fn() }));

import { StatisticsTab } from '../src/views/stats/StatisticsTab';
import { GUIDE_URLS } from '../src/views/stats/FeatureGuides';

const project = { id: 'p1', name: 'Plumbers', slug: 'plumbers', role: 'owner' as const, siteUrl: 'https://www.plumbers.na/' };

const stats = {
  from: '2026-09-21',
  to: '2026-10-20',
  enabled: true,
  human: { views: 3, visitors: 2 },
  botViews: 0,
  daily: [{ day: '2026-10-20', views: 3, visitors: 2, botViews: 0 }],
  devices: [],
  countries: [],
  bots: [],
  pages: [],
  sources: [],
  goals: [],
};

const keyword: RankKeywordView = {
  id: 'k1',
  keyword: 'plumber windhoek',
  engine: 'google',
  device: 'desktop',
  location: { name: 'Windhoek,Khomas Region,Namibia', countryCode: 'NA' },
  languageCode: 'en',
  paused: false,
  latest: { day: '2026-10-20', checkedAt: '2026-10-20T06:00:00.000Z', position: 3, url: 'https://www.plumbers.na/', depth: 100 },
  change: null,
  best: 3,
  series: [{ day: '2026-10-20', position: 3 }],
  pending: false,
};

const TRACKING = { domain: 'plumbers.na', includeSubdomains: true, schedule: 'weekly' as const, depth: 100 as const };

/** Rankings as a reader gets them: live (set up, tracked, a keyword) unless told otherwise. */
function rankings(over: Partial<ProjectRankings> = {}): ProjectRankings {
  return { from: '2026-07-23', to: '2026-10-20', tracking: TRACKING, keywords: [keyword], canManage: false, configured: true, ...over };
}
/** The same for staff, who are also told why checks may not run. */
const staffRankings = (over: Partial<ProjectRankings> = {}): ProjectRankings =>
  rankings({ canManage: true, status: over.configured === false ? 'no-provider' : 'ok', ...over });

function entry(over: Partial<SiteRegistrationEntry> = {}): SiteRegistrationEntry {
  return { configured: false, enabled: false, status: 'off', detail: null, verifiedAt: null, checkedAt: null, sitemap: null, owners: [], ownersIssue: null, ...over };
}
function registration(google: Partial<SiteRegistrationEntry> = {}, bing: Partial<SiteRegistrationEntry> = {}): SiteRegistrationView {
  return { siteUrl: 'https://www.plumbers.na/', sitemapUrl: 'https://www.plumbers.na/sitemap.xml', notice: null, google: entry(google), bing: entry(bing) };
}

const searchView = {
  service: 'google',
  siteUrl: 'https://www.plumbers.na/',
  period: { days: 28, start: '2026-09-24', end: '2026-10-21' },
  totals: { clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 },
  previous: null,
  daily: [],
  queries: [],
  pages: [],
  fetchedAt: '2026-10-21T10:00:00.000Z',
};

const NOTE = { name: 'Only visible to admins and developers' };
const SYSTEM_BUTTON = { name: 'Open System Settings → Integrations' };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStats.mockResolvedValue(stats);
  api.getRankings.mockResolvedValue(rankings());
  api.getSearchPerformanceAvailability.mockResolvedValue({ services: [] });
  api.getSearchPerformance.mockResolvedValue(searchView);
  api.getSiteRegistration.mockResolvedValue(registration());
  api.searchRankLocations.mockResolvedValue({ locations: [] });
});

/** Every read the tab makes has answered. */
async function settled(staff = false): Promise<void> {
  await waitFor(() => expect(api.getRankings).toHaveBeenCalled());
  await waitFor(() => expect(api.getSearchPerformanceAvailability).toHaveBeenCalled());
  if (staff) await waitFor(() => expect(api.getSiteRegistration).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const tabNames = (): string[] => within(screen.getByRole('tablist', { name: 'Statistics' })).getAllByRole('tab').map((t) => t.textContent ?? '');

const linkTo = (name: RegExp | string): HTMLElement => screen.getByRole('link', { name });

describe('a client: a view only while it is set up AND enabled, and never a holding message', () => {
  it.each([
    { what: 'visits on; rankings tracked but no provider set up; no search engine', visits: true, rank: rankings({ configured: false }), search: [], tabs: null },
    { what: 'visits on; a provider, but no keyword yet', visits: true, rank: rankings({ keywords: [] }), search: [], tabs: null },
    { what: 'visits on; a provider, but no tracking set up', visits: true, rank: rankings({ tracking: null, keywords: [] }), search: [], tabs: null },
    { what: 'everything live', visits: true, rank: rankings(), search: ['bing'], tabs: ['Visits', 'Search rankings', 'Search performance'] },
    { what: 'visits off; rankings live', visits: false, rank: rankings(), search: ['google'], tabs: ['Search rankings', 'Search performance'] },
  ])('$what', async ({ visits, rank, search, tabs }) => {
    api.getRankings.mockResolvedValue(rank);
    api.getSearchPerformanceAvailability.mockResolvedValue({ services: search });
    render(<StatisticsTab project={project} visitsAvailable={visits} />);
    await settled();
    if (tabs) expect(tabNames()).toEqual(tabs);
    else {
      // Presence guard: the visit counter really is on screen, alone.
      expect(await screen.findByRole('group', { name: 'Visitors' })).toBeInTheDocument();
      expect(screen.queryByRole('tablist', { name: 'Statistics' })).toBeNull();
    }
    expect(screen.queryByRole('note', NOTE)).toBeNull();
    // A client is never asked about the platform's search engine accounts (a staff-only read).
    expect(api.getSiteRegistration).not.toHaveBeenCalled();
  });

  it('with nothing live at all (the tab is not offered, but if reached) shows no guide either', async () => {
    api.getRankings.mockResolvedValue(rankings({ configured: false, tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} visitsAvailable={false} />);
    await settled();
    expect(await screen.findByText('Search rankings are not tracked for this site yet.')).toBeInTheDocument();
    expect(screen.queryByRole('note', NOTE)).toBeNull();
    expect(screen.queryByRole('button', SYSTEM_BUTTON)).toBeNull();
  });
});

describe('staff: all three views, always', () => {
  it('★ from the first render, before any read answers, with nothing set up', async () => {
    api.getRankings.mockReturnValue(new Promise(() => undefined));
    api.getSearchPerformanceAvailability.mockReturnValue(new Promise(() => undefined));
    api.getSiteRegistration.mockReturnValue(new Promise(() => undefined));
    render(<StatisticsTab project={project} isStaff visitsEnabled={false} />);
    expect(tabNames()).toEqual(['Visits', 'Search rankings', 'Search performance']);
  });

  it('★ does not tear the visit counter down when the reads answer', async () => {
    let answer!: (r: ProjectRankings) => void;
    api.getRankings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await screen.findByRole('group', { name: 'Visitors' });
    await act(async () => answer(staffRankings()));
    await settled(true);
    expect(api.getStats).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('note', NOTE)).toBeNull();
  });
});

describe('Visits: built-in statistics need no setup — (a) and (c) only', () => {
  it('while off: the staff-only note and how to switch them on, with a button to the Analytics tile; no counter', async () => {
    const openSettings = vi.fn();
    render(<StatisticsTab project={project} isStaff visitsEnabled={false} onOpenSettings={openSettings} onOpenSystemSettings={vi.fn()} />);
    const note = screen.getByRole('note', NOTE);
    expect(note).toHaveTextContent('Only admins and developers see this view.');
    expect(note).toHaveTextContent('They need nothing set up in System Settings.');
    const card = screen.getByRole('region', { name: 'Switch the built-in statistics on for this project' });
    expect(within(card).getByText(/Built-in statistics/)).toBeInTheDocument();
    // (b) never applies, so no System Settings stage and no System Settings button.
    expect(screen.queryByRole('region', { name: /in System Settings/ })).toBeNull();
    expect(screen.queryByRole('button', SYSTEM_BUTTON)).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Open Website Settings → Analytics' }));
    expect(openSettings).toHaveBeenCalledWith('analytics');
    expect(screen.queryByRole('group', { name: 'Visitors' })).toBeNull();
    expect(api.getStats).not.toHaveBeenCalled();
  });

  it('while on: the counter, and no guide', async () => {
    render(<StatisticsTab project={project} isStaff visitsEnabled onOpenSettings={vi.fn()} />);
    expect(await screen.findByRole('group', { name: 'Visitors' })).toBeInTheDocument();
    expect(screen.queryByRole('note', NOTE)).toBeNull();
  });

  it('★ while unreadable: the counter, which reads the setting for itself — never "switch them on"', async () => {
    render(<StatisticsTab project={project} isStaff visitsEnabled={null} onOpenSettings={vi.fn()} />);
    expect(await screen.findByRole('group', { name: 'Visitors' })).toBeInTheDocument();
    expect(screen.queryByRole('note', NOTE)).toBeNull();
  });

  it('staff start on the visits, whatever a client would have', async () => {
    render(<StatisticsTab project={project} isStaff visitsAvailable={false} visitsEnabled={false} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Visits/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Switch the built-in statistics on for this project' })).toBeInTheDocument();
  });

  it('while not yet known: neither the guide nor the counter flashes first', async () => {
    render(<StatisticsTab project={project} isStaff onOpenSettings={vi.fn()} />);
    await settled(true);
    expect(screen.getByRole('tablist', { name: 'Statistics' })).toBeInTheDocument();
    expect(screen.queryByRole('note', NOTE)).toBeNull();
    expect(api.getStats).not.toHaveBeenCalled();
  });
});

describe('Search rankings: the holding note sits ABOVE the setup that adds keywords', () => {
  async function openRankings(): Promise<void> {
    await settled(true);
    fireEvent.click(screen.getByRole('tab', { name: /Search rankings/ }));
  }

  it('no provider (an admin): (a) + DataForSEO setup with its links and the System Settings button + (c), then the setup form', async () => {
    const openSystem = vi.fn();
    api.getRankings.mockResolvedValue(staffRankings({ configured: false, tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} isStaff visitsEnabled onOpenSystemSettings={openSystem} />);
    await openRankings();
    const note = await screen.findByRole('note', NOTE);
    expect(note).toHaveTextContent('keyword rank tracking is set up in System Settings and enabled for this project');
    const setup = screen.getByRole('region', { name: 'Step 1: Set up rank tracking in System Settings' });
    expect(within(setup).getByText(/Done once for the whole platform/)).toBeInTheDocument();
    const steps = within(setup).getByRole('list', { name: 'DataForSEO setup' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5);
    expect(steps).toHaveTextContent('Add Funds');
    expect(steps).toHaveTextContent('Sandbox: free dummy results, for testing');
    expect(steps).toHaveTextContent('Test saved credentials');
    for (const [name, href] of [
      [/Sign up at DataForSEO/, GUIDE_URLS.dataForSeoRegister],
      [/API Access/, GUIDE_URLS.dataForSeoApiAccess],
      [/DataForSEO pricing/, GUIDE_URLS.dataForSeoPricing],
    ] as const) {
      const link = within(setup).getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    fireEvent.click(within(setup).getByRole('button', SYSTEM_BUTTON));
    expect(openSystem).toHaveBeenCalledWith({ tab: 'integrations', section: 'rank-tracking' });
    const enable = screen.getByRole('region', { name: 'Step 2: Enable it for this project' });
    expect(enable).toHaveTextContent('Save setup');
    // The setup UI stays, BELOW the note — it is how keywords are added.
    const form = screen.getByRole('form', { name: 'Rank tracking setup' });
    expect(note.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The guide already says no provider is set up: no second, amber copy of it.
    expect(screen.queryByText(/No rank-tracking provider is set up/)).toBeNull();
  });

  it('no provider (a developer): the same steps, no button — an instance admin does it', async () => {
    api.getRankings.mockResolvedValue(staffRankings({ configured: false, tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openRankings();
    const setup = await screen.findByRole('region', { name: 'Step 1: Set up rank tracking in System Settings' });
    expect(setup).toHaveTextContent('An instance admin does this, once for the whole platform.');
    expect(setup).toHaveTextContent('System Settings → Integrations → Keyword rank tracking');
    expect(within(setup).getAllByRole('listitem')).toHaveLength(5);
    expect(within(setup).getByRole('link', { name: /API Access/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', SYSTEM_BUTTON)).toBeNull();
  });

  it('a provider, no tracking yet: (a) + (c) only, starting with the setup', async () => {
    api.getRankings.mockResolvedValue(staffRankings({ tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} isStaff visitsEnabled onOpenSystemSettings={vi.fn()} />);
    await openRankings();
    const enable = await screen.findByRole('region', { name: 'Enable it for this project' });
    expect(within(enable).getAllByRole('listitem')).toHaveLength(3);
    expect(enable).toHaveTextContent('Save setup');
    expect(screen.getByRole('note', NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /in System Settings/ })).toBeNull();
    expect(screen.queryByRole('button', SYSTEM_BUTTON)).toBeNull();
  });

  it('tracking with no keyword: (c) points at Manage keywords, and the guide goes once a keyword is tracked', async () => {
    // The tab's first read has no keyword; the view's own read (after a keyword was added elsewhere) has one.
    api.getRankings.mockResolvedValueOnce(staffRankings({ keywords: [] })).mockResolvedValue(staffRankings());
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await settled(true);
    fireEvent.click(screen.getByRole('tab', { name: /Search rankings/ }));
    // Presence guard: the guide IS there on the first answer, before the view's own read replaces it.
    expect(screen.getByRole('note', NOTE)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('note', NOTE)).toBeNull());
    expect(await screen.findByRole('table', { name: /Tracked keywords/ })).toBeInTheDocument();
  });

  it('with no keyword the steps skip the setup', async () => {
    api.getRankings.mockResolvedValue(staffRankings({ keywords: [] }));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openRankings();
    const enable = await screen.findByRole('region', { name: 'Enable it for this project' });
    expect(within(enable).getAllByRole('listitem')).toHaveLength(2);
    expect(enable).toHaveTextContent('Manage keywords');
    expect(enable).not.toHaveTextContent('Save setup');
  });

  it('live: the rankings, and no guide', async () => {
    api.getRankings.mockResolvedValue(staffRankings());
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openRankings();
    expect(await screen.findByRole('table', { name: /Tracked keywords/ })).toBeInTheDocument();
    expect(screen.queryByRole('note', NOTE)).toBeNull();
  });
});

describe('Search performance', () => {
  async function openSearch(): Promise<void> {
    await settled(true);
    fireEvent.click(screen.getByRole('tab', { name: /Search performance/ }));
  }

  it('no account (an admin): (a) + Google and Bing steps with their links and the System Settings button + (c); no numbers', async () => {
    const openSystem = vi.fn();
    const openSettings = vi.fn();
    render(<StatisticsTab project={project} isStaff visitsEnabled onOpenSystemSettings={openSystem} onOpenSettings={openSettings} />);
    await openSearch();
    expect(await screen.findByRole('note', NOTE)).toHaveTextContent('a search engine account (Google or Bing) is set up in System Settings');
    const setup = screen.getByRole('region', { name: 'Step 1: Set up a search engine account in System Settings' });
    expect(setup).toHaveTextContent('Not set up');
    const google = within(setup).getByRole('list', { name: 'Google service account setup' });
    expect(within(google).getAllByRole('listitem')).toHaveLength(5);
    expect(google).toHaveTextContent('Keys → Add key → Create new key → JSON → Create');
    expect(google).toHaveTextContent('Upload key file');
    const bing = within(setup).getByRole('list', { name: 'Bing Webmaster API key setup' });
    expect(bing).toHaveTextContent('Generate API Key');
    expect(setup).toHaveTextContent('iam.disableServiceAccountKeyCreation');
    for (const [name, href] of [
      [/Google Search Console API/, GUIDE_URLS.googleSearchConsoleApi],
      [/Site Verification API/, GUIDE_URLS.googleSiteVerificationApi],
      [/Service accounts/, GUIDE_URLS.googleServiceAccounts],
      [/Create a project/, GUIDE_URLS.googleNewProject],
      [/Bing Webmaster Tools/, GUIDE_URLS.bingWebmaster],
    ] as const) {
      const link = within(setup).getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    fireEvent.click(within(setup).getByRole('button', SYSTEM_BUTTON));
    expect(openSystem).toHaveBeenCalledWith({ tab: 'integrations', section: 'search-engine-accounts' });
    const enable = screen.getByRole('region', { name: 'Step 2: Enable it for this project' });
    expect(enable).toHaveTextContent('Verify now');
    fireEvent.click(within(enable).getByRole('button', { name: 'Open Website Settings → Search engines' }));
    expect(openSettings).toHaveBeenCalledWith('search-engines');
    expect(api.getSearchPerformance).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Clicks' })).toBeNull();
  });

  it('no account (a developer): the steps, no System Settings button, and still the Search engines tile', async () => {
    render(<StatisticsTab project={project} isStaff visitsEnabled onOpenSettings={vi.fn()} />);
    await openSearch();
    const setup = await screen.findByRole('region', { name: 'Step 1: Set up a search engine account in System Settings' });
    expect(setup).toHaveTextContent('An instance admin does this');
    expect(setup).toHaveTextContent('System Settings → Integrations → Search engine accounts');
    expect(within(setup).getByRole('list', { name: 'Google service account setup' })).toBeInTheDocument();
    expect(screen.queryByRole('button', SYSTEM_BUTTON)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Website Settings → Search engines' })).toBeInTheDocument();
  });

  it('an account, not switched on: (a) + (c) only, with where each search engine stands', async () => {
    api.getSiteRegistration.mockResolvedValue(registration({ configured: true }));
    render(<StatisticsTab project={project} isStaff visitsEnabled onOpenSystemSettings={vi.fn()} onOpenSettings={vi.fn()} />);
    await openSearch();
    const enable = await screen.findByRole('region', { name: 'Enable it for this project' });
    const engines = within(enable).getByRole('list', { name: 'Search engines for this site' });
    expect(engines).toHaveTextContent('Google Search Console: switched off');
    expect(engines).toHaveTextContent('Bing Webmaster Tools: no platform account yet');
    expect(screen.getByRole('note', NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /in System Settings/ })).toBeNull();
    expect(screen.queryByRole('button', SYSTEM_BUTTON)).toBeNull();
  });

  it('switched on but refused: says why', async () => {
    api.getSiteRegistration.mockResolvedValue(registration({ configured: true, enabled: true, status: 'failed', detail: 'the tag was not found' }));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openSearch();
    expect(await screen.findByRole('list', { name: 'Search engines for this site' })).toHaveTextContent('verification failed: the tag was not found');
  });

  it('★ an unreadable account state is not "no account": the setup shows, marked as not checked', async () => {
    api.getSiteRegistration.mockRejectedValue(new Error('offline'));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openSearch();
    const setup = await screen.findByRole('region', { name: 'Step 1: Set up a search engine account in System Settings' });
    expect(setup).toHaveTextContent('Could not be checked');
    expect(setup).not.toHaveTextContent('Not set up');
  });

  it('★ availability unreadable: staff get the engines the registration says are verified, not "not verified yet"', async () => {
    api.getSearchPerformanceAvailability.mockRejectedValue(new Error('offline'));
    api.getSiteRegistration.mockResolvedValue(registration({ configured: true, enabled: true, status: 'verified' }, { configured: true }));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openSearch();
    expect(await screen.findByRole('group', { name: 'Clicks' })).toBeInTheDocument();
    expect(api.getSearchPerformance).toHaveBeenCalledWith('p1', 'google', 28);
    expect(screen.queryByRole('note', NOTE)).toBeNull();
  });

  it('availability unreadable for a client: no search view (a failed read is "no")', async () => {
    api.getSearchPerformanceAvailability.mockRejectedValue(new Error('offline'));
    render(<StatisticsTab project={project} />);
    await settled();
    expect(tabNames()).toEqual(['Visits', 'Search rankings']);
  });

  it('verified: the numbers, and no guide', async () => {
    api.getSiteRegistration.mockResolvedValue(registration({ configured: true, enabled: true, status: 'verified' }));
    api.getSearchPerformanceAvailability.mockResolvedValue({ services: ['google'] });
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await openSearch();
    expect(await screen.findByRole('group', { name: 'Clicks' })).toBeInTheDocument();
    expect(screen.queryByRole('note', NOTE)).toBeNull();
    expect(screen.queryByRole('link', { name: /Google Search Console API/ })).toBeNull();
  });
});

describe('outbound links', () => {
  it('every guide link opens in a new tab without handing over the editor', async () => {
    api.getRankings.mockResolvedValue(staffRankings({ configured: false, tracking: null, keywords: [] }));
    render(<StatisticsTab project={project} isStaff visitsEnabled />);
    await settled(true);
    fireEvent.click(screen.getByRole('tab', { name: /Search performance/ }));
    await screen.findByRole('region', { name: /Set up a search engine account/ });
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    }
    expect(linkTo(/Microsoft’s guide/)).toHaveAttribute('href', GUIDE_URLS.bingApiAccessHelp);
  });
});
