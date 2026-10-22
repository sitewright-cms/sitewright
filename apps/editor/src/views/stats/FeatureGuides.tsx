import { BarChart3, Search } from 'lucide-react';
import type { SiteRegistrationEntry, SiteRegistrationView, WebmasterService } from '@sitewright/schema';
import type { OpenSystemSettings, OpenWebsiteSettings } from '../../lib/settings-links';
import {
  GuideCard,
  GuidePart,
  HoldingSection,
  StaffOnlyNote,
  Step,
  StepLinks,
  Steps,
  SystemSettingsButton,
  SystemSettingsIntro,
  Ui,
  WebsiteTileButton,
} from './GuideParts';

/**
 * The HOLDING MESSAGES of the Statistics views, for agency staff: (a) the view is theirs alone until its feature is set
 * up and enabled; (b) how to set it up in System Settings, with how to get the keys; (c) how to enable it for this
 * project. Links and labels follow the settings they point at (RankTrackingSettings, WebmasterAccountsSettings, the
 * Analytics and Search engines tiles) — change them together.
 */

/** Where each provider's own pages are. Checked without signing in; the consoles may move things. */
export const GUIDE_URLS = {
  dataForSeoRegister: 'https://app.dataforseo.com/register',
  dataForSeoApiAccess: 'https://app.dataforseo.com/api-access',
  dataForSeoPricing: 'https://dataforseo.com/pricing',
  googleConsole: 'https://console.cloud.google.com/',
  googleNewProject: 'https://console.cloud.google.com/projectcreate',
  googleSearchConsoleApi: 'https://console.cloud.google.com/apis/library/searchconsole.googleapis.com',
  googleSiteVerificationApi: 'https://console.cloud.google.com/apis/library/siteverification.googleapis.com',
  googleServiceAccounts: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  googleKeyPolicy: 'https://docs.cloud.google.com/iam/docs/keys-create-delete',
  bingWebmaster: 'https://www.bing.com/webmasters',
  bingApiAccessHelp: 'https://learn.microsoft.com/en-us/bingwebmaster/getting-access',
} as const;

// ── Visits ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Visits while the built-in statistics are off. They need no setup in System Settings, so only (a) and (c). */
export function VisitsGuide({ onOpenSettings }: { onOpenSettings?: OpenWebsiteSettings }) {
  return (
    <HoldingSection icon={<BarChart3 className="h-4 w-4" />} title="Visits" subtitle="Visits counted by the platform, without cookies">
      <StaffOnlyNote feature="visits" />
      <GuideCard title="Switch the built-in statistics on for this project" state="Off" actions={<WebsiteTileButton tile="analytics" onOpen={onOpenSettings} />}>
        <Steps>
          <Step>
            Open <Ui>Website Settings → Analytics</Ui>.
          </Step>
          <Step>
            Switch <Ui>Built-in statistics</Ui> on, then press <Ui>Save</Ui>.
          </Step>
          <Step>Deploy the site. The deploy adds the counter to every page, and visits show here from then on.</Step>
        </Steps>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          A site deployed to another host (FTP, SFTP or git) reports its visits only when the platform has a public address
          (SW_PUBLIC_URL). A site hosted on the platform always does.
        </p>
      </GuideCard>
    </HoldingSection>
  );
}

// ── Search rankings ─────────────────────────────────────────────────────────────────────────────────────────────────

function DataForSeoSetup({ step, onOpenSystemSettings }: { step?: number; onOpenSystemSettings?: OpenSystemSettings }) {
  return (
    <GuideCard
      step={step}
      title="Set up rank tracking in System Settings"
      state="Not set up"
      intro={<SystemSettingsIntro section="rank-tracking" canOpen={Boolean(onOpenSystemSettings)} />}
      actions={<SystemSettingsButton section="rank-tracking" onOpen={onOpenSystemSettings} />}
    >
      <Steps label="DataForSEO setup">
        <Step>
          Create a DataForSEO account. A new account gets a small trial balance.
          <StepLinks links={[{ href: GUIDE_URLS.dataForSeoRegister, text: 'Sign up at DataForSEO' }]} />
        </Step>
        <Step>
          Open <Ui>API Access</Ui> in the DataForSEO dashboard. It shows the <Ui>API login</Ui> (the account email) and the{' '}
          <Ui>API password</Ui>. The API password is made for you and is not the password you sign in with. It is shown for the first 24
          hours; after that, use <Ui>Send by e-mail</Ui> there.
          <StepLinks links={[{ href: GUIDE_URLS.dataForSeoApiAccess, text: 'Open API Access' }]} />
        </Step>
        <Step>
          Add funds with <Ui>Add Funds</Ui> in the dashboard: checks are pay as you go, and the money does not expire. To try it for free
          first, skip this and pick the sandbox in the next step.
          <StepLinks links={[{ href: GUIDE_URLS.dataForSeoPricing, text: 'DataForSEO pricing' }]} />
        </Step>
        <Step>
          In <Ui>System Settings → Integrations → Keyword rank tracking</Ui>: set <Ui>Provider</Ui> to <Ui>DataForSEO</Ui>, paste the{' '}
          <Ui>API login</Ui> and <Ui>API password</Ui>, and set the <Ui>Monthly budget (USD)</Ui>. Under <Ui>Searches</Ui>,{' '}
          <Ui>Sandbox: free dummy results, for testing</Ui> costs nothing and returns made-up positions; switch to <Ui>Live searches</Ui> when
          you are ready. Then press <Ui>Save settings</Ui>.
        </Step>
        <Step>
          Press <Ui>Test saved credentials</Ui>. It answers <Ui>Connected</Ui> with the account balance.
        </Step>
      </Steps>
    </GuideCard>
  );
}

/**
 * Search rankings while rank tracking is not set up (no provider with credentials) or not enabled (no tracked domain,
 * or no keyword). Drawn ABOVE the staff setup in the rankings view: that setup is how keywords are added.
 */
export function RankingsGuide({ configured, tracked, onOpenSystemSettings }: { configured: boolean; tracked: boolean; onOpenSystemSettings?: OpenSystemSettings }) {
  return (
    <div className="flex flex-col gap-4">
      <StaffOnlyNote feature="rankings" />
      {!configured && <DataForSeoSetup step={1} onOpenSystemSettings={onOpenSystemSettings} />}
      <GuideCard step={configured ? undefined : 2} title="Enable it for this project" state="No keywords yet">
        <Steps label="Enable rank tracking for this project">
          {!tracked && (
            <Step>
              Below, under <Ui>Set up rank tracking</Ui>: enter the domain the site is published at, choose how often keywords are checked and
              how many results are read, then press <Ui>Save setup</Ui>.
            </Step>
          )}
          <Step>
            In <Ui>Manage keywords</Ui> below, add keywords (one per line) with the country, the place they are searched from, the language and
            the device, then press <Ui>Add keyword</Ui>.
          </Step>
          <Step>
            Press <Ui>Check now</Ui>, or wait for the next scheduled check. Each check is paid from the provider balance, and the monthly
            budget caps the total.
          </Step>
        </Steps>
      </GuideCard>
    </div>
  );
}

// ── Search performance ──────────────────────────────────────────────────────────────────────────────────────────────

function GoogleSteps() {
  return (
    <GuidePart title="Google service account">
      <Steps label="Google service account setup">
        <Step>
          In the Google Cloud console, select a project or create a new one.
          <StepLinks
            links={[
              { href: GUIDE_URLS.googleConsole, text: 'Google Cloud console' },
              { href: GUIDE_URLS.googleNewProject, text: 'Create a project' },
            ]}
          />
        </Step>
        <Step>
          In that project, enable the <Ui>Google Search Console API</Ui> and the <Ui>Site Verification API</Ui>: open each and press{' '}
          <Ui>Enable</Ui>.
          <StepLinks
            links={[
              { href: GUIDE_URLS.googleSearchConsoleApi, text: 'Google Search Console API' },
              { href: GUIDE_URLS.googleSiteVerificationApi, text: 'Site Verification API' },
            ]}
          />
        </Step>
        <Step>
          Go to <Ui>IAM &amp; Admin → Service accounts</Ui> and press <Ui>Create service account</Ui>. Give it a name (for example
          “sitewright”) and press <Ui>Done</Ui>: it needs no roles and no users.
          <StepLinks links={[{ href: GUIDE_URLS.googleServiceAccounts, text: 'Service accounts' }]} />
        </Step>
        <Step>
          Open the new service account, then <Ui>Keys → Add key → Create new key → JSON → Create</Ui>. The browser downloads the key file.
          Google keeps no copy, so store it safely.
        </Step>
        <Step>
          In <Ui>System Settings → Integrations → Search engine accounts</Ui>: <Ui>Upload key file</Ui>, press <Ui>Save settings</Ui>, then{' '}
          <Ui>Test saved credentials</Ui>.
        </Step>
      </Steps>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        If Google refuses to create the key, an organisation policy blocks it (<code className="break-all text-xs">iam.disableServiceAccountKeyCreation</code>
        , on by default for organisations created since May 2024). An organisation policy administrator can allow keys for this one project.
        <StepLinks links={[{ href: GUIDE_URLS.googleKeyPolicy, text: 'Google’s guide to key creation' }]} />
      </p>
    </GuidePart>
  );
}

function BingSteps() {
  return (
    <GuidePart title="Bing Webmaster API key">
      <Steps label="Bing Webmaster API key setup">
        <Step>
          Sign in to Bing Webmaster Tools with a Microsoft, Google or Facebook account. If Bing asks for a site first, add one you own.
          <StepLinks links={[{ href: GUIDE_URLS.bingWebmaster, text: 'Bing Webmaster Tools' }]} />
        </Step>
        <Step>
          Open <Ui>Settings</Ui> (the gear, top right) → <Ui>API Access</Ui>. The first time, accept the terms. Then choose <Ui>API Key</Ui> →{' '}
          <Ui>Generate API Key</Ui>, and copy it. There is one key per user.
          <StepLinks links={[{ href: GUIDE_URLS.bingApiAccessHelp, text: 'Microsoft’s guide' }]} />
        </Step>
        <Step>
          Paste it in <Ui>System Settings → Integrations → Search engine accounts → API key</Ui>, press <Ui>Save settings</Ui>, then{' '}
          <Ui>Test saved credentials</Ui>.
        </Step>
      </Steps>
    </GuidePart>
  );
}

const ENGINES: ReadonlyArray<{ key: WebmasterService; name: string }> = [
  { key: 'google', name: 'Google Search Console' },
  { key: 'bing', name: 'Bing Webmaster Tools' },
];

/** Where one search engine stands for this project, in a few words. */
function engineState(e: SiteRegistrationEntry): string {
  if (!e.configured) return 'no platform account yet';
  if (!e.enabled) return 'switched off';
  if (e.status === 'verified') return 'verified';
  if (e.status === 'failed') return `verification failed${e.detail ? `: ${e.detail}` : ''}`;
  return 'switched on, not verified yet';
}

/**
 * Search performance while no search engine account is set up (`configured` false; null when that could not be read)
 * or none is switched on and verified for the site.
 */
export function SearchGuide({
  configured,
  registration,
  onOpenSystemSettings,
  onOpenSettings,
}: {
  configured: boolean | null;
  registration: SiteRegistrationView | null;
  onOpenSystemSettings?: OpenSystemSettings;
  onOpenSettings?: OpenWebsiteSettings;
}) {
  const setUp = configured === true;
  return (
    <HoldingSection icon={<Search className="h-4 w-4" />} title="Search performance" subtitle="How often the site is shown and clicked in search results">
      <StaffOnlyNote feature="search" />
      {!setUp && (
        <GuideCard
          step={1}
          title="Set up a search engine account in System Settings"
          state={configured === false ? 'Not set up' : 'Could not be checked'}
          intro={
            <>
              <SystemSettingsIntro section="search-engine-accounts" canOpen={Boolean(onOpenSystemSettings)} />
              <p className="mt-1">Either account is enough: Google gives Google’s numbers, Bing gives Bing’s.</p>
            </>
          }
          actions={<SystemSettingsButton section="search-engine-accounts" onOpen={onOpenSystemSettings} />}
        >
          <GoogleSteps />
          <BingSteps />
        </GuideCard>
      )}
      <GuideCard
        step={setUp ? undefined : 2}
        title="Enable it for this project"
        state="Not verified yet"
        actions={<WebsiteTileButton tile="search-engines" onOpen={onOpenSettings} />}
      >
        {registration && (
          <ul aria-label="Search engines for this site" className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            {ENGINES.map((e) => (
              <li key={e.key}>
                <Ui>{e.name}</Ui>: {engineState(registration[e.key])}
              </li>
            ))}
          </ul>
        )}
        <Steps label="Enable search performance for this project">
          <Step>
            Open <Ui>Website Settings → Search engines</Ui>. The site needs an https Production URL first (<Ui>Website Settings → Site</Ui>).
          </Step>
          <Step>
            Switch on <Ui>Google Search Console</Ui>, <Ui>Bing Webmaster Tools</Ui> or both: each one the platform has an account for.
          </Step>
          <Step>
            Press <Ui>Verify now</Ui>. It deploys the site with the search engine’s tag, asks it to confirm, and submits the sitemap.
          </Step>
          <Step>Once verified, the numbers show here. A newly verified site takes a few days to show data.</Step>
        </Steps>
      </GuideCard>
    </HoldingSection>
  );
}
