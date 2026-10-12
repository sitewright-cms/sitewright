/** How long a temporary password lasts, as the confirmations before issuing one put it. */
export const TEMPORARY_PASSWORD_LIFETIME = '7 days';

/**
 * What an admin is told before issuing a password for somebody else's account — one wording for every
 * place that does it. The second sentence is the part that surprises: the account is held at the
 * "choose a new password" screen from its next request, in sessions that are already open too. The
 * way out through single sign-on is named because for an account that only ever signs in that way,
 * it is the one they will take.
 */
export function resetPasswordWarning(email: string): string {
  return `${resetPasswordQuestion(email)} ${TEMPORARY_PASSWORD_CONSEQUENCE}`;
}

/** The two halves of {@link resetPasswordWarning}, for a dialog with room to set them apart. */
export function resetPasswordQuestion(email: string): string {
  return `Issue ${email} a new password? Any password they have now stops working immediately, and the new one is shown ONCE.`;
}
export const TEMPORARY_PASSWORD_CONSEQUENCE =
  `It is temporary: they cannot use the editor until they have signed in with it and chosen their own ` +
  `(or signed in through single sign-on, which discards it), and it stops working after ${TEMPORARY_PASSWORD_LIFETIME}.`;
