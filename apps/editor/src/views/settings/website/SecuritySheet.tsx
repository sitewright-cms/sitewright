import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { isLinkPage, securityEmailIssue, securityPhoneIssue, SECURITY_TXT_EXPIRY_YEARS, type Page, type SecurityTxtExpiryYears } from '@sitewright/schema';
import { pagePath } from '@sitewright/core';
import { api } from '../../../api';
import type { Patch, SettingsForm } from '../model';
import { glassInput, fieldLabel } from '../../../theme';
import { SettingsSheet, type SheetSave } from '../board/Sheet';
import { securityContacts } from '../board/summaries';
import { ContactModeField, PageOrUrlField, type PageChoice } from './security-fields';

const HELP =
  'Publishes .well-known/security.txt (RFC 9116) — the standard place a security researcher looks for how to report a vulnerability in this site. Pick contacts from what the project already holds (a page, the company phone or email) so they cannot drift, or give security.txt contacts of its own.';

/**
 * security.txt's details. Its enable switch lives on the tile; this opens once it is on.
 *
 * Every link is a PAGE of this site (published as its absolute URL, so it follows a renamed page) or a
 * URL typed by hand; the phone and email are off, the Corporate Identity value, or a value of security.txt's
 * own. Both page links and the Canonical line need the production URL, so its absence is said up front.
 */
export function SecuritySheet({ form, patch, projectId, save, onClose }: { form: SettingsForm; patch: Patch; projectId: string; save: SheetSave; onClose: () => void }) {
  // The project's pages, for the three page pickers. A failure leaves the lists empty rather than breaking
  // the panel — the publish-time check is the real guard that a selected page exists.
  const [pages, setPages] = useState<Page[]>([]);
  const [pagesState, setPagesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let on = true;
    setPagesState('loading');
    api
      .listPages(projectId)
      .then((r) => {
        if (!on) return;
        setPages(r.items);
        setPagesState('ready');
      })
      .catch(() => on && setPagesState('error'));
    return () => {
      on = false;
    };
  }, [projectId, attempt]);
  // Real pages in the main language, labelled by their path (a menu placeholder has no URL of its own,
  // and a translated variant would only repeat its original).
  const choices = useMemo<PageChoice[]>(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    return pages
      .filter((p) => !isLinkPage(p) && (!p.locale || p.locale === form.defaultLocale))
      // "Contact — /contact/": the title is what people recognise, the path what gets published.
      .map((p) => {
        const path = pagePath(p, byId);
        return { id: p.id, label: p.title ? `${p.title} — ${path}` : path, keywords: path };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [pages, form.defaultLocale]);

  const noSiteUrl = !form.siteUrl.trim();
  const pageChosen = Boolean(form.securityContactPageId || form.securityPolicyPageId || form.securityAcknowledgmentsPageId);

  return (
    <SettingsSheet title="security.txt" help={HELP} onClose={onClose} save={save} size="xl">
      {noSiteUrl && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The production URL is not set (Website Settings → Site).{' '}
            {pageChosen
              ? 'The pages chosen below are published as absolute links, so the publish will fail until it is set.'
              : 'Pages can’t be linked and the file gets no Canonical line until it is set.'}
          </span>
        </p>
      )}

      {pagesState === 'error' && (
        <p role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          <span>Couldn’t load this site’s pages, so the page lists below are empty. Your saved choices are kept.</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="shrink-0 font-semibold underline">
            Retry
          </button>
        </p>
      )}

      <PageOrUrlField
        label="Contact page"
        hint="Preferred: a page with your contact form. It keeps working for as long as the site is up, and submissions are stored here even if the notification email fails. Or a URL of its own, e.g. a bug-bounty programme."
        pages={choices}
        pagesState={pagesState}
        pageId={form.securityContactPageId}
        url={form.securityContactUrl}
        onChange={({ pageId, url }) => patch({ securityContactPageId: pageId, securityContactUrl: url })}
        urlPlaceholder="https://hackerone.com/acme"
      />

      <ContactModeField
        label="Phone"
        ciValue={form.telephone}
        ciMissing="Company phone not set"
        mode={form.securityPhoneMode}
        value={form.securityPhone}
        onChange={(securityPhoneMode, securityPhone) => patch({ securityPhoneMode, securityPhone })}
        validate={securityPhoneIssue}
        placeholder="+49 30 1234567"
        hint="Published as a tel: link, so it needs a country code (e.g. +49 30 1234567)."
      />

      <ContactModeField
        label="Email"
        ciValue={form.email}
        ciMissing="Company email not set"
        mode={form.securityEmailMode}
        value={form.securityEmail}
        onChange={(securityEmailMode, securityEmail) => patch({ securityEmailMode, securityEmail })}
        validate={securityEmailIssue}
        placeholder="security@acme.com"
        hint="This file is public and machine-read — expect the address to be harvested for spam."
        type="email"
      />

      {securityContacts(form).length === 0 && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          Pick at least one contact — a security.txt without one is invalid, and the publish will fail.
        </p>
      )}

      <label className="flex flex-col">
        <span className={fieldLabel}>Valid for</span>
        <select
          aria-label="security.txt expiry window"
          className={glassInput}
          value={String(form.securityExpiryYears)}
          onChange={(e) => patch({ securityExpiryYears: Number(e.target.value) as SecurityTxtExpiryYears })}
        >
          {SECURITY_TXT_EXPIRY_YEARS.map((y) => (
            <option key={y} value={y}>
              {y} year{y === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
          The file states an expiry date. It is recalculated from scratch on every publish, so republishing
          always renews it.
        </span>
      </label>

      <PageOrUrlField
        label="Security policy"
        hint="Optional. A page describing how you handle reports."
        pages={choices}
        pagesState={pagesState}
        pageId={form.securityPolicyPageId}
        url={form.securityPolicyUrl}
        onChange={({ pageId, url }) => patch({ securityPolicyPageId: pageId, securityPolicyUrl: url })}
        urlPlaceholder="https://acme.com/security-policy/"
      />
      <PageOrUrlField
        label="Acknowledgments"
        hint="Optional. A page thanking researchers who reported responsibly."
        pages={choices}
        pagesState={pagesState}
        pageId={form.securityAcknowledgmentsPageId}
        url={form.securityAcknowledgmentsUrl}
        onChange={({ pageId, url }) => patch({ securityAcknowledgmentsPageId: pageId, securityAcknowledgmentsUrl: url })}
        urlPlaceholder="https://acme.com/hall-of-fame/"
      />
    </SettingsSheet>
  );
}
