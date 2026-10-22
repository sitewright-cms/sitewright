import { useId, type ReactNode } from 'react';
import { EyeOff, Settings } from 'lucide-react';
import { accentChip, glassCard, primaryButton } from '../../theme';
import { OutboundLink } from '../ui/OutboundLink';
import type { OpenSystemSettings, OpenWebsiteSettings, SystemSettingsSection, WebsiteSettingsTile } from '../../lib/settings-links';

/**
 * The pieces of a Statistics view's HOLDING MESSAGE: what agency staff see in place of a view whose feature is not set
 * up in System Settings, or not enabled for the project, yet. A client never sees one — the view is simply not there.
 */

export type StatisticsFeature = 'visits' | 'rankings' | 'search';

/** Who sees the view once it is live, per feature: one fact per line, the first in bold. */
const WHEN_MEMBERS_SEE_IT: Record<StatisticsFeature, string> = {
  visits: 'Project members see it once the built-in statistics are switched on for this project. They need nothing set up in System Settings.',
  rankings:
    'Project members see it once keyword rank tracking is set up in System Settings and enabled for this project: a tracked domain with at least one keyword.',
  search:
    'Project members see it once a search engine account (Google or Bing) is set up in System Settings and enabled for this project: switched on and verified in the Search engines tile.',
};

/** (a) The view is staff-only for now, and what makes it everyone's. */
export function StaffOnlyNote({ feature }: { feature: StatisticsFeature }) {
  return (
    <div
      role="note"
      aria-label="Only visible to admins and developers"
      className="flex gap-3 rounded-lg border border-sky-300/70 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
    >
      <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0">
        <strong className="block font-semibold">Only admins and developers see this view.</strong>
        {/* eslint-disable-next-line security/detect-object-injection -- feature is a StatisticsFeature literal */}
        <span className="block">{WHEN_MEMBERS_SEE_IT[feature]}</span>
      </p>
    </div>
  );
}

/** A view's frame while it holds a guide: the same header the view has, the guide for a body. */
export function HoldingSection({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className={`${glassCard} overflow-hidden`} aria-labelledby={headingId}>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 bg-slate-100/70 px-5 py-3 dark:border-slate-700/70 dark:bg-white/10">
        <span className={accentChip} aria-hidden>
          {icon}
        </span>
        <h2 id={headingId} className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          {title}
        </h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</span>
      </header>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

/** One stage of a guide — set up in System Settings, or enable for this project — with its steps. */
export function GuideCard({
  step,
  title,
  state,
  intro,
  children,
  actions,
}: {
  step?: number;
  title: string;
  state: string;
  intro?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-white/60 p-4 dark:border-white/10 dark:bg-white/5"
    >
      {/* The number keeps its place beside a title that wraps (a phone); the state follows the title. */}
      <header className="flex items-start gap-2">
        {step !== undefined && (
          <span
            aria-hidden
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 dark:bg-white/15 dark:text-slate-100"
          >
            {step}
          </span>
        )}
        <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={headingId} className="text-sm font-bold text-slate-800 dark:text-slate-100">
            {/* The space outside the hidden span: inside it, a name run together ("Step 1:Set up") is possible. */}
            {step !== undefined && (
              <>
                <span className="sr-only">Step {step}:</span>{' '}
              </>
            )}
            {title}
          </h3>
          <span className="rounded-full border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
            {state}
          </span>
        </div>
      </header>
      {intro && <div className="text-sm text-slate-600 dark:text-slate-300">{intro}</div>}
      {children}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

/** A numbered list of steps. `label` names it when a card holds more than one (Google, Bing). */
export function Steps({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ol
      aria-label={label}
      className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-700 marker:font-semibold marker:text-slate-500 dark:text-slate-200 dark:marker:text-slate-400"
    >
      {children}
    </ol>
  );
}

export function Step({ children }: { children: ReactNode }) {
  return <li className="pl-1 leading-relaxed">{children}</li>;
}

/** A sub-heading inside a card (one per account it covers). */
export function GuidePart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
      {children}
    </div>
  );
}

/** A label or menu path as it reads on screen ("Keys → Add key"). */
export function Ui({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>;
}

/** The outbound links of one step, as a row of small buttons under its words (as Search Console owners does). */
export function StepLinks({ links }: { links: ReadonlyArray<{ href: string; text: string }> }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <OutboundLink key={l.href} href={l.href}>
          {l.text}
        </OutboundLink>
      ))}
    </span>
  );
}

const SECTION_LABEL: Record<SystemSettingsSection, string> = {
  'rank-tracking': 'Keyword rank tracking',
  'search-engine-accounts': 'Search engine accounts',
};

/** Where a System Settings stage is done: said in the card's intro, worded for who is reading. */
export function SystemSettingsIntro({ section, canOpen }: { section: SystemSettingsSection; canOpen: boolean }) {
  // eslint-disable-next-line security/detect-object-injection -- section is a SystemSettingsSection literal
  const where = `System Settings → Integrations → ${SECTION_LABEL[section]}`;
  return canOpen ? (
    <p>
      Done once for the whole platform, in <Ui>{where}</Ui>.
    </p>
  ) : (
    <p>
      <strong className="block font-semibold text-slate-800 dark:text-slate-100">An instance admin does this, once for the whole platform.</strong>
      <span className="block">
        It is in <Ui>{where}</Ui>, which only instance admins can open. Send them these steps.
      </span>
    </p>
  );
}

/** The button that opens System Settings at the section: instance admins only (the callback is theirs alone). */
export function SystemSettingsButton({ section, onOpen }: { section: SystemSettingsSection; onOpen?: OpenSystemSettings }) {
  if (!onOpen) return null;
  return (
    <button type="button" className={primaryButton} onClick={() => onOpen({ tab: 'integrations', section })}>
      <Settings className="h-4 w-4" aria-hidden /> Open System Settings → Integrations
    </button>
  );
}

const TILE_LABEL: Record<WebsiteSettingsTile, string> = {
  analytics: 'Analytics',
  'search-engines': 'Search engines',
};

/** The button that opens Website Settings at a tile. */
export function WebsiteTileButton({ tile, onOpen }: { tile: WebsiteSettingsTile; onOpen?: OpenWebsiteSettings }) {
  if (!onOpen) return null;
  return (
    <button type="button" className={primaryButton} onClick={() => onOpen(tile)}>
      {/* eslint-disable-next-line security/detect-object-injection -- tile is a WebsiteSettingsTile literal */}
      <Settings className="h-4 w-4" aria-hidden /> Open Website Settings → {TILE_LABEL[tile]}
    </button>
  );
}
