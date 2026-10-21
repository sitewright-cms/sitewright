import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SiteRegistrationEntry, SiteRegistrationView } from '@sitewright/schema';

/**
 * The Search engines tile (agency staff) and its verification run: switches that need an https Production URL and a
 * platform account, a switch-off that removes the site (after asking), and "Verify now" — targets, tags, a deploy to
 * the target that serves the Production URL with its progress, then each search engine and its sitemap — stopping
 * where a step fails and saying why — and "Sitemap & owners".
 */

const api = vi.hoisted(() => ({
  getSiteRegistration: vi.fn(),
  setSiteRegistration: vi.fn(),
  prepareSiteRegistration: vi.fn(),
  verifySiteRegistration: vi.fn(),
  submitSitemap: vi.fn(),
  setSearchConsoleOwners: vi.fn(),
  listDeployTargets: vi.fn(),
  publishStatus: vi.fn(),
  testDeployTarget: vi.fn(),
  publish: vi.fn(),
  deployTargetStream: vi.fn(),
}));
vi.mock('../src/api', () => ({ api }));

import { SearchEnginesTile, searchEnginesStatus } from '../src/views/settings/SearchEnginesTile';

const entry = (over: Partial<SiteRegistrationEntry> = {}): SiteRegistrationEntry => ({
  configured: true,
  enabled: false,
  status: 'off',
  detail: null,
  verifiedAt: null,
  checkedAt: null,
  sitemap: null,
  owners: [],
  ...over,
});
const view = (over: Partial<SiteRegistrationView> = {}): SiteRegistrationView => ({
  siteUrl: 'https://www.example.com/',
  sitemapUrl: 'https://www.example.com/sitemap.xml',
  notice: null,
  google: entry(),
  bing: entry(),
  ...over,
});
const on = (over: Partial<SiteRegistrationEntry> = {}) => entry({ enabled: true, status: 'none', ...over });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

const googleSwitch = () => screen.findByRole('switch', { name: 'Register the site with Google Search Console' });

describe('the Search engines tile', () => {
  it('switches a search engine on, and says what to do next', async () => {
    api.getSiteRegistration.mockResolvedValue(view());
    api.setSiteRegistration.mockResolvedValue({ removed: {}, view: view({ google: on() }) });
    render(<SearchEnginesTile projectId="p1" />);
    expect(await screen.findByText('Switch a search engine on to register the site')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify the site with the switched-on search engines' })).toBeDisabled();
    fireEvent.click(await googleSwitch());
    await waitFor(() => expect(api.setSiteRegistration).toHaveBeenCalledWith('p1', { google: true }));
    expect(await screen.findByText('Not verified yet: Verify now deploys the site, then asks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify the site with the switched-on search engines' })).toBeEnabled();
  });

  it('locks the switches without an https Production URL or a platform account, and says why', async () => {
    api.getSiteRegistration.mockResolvedValue(view({ siteUrl: null, notice: 'not-https', bing: entry({ configured: false }) }));
    render(<SearchEnginesTile projectId="p1" />);
    const google = await googleSwitch();
    expect(google).toBeDisabled();
    expect(google).toHaveAccessibleDescription('Set an https Production URL first (the Site tile).');
    expect(screen.getByRole('switch', { name: 'Register the site with Bing Webmaster Tools' })).toHaveAccessibleDescription(
      'An instance admin adds the platform’s Bing Webmaster account in System Settings → Integrations.',
    );
    expect(screen.getByText('The Production URL must be https')).toBeInTheDocument();
  });

  it('asks before switching a registered search engine off, and shows a removal that did not get through', async () => {
    api.getSiteRegistration.mockResolvedValue(view({ google: on({ status: 'verified', verifiedAt: '2026-10-21T10:00:00.000Z' }) }));
    api.setSiteRegistration.mockResolvedValue({
      removed: { google: { ok: false, detail: 'Could not remove https://www.example.com/ from Google: Google could not be reached' } },
      view: view({ google: on({ status: 'verified' }) }),
    });
    render(<SearchEnginesTile projectId="p1" />);
    expect(await screen.findByText(/^Verified · /)).toBeInTheDocument();
    fireEvent.click(await googleSwitch());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.setSiteRegistration).not.toHaveBeenCalled();

    fireEvent.click(await googleSwitch());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove https://www.example.com/ from the platform’s Google Search Console account, if it is registered there?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(api.setSiteRegistration).toHaveBeenCalledWith('p1', { google: false }));
    expect(await screen.findByText('Could not remove https://www.example.com/ from Google: Google could not be reached')).toBeInTheDocument();
  });

  it('shows why a search engine failed', async () => {
    api.getSiteRegistration.mockResolvedValue(view({ bing: on({ status: 'failed', detail: 'Bing refused the API key' }) }));
    render(<SearchEnginesTile projectId="p1" />);
    expect(await screen.findByText('Bing: Bing refused the API key')).toBeInTheDocument();
  });

  it('shows a sitemap a search engine did not take', async () => {
    const sitemap = { ok: false, detail: 'Google did not take the sitemap: Invalid sitemap URL.', at: '2026-10-21T10:00:00.000Z' };
    api.getSiteRegistration.mockResolvedValue(view({ google: on({ status: 'verified', sitemap }) }));
    render(<SearchEnginesTile projectId="p1" />);
    expect(await screen.findByText('Google: sitemap not taken: Google did not take the sitemap: Invalid sitemap URL.')).toBeInTheDocument();
  });

  it('summarises its state in the head', () => {
    expect(searchEnginesStatus(null)).toEqual({ kind: 'default', label: 'Off' });
    expect(searchEnginesStatus(view({ google: on({ status: 'verified' }) }))).toEqual({ kind: 'set', label: 'Verified' });
    expect(searchEnginesStatus(view({ google: on({ status: 'verified' }), bing: on({ status: 'failed' }) }))).toEqual({ kind: 'attention', label: 'Failed' });
    expect(searchEnginesStatus(view({ google: on({ status: 'pending' }) }))).toEqual({ kind: 'attention', label: 'Not verified' });
  });
});

describe('Verify now', () => {
  const both = view({ google: on(), bing: on() });
  const steps = () => within(screen.getByRole('list', { name: 'Verification steps' })).getAllByRole('listitem');
  const stateOf = (label: RegExp) => steps().find((li) => label.test(li.textContent ?? ''))?.getAttribute('data-state');
  const LOCAL = { id: 't1', name: 'Local Hosting', protocol: 'local' };
  const SFTP = { id: 't2', name: 'Webspace', protocol: 'sftp', host: 'webspace.example', lastDeployedAt: '2026-10-20T10:00:00.000Z' };
  const STAGING = { id: 't3', name: 'Staging', protocol: 'sftp', host: 'staging.example', lastDeployedAt: '2026-10-01T10:00:00.000Z' };
  const tagsReady = { results: { google: { ok: true, detail: 'Tag ready' }, bing: { ok: true, detail: 'Tag ready' } }, view: both };

  async function open(v: SiteRegistrationView) {
    api.getSiteRegistration.mockResolvedValue(v);
    render(<SearchEnginesTile projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify the site with the switched-on search engines' }));
  }
  function streamThat(final: 'done' | 'error') {
    let progress: (e: unknown) => void = () => {};
    let finish: () => void = () => {};
    api.deployTargetStream.mockImplementation(
      (_p: string, _id: string, h: { onProgress: (e: unknown) => void; onDone: (d: unknown) => void; onError: (m: string) => void }) =>
        new Promise<void>((resolve) => {
          progress = h.onProgress;
          finish = () => {
            if (final === 'done') h.onDone({ protocol: 'sftp', files: 12, uploaded: 3 });
            else h.onError('Could not connect to webspace.example: connection refused');
            resolve();
          };
        }),
    );
    return { progress: (e: unknown) => progress(e), finish: () => finish() };
  }

  it('uses Local Hosting when it serves the Production URL, and deploys nothing else', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [LOCAL, SFTP] });
    api.publishStatus.mockResolvedValue({ url: '//www.example.com/' });
    api.prepareSiteRegistration.mockResolvedValue(tagsReady);
    api.publish.mockResolvedValue({});
    api.verifySiteRegistration.mockImplementation(async (_p: string, s: string) => ({ result: { ok: true, detail: s === 'google' ? 'Verified and added to Search Console' : 'Verified in Bing Webmaster Tools' }, view: both }));
    api.submitSitemap.mockImplementation(async () => ({ result: { ok: true, detail: 'Sitemap submitted: https://www.example.com/sitemap.xml' }, view: both }));
    await open(both);
    expect(await screen.findByRole('status')).toHaveTextContent('Verified with Google Search Console and Bing Webmaster Tools. The sitemap was submitted.');
    expect(screen.getByText('Local Hosting serves https://www.example.com/')).toBeInTheDocument();
    expect(api.publish).toHaveBeenCalledWith('p1');
    expect(api.testDeployTarget).not.toHaveBeenCalled();
    expect(api.deployTargetStream).not.toHaveBeenCalled();
  });

  it('tests the remote target first, deploys it with its progress, then verifies each search engine', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [SFTP] });
    api.publishStatus.mockResolvedValue({ url: null });
    api.testDeployTarget.mockResolvedValue({ ok: true, steps: [] });
    api.prepareSiteRegistration.mockResolvedValue(tagsReady);
    const stream = streamThat('done');
    api.verifySiteRegistration.mockImplementation(async (_p: string, s: string) => ({
      result: s === 'google' ? { ok: true, detail: 'Verified and added to Search Console' } : { ok: false, detail: 'Bing could not verify https://www.example.com/: it did not find the verification tag on the home page' },
      view: both,
    }));
    api.submitSitemap.mockResolvedValue({ result: { ok: true, detail: 'Sitemap submitted: https://www.example.com/sitemap.xml' }, view: both });
    await open(both);
    await waitFor(() => expect(api.deployTargetStream).toHaveBeenCalledWith('p1', 't2', expect.anything(), expect.anything()));
    expect(api.testDeployTarget).toHaveBeenCalledWith('p1', { id: 't2' });
    expect(screen.getByText('SFTP · webspace.example answers')).toBeInTheDocument();
    expect(screen.getByText('Google: Tag ready · Bing: Tag ready')).toBeInTheDocument();
    stream.progress({ phase: 'uploading', index: 5, total: 12 });
    expect(await screen.findByRole('progressbar', { name: 'Deploy progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('6 of 12 files')).toBeInTheDocument();
    expect(api.verifySiteRegistration).not.toHaveBeenCalled(); // nothing is verified before the deploy is through
    stream.finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Verified with Google Search Console; not verified with Bing Webmaster Tools. The reasons are above.');
    expect(screen.getByText('Deployed · 3 files sent')).toBeInTheDocument();
    expect(stateOf(/^Verifying with Google/)).toBe('done');
    expect(stateOf(/^Verifying with Bing/)).toBe('failed');
    // The sitemap goes to the search engine that verified, and only to it.
    expect(api.submitSitemap).toHaveBeenCalledTimes(1);
    expect(api.submitSitemap).toHaveBeenCalledWith('p1', 'google');
    expect(stateOf(/^Submitting the sitemap to Google/)).toBe('done');
    expect(stateOf(/^Submitting the sitemap to Bing/)).toBe('skipped');
  });

  it('a sitemap that was not taken does not undo the verification', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [LOCAL] });
    api.publishStatus.mockResolvedValue({ url: 'https://www.example.com/' });
    api.prepareSiteRegistration.mockResolvedValue({ results: { google: { ok: true, detail: 'Tag ready' } }, view: view({ google: on() }) });
    api.publish.mockResolvedValue({});
    api.verifySiteRegistration.mockResolvedValue({ result: { ok: true, detail: 'Verified and added to Search Console' }, view: both });
    api.submitSitemap.mockResolvedValue({ result: { ok: false, detail: 'Google is unavailable (HTTP 503)' }, view: both });
    await open(view({ google: on() }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Verified with Google Search Console. The sitemap did not reach Google Search Console: Sitemap & owners can submit it again.');
    expect(status.className).toMatch(/emerald/);
    expect(stateOf(/^Submitting the sitemap to Google/)).toBe('failed');
    expect(screen.getByText('Google is unavailable (HTTP 503)')).toBeInTheDocument();
  });

  it('asks which remote target serves the Production URL when there are several', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [STAGING, SFTP] });
    api.publishStatus.mockResolvedValue({ url: null });
    api.testDeployTarget.mockResolvedValue({ ok: true, steps: [] });
    api.prepareSiteRegistration.mockResolvedValue(tagsReady);
    streamThat('done');
    await open(both);
    const group = await screen.findByRole('group', { name: 'Which deploy target serves https://www.example.com/?' });
    expect(within(group).getByRole('radio', { name: /Webspace/ })).toBeChecked(); // the most recently deployed
    expect(api.testDeployTarget).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole('radio', { name: /Staging/ }));
    fireEvent.click(within(group).getByRole('button', { name: 'Deploy and verify' }));
    await waitFor(() => expect(api.deployTargetStream).toHaveBeenCalledTimes(1));
    expect(api.testDeployTarget).toHaveBeenCalledWith('p1', { id: 't3' });
    expect(api.deployTargetStream).toHaveBeenCalledWith('p1', 't3', expect.anything(), expect.anything());
    expect(screen.queryByRole('group', { name: /Which deploy target/ })).toBeNull();
  });

  it('stops when the target does not answer', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [SFTP] });
    api.publishStatus.mockResolvedValue({ url: null });
    api.testDeployTarget.mockResolvedValue({ ok: false, steps: [], failure: { kind: 'connect', message: 'Could not connect to webspace.example: connection refused' } });
    await open(both);
    expect(await screen.findByRole('status')).toHaveTextContent('Nothing was verified.');
    expect(screen.getByText('Could not connect to webspace.example: connection refused')).toBeInTheDocument();
    expect(stateOf(/^Getting the verification tags/)).toBe('skipped');
    expect(api.prepareSiteRegistration).not.toHaveBeenCalled();
  });

  it('stops without a target that serves the Production URL', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [] });
    api.publishStatus.mockResolvedValue({ url: null });
    await open(both);
    expect(await screen.findByText('This project has no deploy target. Add one with Deploy, then verify again.')).toBeInTheDocument();
    expect(stateOf(/^Verifying with Google/)).toBe('skipped');
    cleanup();

    api.listDeployTargets.mockResolvedValue({ items: [LOCAL] });
    api.publishStatus.mockResolvedValue({ url: '//example.sites.test/' });
    await open(both);
    expect(await screen.findByText('Local Hosting serves example.sites.test, not https://www.example.com/, and the project has no other deploy target.')).toBeInTheDocument();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('verifies only the search engines whose tag it got', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [LOCAL] });
    api.publishStatus.mockResolvedValue({ url: 'https://www.example.com/' });
    api.prepareSiteRegistration.mockResolvedValue({ results: { google: { ok: false, detail: 'Google is unavailable (HTTP 503)' }, bing: { ok: true, detail: 'Tag ready' } }, view: both });
    api.publish.mockResolvedValue({});
    api.verifySiteRegistration.mockResolvedValue({ result: { ok: true, detail: 'Verified in Bing Webmaster Tools' }, view: both });
    await open(both);
    expect(await screen.findByRole('status')).toHaveTextContent('Verified with Bing Webmaster Tools.');
    expect(api.verifySiteRegistration).toHaveBeenCalledTimes(1);
    expect(api.verifySiteRegistration).toHaveBeenCalledWith('p1', 'bing');
    expect(stateOf(/^Verifying with Google/)).toBe('skipped');
    expect(stateOf(/^Submitting the sitemap to Google/)).toBe('skipped');
  });

  it('verifies nothing when the deploy failed', async () => {
    api.listDeployTargets.mockResolvedValue({ items: [SFTP] });
    api.publishStatus.mockResolvedValue({ url: null });
    api.testDeployTarget.mockResolvedValue({ ok: true, steps: [] });
    api.prepareSiteRegistration.mockResolvedValue({ results: { google: { ok: true, detail: 'Tag ready' } }, view: view({ google: on() }) });
    const stream = streamThat('error');
    await open(view({ google: on() }));
    await waitFor(() => expect(api.deployTargetStream).toHaveBeenCalled());
    stream.finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Nothing was verified: the tags are not on the live site.');
    expect(screen.getByText('Could not connect to webspace.example: connection refused')).toBeInTheDocument();
    expect(api.verifySiteRegistration).not.toHaveBeenCalled();
  });
});

describe('Sitemap & owners', () => {
  const at = '2026-10-21T10:00:00.000Z';
  const verified = view({
    google: on({ status: 'verified', sitemap: { ok: true, detail: 'Sitemap submitted: https://www.example.com/sitemap.xml', at }, owners: ['ana@agency.example'] }),
    bing: on({ status: 'verified' }),
  });

  async function open(v: SiteRegistrationView) {
    api.getSiteRegistration.mockResolvedValue(v);
    render(<SearchEnginesTile projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sitemap and Search Console owners' }));
    return screen.findByRole('dialog');
  }

  it('submits the sitemap again to every search engine that verified the site', async () => {
    api.submitSitemap.mockImplementation(async (_p: string, s: 'google' | 'bing') => ({
      result: { ok: true, detail: 'Sitemap submitted: https://www.example.com/sitemap.xml' },
      view: { ...verified, [s]: { ...verified[s], sitemap: { ok: true, detail: 'Sitemap submitted', at } } },
    }));
    const dialog = await open(verified);
    expect(within(dialog).getByText('https://www.example.com/sitemap.xml')).toBeInTheDocument();
    const list = within(dialog).getByRole('list', { name: 'Sitemap per search engine' });
    expect(within(list).getByText(/^Submitted /)).toBeInTheDocument();
    expect(within(list).getByText('Not submitted yet')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit again' }));
    await waitFor(() => expect(api.submitSitemap).toHaveBeenCalledTimes(2));
    expect(api.submitSitemap.mock.calls.map((c) => c[1])).toEqual(['google', 'bing']);
  });

  it('edits the Search Console owners as a whole list, and keeps a refused list to fix', async () => {
    api.setSearchConsoleOwners.mockResolvedValueOnce({ result: { ok: false, detail: 'Google did not change the owners: Invalid owner' }, view: verified });
    const dialog = await open(verified);
    const save = within(dialog).getByRole('button', { name: 'Save owners' });
    expect(save).toBeDisabled(); // nothing changed yet
    const input = within(dialog).getByLabelText('Add a Google account');
    fireEvent.change(input, { target: { value: 'not an email' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Enter the email address of a Google account')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: ' Ben@Agency.example ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove ana@agency.example' }));
    expect(within(within(dialog).getByRole('list', { name: 'Owners' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['ben@agency.example']);
    fireEvent.click(save);
    await waitFor(() => expect(api.setSearchConsoleOwners).toHaveBeenCalledWith('p1', ['ben@agency.example']));
    expect(await within(dialog).findByText('Google did not change the owners: Invalid owner')).toBeInTheDocument();
    expect(within(dialog).getByText('ben@agency.example')).toBeInTheDocument(); // still there to fix

    const saved = view({ ...verified, google: { ...verified.google, owners: ['ben@agency.example'] } });
    api.setSearchConsoleOwners.mockResolvedValueOnce({ result: { ok: true, detail: '1 owner in Search Console' }, view: saved });
    fireEvent.click(save);
    expect(await within(dialog).findByText('1 owner in Search Console')).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('offers the owners only once Google verified the site', async () => {
    const dialog = await open(view({ google: on({ status: 'pending' }), bing: on({ status: 'verified' }) }));
    expect(within(dialog).getByText('Verify the site with Google first.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Add a Google account')).toBeNull();
    expect(within(dialog).getByText('Not verified yet: verify the site first')).toBeInTheDocument();
  });
});
