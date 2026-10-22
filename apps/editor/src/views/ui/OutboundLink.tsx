import { ExternalLink } from 'lucide-react';
import { smallGhostButton } from '../../theme';

/**
 * A link to another site (Search Console, Bing Webmaster Tools, a provider's sign-up page) drawn as a small button,
 * opening in a new tab. `label` names it for assistive tech when the visible words are short ("Open").
 */
export function OutboundLink({ href, label, children }: { href: string; label?: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={smallGhostButton}>
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
