/**
 * Props for a `type="password"` input that is NOT a credential for *this* site.
 *
 * The editor has two very different kinds of masked field. One is a real credential — signing in,
 * changing your own password, confirming with it before arming MFA — where a password manager filling
 * and saving is exactly the behaviour you want. The other is a THIRD-PARTY SECRET the operator is
 * configuring: an SMTP password, an AI provider key, an OIDC client secret, a deploy target's FTP
 * password. Those are masked for shoulder-surfing, not because they log anyone in here.
 *
 * Browsers and extensions cannot tell them apart on their own — `type="password"` is the whole signal
 * they get — so every one of these prompts "save your password for this site?", and offers to autofill
 * the account password into an SMTP box on the next visit. Spreading these attributes over the
 * secret-config fields (and NOT over the credential fields) is what separates the two.
 *
 * `autocomplete="off"` is the standard; the vendor attributes are what the major managers actually
 * honour, since most deliberately ignore `off` on password inputs after years of sites misusing it.
 */
export const secretFieldProps = {
  autoComplete: 'off',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-protonpass-ignore': 'true',
} as const;
