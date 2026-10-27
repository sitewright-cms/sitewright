import type { BookingConfig } from '@sitewright/schema';
import { PartHeading, TextField, ToggleRow } from './fields';

/** The set-up's own settings: who hears of bookings, the customer's booking page, and spam protection. */
export function GeneralPanel({
  draft,
  onChange,
  issues,
}: {
  draft: BookingConfig;
  onChange: (next: BookingConfig) => void;
  issues: ReadonlyMap<string, string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <PartHeading tip="Told of every booking, request and cancellation, and the organiser of the calendar invitations resources get. Customers see it: their replies to a confirmation go here.">
          Notifications
        </PartHeading>
        <div className="max-w-md">
          <TextField
            label="Business address"
            type="email"
            value={draft.notifyEmail ?? ''}
            placeholder="bookings@studio.example"
            onChange={(v) => onChange({ ...draft, notifyEmail: v.trim() ? v : undefined })}
            error={issues.get('notifyEmail')}
            hint="Use an address customers may write to. Empty: only resources with an address of their own hear of their bookings."
          />
        </div>
      </div>

      <div>
        <PartHeading tip="The page of your site where a customer sees their booking and can cancel it: the page carrying {{sw-booking-status}}. Every booking email links there.">
          The customer’s booking page
        </PartHeading>
        <div className="max-w-md">
          <TextField
            label="Page path"
            value={draft.statusPath ?? ''}
            placeholder="/my-booking/"
            onChange={(v) =>
              onChange({
                ...draft,
                statusPath: v.trim() ? v.trim() : undefined,
              })
            }
            error={issues.get('statusPath')}
            hint="A page of this site with {{sw-booking-status}} on it. Empty: booking emails carry no link to manage the booking."
          />
        </div>
      </div>

      <div>
        <PartHeading tip="Checks on every booking request, so a script cannot fill the calendar with fake bookings.">Spam protection</PartHeading>
        <div className="flex max-w-2xl flex-col gap-2">
          <ToggleRow label="Proof of work (recommended)" checked={draft.pow} onChange={(pow) => onChange({ ...draft, pow })}>
            The visitor’s browser solves a small puzzle while they fill in the form. Nothing to click, no third party. Needs the site on HTTPS.
          </ToggleRow>
          <ToggleRow label="Captcha" checked={draft.captcha} onChange={(captcha) => onChange({ ...draft, captcha })}>
            The project’s captcha, as set up for forms in the Website settings.
          </ToggleRow>
        </div>
      </div>
    </div>
  );
}
