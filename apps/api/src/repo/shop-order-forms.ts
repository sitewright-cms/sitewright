import {
  FormSchema,
  isPlatformRoutedMode,
  shopOrderFormId,
  type Form,
  type FormField,
  type FormMode,
  type ShopChannel,
} from '@sitewright/schema';
import type { ContentRepository, Settings } from './content.js';
import type { ProjectContext } from './context.js';

/**
 * Keep the mini-shop's order Forms in step with the shop settings.
 *
 * The shop's `form` channel takes an ADDRESS, not a Form — but server-side delivery is not something
 * an address alone can do. It needs a spam-guarded endpoint, an SMTP mode, an inbox row and a
 * retry path for failed mail, and all of that is what a Form IS. So the platform provisions one per
 * channel and the operator never sees it as a thing to build.
 *
 * ★ ONE WRITER. This function is the only thing that writes a `managed:'shop'` Form, and it runs on
 * the settings save. The Forms tab renders such a form read-only. That is what makes derivation safe:
 * shared state written from two places is the failure this codebase has already been bitten by, and
 * here there is only ever one.
 *
 * It does NOT delete a form whose channel is removed. A deleted form takes its SUBMISSIONS with it
 * (the inbox joins on the id), so tidying up the config would silently destroy order history —
 * removing a channel stops new orders, and the record of the old ones stays.
 */

/** A shop field key → the Form field the endpoint validates and labels the email with. */
function toFormField(f: { key: string; type: string; required?: boolean }): FormField {
  return {
    name: f.key,
    // The DISPLAY label is translatable and lives in the catalog under `shop.<key>`, resolved per
    // locale when the cart renders. A Form's label is used for the notification email, which has no
    // locale, so the stable key is the honest choice here rather than one arbitrary language.
    label: f.key,
    type: (f.type === 'textarea' || f.type === 'email' || f.type === 'tel' || f.type === 'number' ? f.type : 'text') as FormField['type'],
    ...(f.required ? { required: true } : {}),
  } as FormField;
}

/**
 * The delivery mode for a provisioned order form: whichever platform-routed mode the instance allows.
 *
 * `globalSmtp` is preferred (the operator's own SMTP, configured once); `userSmtp` is used when the
 * instance only permits per-project SMTP. A non-routed mode (contact.php, third-party) is never
 * chosen — those post somewhere else entirely and would never reach the inbox.
 */
export function orderFormMode(allowed: Partial<Record<FormMode, boolean>>): FormMode {
  if (allowed.globalSmtp) return 'globalSmtp';
  if (allowed.userSmtp) return 'userSmtp';
  // Neither enabled: still write `globalSmtp` so the form is coherent and starts working the moment
  // an admin turns a mode on. The submit endpoint already logs "stored but not emailed" in that case,
  // and the order is in the inbox either way — which is better than refusing to provision at all.
  return 'globalSmtp';
}

/** Build the Form a `form` channel implies. Returns null for a legacy channel that still names one. */
export function orderFormFor(channel: ShopChannel, mode: FormMode): Form | null {
  if (channel.kind !== 'form' || !channel.email) return null;
  const fields = (channel.fields ?? []).map(toFormField);
  return FormSchema.parse({
    id: shopOrderFormId(channel.key),
    name: `Shop orders — ${channel.key}`,
    managed: 'shop',
    recipient: channel.email,
    ...(channel.subject ? { subject: channel.subject } : {}),
    // A Form must declare at least one field. A channel with none still collects the ORDER itself
    // (cart_text / cart_json), so give it a single optional note rather than refusing to provision:
    // an order with no buyer questions is a legitimate shop, not a misconfiguration.
    fields: fields.length ? fields : [{ name: 'note', label: 'note', type: 'textarea' }],
    mode,
    captcha: channel.captcha ?? false,
  });
}

/**
 * Provision/refresh the managed order Form for every `form` channel in `settings`.
 *
 * Best-effort by design: it runs AFTER the settings write has already succeeded, so a failure here
 * must not turn a saved setting into an error the operator sees. It is logged and retried on the next
 * save — the same posture as the widget-dataset provisioning that runs on a page save.
 */
export async function ensureShopOrderForms(
  contentRepo: ContentRepository,
  ctx: ProjectContext,
  settings: Settings,
  allowedModes: Partial<Record<FormMode, boolean>>,
  log?: { warn: (o: unknown, m: string) => void },
): Promise<void> {
  const channels = settings.website?.shop?.channels ?? [];
  const mode = orderFormMode(allowedModes);
  for (const channel of channels) {
    const form = orderFormFor(channel, mode);
    if (!form) continue;
    try {
      // Skip an identical rewrite: a settings save that did not touch the shop should not churn the
      // form's revision history (every content write records one).
      const prior = (await contentRepo.get(ctx, 'form', form.id).catch(() => undefined)) as Form | undefined;
      if (prior && JSON.stringify({ ...prior }) === JSON.stringify(form)) continue;
      await contentRepo.put(ctx, 'form', form.id, form);
    } catch (err) {
      log?.warn({ err: err instanceof Error ? err.message : String(err), formId: form.id }, 'could not provision the shop order form');
    }
  }
}

/** True when this form is owned by the shop — the Forms tab must not let it be edited or deleted. */
export function isManagedForm(form: Pick<Form, 'managed'>): boolean {
  return form.managed !== undefined;
}

/** Platform-routed check re-exported so callers do not reach past this module for it. */
export { isPlatformRoutedMode };
