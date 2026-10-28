import type { BookingConfig } from '@sitewright/schema';
import { NumField, PartHeading, TextField, ToggleRow } from './fields';
import { PaymentSettings, type BookingGateways } from './PaymentFields';

/** The set-up's own settings: who hears of bookings, the customer's booking page, payment, and spam protection. */
export function GeneralPanel({
  draft,
  onChange,
  issues,
  gateways,
}: {
  draft: BookingConfig;
  onChange: (next: BookingConfig) => void;
  issues: ReadonlyMap<string, string>;
  /** The project's payment providers (loading: undefined). */
  gateways?: BookingGateways;
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
        <PartHeading tip="An email to the customer before their booking starts, with the link to their booking page. A booking made closer to its start than this gets none: its confirmation has just gone out. Bookings in the coming week made while reminders were off get none either.">
          Reminders
        </PartHeading>
        <div className="max-w-xs">
          <NumField
            label="Remind customers"
            value={draft.remindBeforeMin === undefined ? undefined : draft.remindBeforeMin / 60}
            min={1}
            max={168}
            suffix="hours before"
            placeholder="none"
            onChange={(hours) => onChange({ ...draft, remindBeforeMin: hours === undefined ? undefined : hours * 60 })}
            error={issues.get('remindBeforeMin')}
          />
        </div>
      </div>

      <div>
        <PartHeading tip="How offerings with a price are paid: through one of the project's payment providers, in one currency. The customer pays on the provider's page when they book; the time is held for them meanwhile, and booked when the payment arrives.">
          Payment
        </PartHeading>
        <PaymentSettings draft={draft} onChange={onChange} issues={issues} gateways={gateways} />
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
