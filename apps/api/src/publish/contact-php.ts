import {
  FORM_ID_FIELD,
  HONEYPOT_FIELD,
  TIMETRAP_FIELD,
  HCAPTCHA_RESPONSE_FIELD,
  MIN_SUBMIT_ELAPSED_MS,
  isContactPhpMode,
  type Form,
} from '@sitewright/schema';

/** Max raw request body the generated PHP accepts before rejecting (defense-in-depth). */
const PHP_MAX_BODY_BYTES = 128 * 1024;
/** Max JSON nesting depth the generated PHP decodes. */
const PHP_JSON_DEPTH = 10;
/** Socket connect + per-read timeout for the generated SMTP client, in seconds. */
const PHP_SMTP_TIMEOUT_S = 15;
/**
 * Ceiling on the WHOLE SMTP session, not one operation. Sized to finish inside the 30s
 * `max_execution_time` that shared hosting commonly enforces, with room left for the rest of the
 * request — otherwise the SAPI kills the script and the visitor sees the host's error page rather
 * than contact.php's own 502.
 */
const PHP_SMTP_TOTAL_S = 25;
/** Filename of the sibling credentials file (written ONLY into a deploy payload — see below). */
export const PHP_SMTP_CONFIG_FILE = 'sw-mail.config.php';
/** Guard constant `contact.php` defines before including the config; a direct hit 404s. */
const PHP_SMTP_GUARD = 'SW_CONTACT_MAILER';

// Generates `contact.php` for forms whose mode is `contactPhp` (host `mail()`) or
// `contactPhpSmtp` (authenticated SMTP). The exported PHP runs on the CUSTOMER's
// own host. One file handles every such form, dispatched by the hidden `_form`
// field; the per-form config records which transport that form uses.
//
// Security model:
//  - The recipient + subject are baked SERVER-SIDE (in the PHP, not the HTML) as a
//    JSON map, decoded at runtime — so neither reaches the browser, and JSON
//    encoding neutralizes any quote/backslash in the data.
//  - `recipient` is email-validated by FormSchema (no CRLF) → safe as mail() `to`.
//  - `subject` is CRLF-stripped in PHP before use (header-injection guard).
//  - Submitted values go into the mail BODY only (never headers); a submitted
//    `email` becomes Reply-To only after PHP-side email + CRLF validation.
//  - honeypot + time-trap mirror the platform endpoint (silent accept + drop).
//
// ★ CREDENTIALS ARE NEVER IN THIS FILE. `contactPhpSmtp` reads them from a sibling
//   `sw-mail.config.php` produced by `renderPhpSmtpConfig` and written ONLY into a
//   transient deploy payload by the main API process — never by the build worker
//   (which runs with no secrets by design) and never into the persisted published
//   directory (which the member-readable `/publish/archive` zip would then expose).
//   Absent config = fail closed: the form returns 500 rather than sending unauth'd.

interface ContactConfig {
  recipient: string;
  subject: string;
  /** true → deliver over authenticated SMTP (sw-mail.config.php); false → host mail(). */
  smtp: boolean;
}

/** Escapes a JS string for embedding inside a PHP single-quoted string literal. */
function phpSingleQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** True if `forms` contains at least one form served by contact.php (caller gates on this). */
export function hasContactPhpForm(forms: readonly Form[]): boolean {
  return forms.some((f) => isContactPhpMode(f.mode));
}

/** True if any form asks contact.php to deliver over authenticated SMTP (needs the config file). */
export function hasPhpSmtpForm(forms: readonly Form[]): boolean {
  return forms.some((f) => f.mode === 'contactPhpSmtp');
}

/** The SMTP credentials baked into `sw-mail.config.php` (password already DECRYPTED). */
export interface PhpSmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (e.g. 465). False → opportunistic STARTTLS on a plain connection. */
  secure: boolean;
  user?: string;
  password?: string;
  fromEmail: string;
  fromName?: string;
}

/**
 * Renders `sw-mail.config.php` — the ONLY artifact that ever contains the project's SMTP
 * password in plaintext.
 *
 * Exposure model (why this is a separate file rather than inline in contact.php):
 *  - It is `return`-only and guarded: a direct HTTP hit executes it, finds the guard constant
 *    undefined, and 404s WITHOUT emitting the array. Inline credentials in contact.php would
 *    have no such seam.
 *  - The build additionally emits an Apache deny rule for this filename (see build.ts). That is
 *    belt-and-braces — it does nothing on nginx.
 *  - NOTHING defends against a host that stops executing PHP (a misconfiguration serves the raw
 *    source) or against another tenant reading the file on shared hosting. That residual risk is
 *    inherent to putting a credential on a machine you do not control, which is precisely why the
 *    mode is a SEPARATE admin permission and is refused on git targets.
 */
export function renderPhpSmtpConfig(smtp: PhpSmtpConfig): string {
  const literal = phpSingleQuote(
    JSON.stringify({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user ?? '',
      pass: smtp.password ?? '',
      fromEmail: smtp.fromEmail,
      fromName: smtp.fromName ?? '',
    }),
  );
  return `<?php
// Generated by Sitewright — SMTP credentials for contact.php. KEEP THIS FILE PRIVATE.
// It is included by contact.php only; a direct request 404s (the guard below). Do not
// commit it to version control and do not copy it into a public bucket.
if (!defined('${PHP_SMTP_GUARD}')) { http_response_code(404); exit; }
return json_decode('${literal}', true);
`;
}

/**
 * Renders `contact.php`. Only contact.php-backed forms are included; the resolved
 * recipient + subject are baked per form id, along with which transport to use.
 * Returns the full PHP source. Contains NO credentials in either mode.
 */
export function renderContactPhp(
  forms: readonly Form[],
  /** Whole-session SMTP budget in seconds. Production always takes the default; the tests lower it
   *  so a stalling server can be exercised in seconds instead of half a minute. */
  opts: { totalTimeoutS?: number } = {},
): string {
  const map: Record<string, ContactConfig> = {};
  for (const form of forms) {
    if (!isContactPhpMode(form.mode)) continue;
    map[form.id] = {
      recipient: form.recipient,
      subject: form.subject || `New "${form.name}" submission`,
      smtp: form.mode === 'contactPhpSmtp',
    };
  }
  // JSON, then escaped for a PHP single-quoted literal (no PHP interpolation).
  const configLiteral = phpSingleQuote(JSON.stringify(map));
  const anySmtp = hasPhpSmtpForm(forms);

  return `<?php
// Generated by Sitewright — form-to-email. No credentials in this file.
// NOTE: this runs on YOUR host. Bots are filtered by a honeypot + time-trap, but
// for high-traffic sites add web-server rate limiting (e.g. mod_ratelimit / Nginx
// limit_req) in front of this file.
function sw_fail($code) { http_response_code($code); echo json_encode(array('ok' => false)); exit; }
${anySmtp ? smtpClientPhp(opts.totalTimeoutS ?? PHP_SMTP_TOTAL_S) : ''}
// Public, no-credentials endpoint: permissive CORS (mirrors the platform endpoint).
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: content-type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { sw_fail(405); }

$FORMS = json_decode('${configLiteral}', true);

$raw = file_get_contents('php://input');
if (strlen($raw) > ${PHP_MAX_BODY_BYTES}) { sw_fail(413); }
$data = json_decode($raw, true, ${PHP_JSON_DEPTH});
if (!is_array($data)) { sw_fail(400); }

$formId = isset($data['${FORM_ID_FIELD}']) && is_string($data['${FORM_ID_FIELD}']) ? $data['${FORM_ID_FIELD}'] : '';
if (!isset($FORMS[$formId])) { sw_fail(404); }
$cfg = $FORMS[$formId];

// Honeypot + time-trap: accept silently but drop (don't signal bots).
$hp = isset($data['${HONEYPOT_FIELD}']) && is_string($data['${HONEYPOT_FIELD}']) ? trim($data['${HONEYPOT_FIELD}']) : '';
$elapsed = isset($data['${TIMETRAP_FIELD}']) ? intval($data['${TIMETRAP_FIELD}']) : 0;
if ($hp !== '' || $elapsed < ${MIN_SUBMIT_ELAPSED_MS}) { echo json_encode(array('ok' => true)); exit; }

$skip = array('${HONEYPOT_FIELD}', '${TIMETRAP_FIELD}', '${FORM_ID_FIELD}', '${HCAPTCHA_RESPONSE_FIELD}');
$lines = array();
$replyTo = '';
foreach ($data as $k => $v) {
  if (!is_string($k) || in_array($k, $skip, true)) { continue; }
  if (!is_string($v)) { continue; }
  $lines[] = $k . ":\\n  " . str_replace("\\n", "\\n  ", $v);
  if ($k === 'email' && filter_var($v, FILTER_VALIDATE_EMAIL) && strpbrk($v, "\\r\\n") === false) {
    $replyTo = $v;
  }
}

$to = $cfg['recipient'];
// Strip CR/LF from the subject (header-injection guard).
$subject = str_replace(array("\\r", "\\n"), '', $cfg['subject']);
$body = 'New submission for "' . $formId . "\\"\\n\\n" . implode("\\n\\n", $lines) . "\\n";
$headers = 'Content-Type: text/plain; charset=utf-8';
if ($replyTo !== '') { $headers .= "\\r\\nReply-To: " . $replyTo; }

${anySmtp ? SMTP_DISPATCH_PHP : MAIL_DISPATCH_PHP}
echo json_encode(array('ok' => true));
`;
}

/** Delivery when NO form uses SMTP — the export then contains no SMTP code at all. */
const MAIL_DISPATCH_PHP = `if (!@mail($to, $subject, $body, $headers)) { sw_fail(502); }`;

/**
 * Delivery when at least one form uses SMTP. Both branches exist because ONE contact.php serves
 * every php-backed form in the project, and they may mix transports.
 */
const SMTP_DISPATCH_PHP = `if (!empty($cfg['smtp'])) {
  // Authenticated SMTP with the project's own credentials. Fail CLOSED: a missing or
  // unreadable config must NOT silently fall back to mail() — the operator chose SMTP
  // precisely because the host's mail() is unreliable/unaligned, and a silent downgrade
  // would look like success while landing in spam.
  define('${PHP_SMTP_GUARD}', 1);
  $conf = @include __DIR__ . '/${PHP_SMTP_CONFIG_FILE}';
  if (!is_array($conf) || empty($conf['host'])) { sw_fail(500); }
  if (!sw_smtp_send($conf, $to, $subject, $body, $replyTo)) { sw_fail(502); }
} else {
  if (!@mail($to, $subject, $body, $headers)) { sw_fail(502); }
}`;

// ---------------------------------------------------------------------------------------------
// The SMTP client, emitted into contact.php only when a form needs it.
//
// Hand-rolled on purpose: the alternative is vendoring PHPMailer (thousands of lines + its own
// CVE stream) into every exported site. This speaks the subset SMTP actually needs — EHLO,
// optional STARTTLS, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA — with explicit timeouts so a black-holed
// host can't hang the visitor's request.
//
// Correctness details that are easy to get wrong, each covered by a test that runs this PHP
// against a scripted SMTP server:
//  - Multi-line replies ("250-PIPELINING" … "250 HELP") must be read to the LAST line, which is
//    the one with a SPACE in column 4. Stopping at the first line desynchronises the session.
//  - The body must be CRLF-terminated and DOT-STUFFED (a line that is just "." would otherwise
//    end DATA early; RFC 5321 §4.5.2).
//  - Non-ASCII subjects/display-names are RFC 2047 base64 word-encoded; a raw 8-bit header is not
//    legal and gets mangled or rejected.
//  - TLS peer verification is left ON (PHP's default since 5.6) — set explicitly so a future
//    reader sees it was a decision, not an omission.
const smtpClientPhp = (totalTimeoutS: number): string => `
/**
 * Holds (and reads back) the wall-clock deadline for the WHOLE session.
 *
 * A per-operation timeout bounds each individual wait but NOT their sum: a session is up to ~10
 * waits (greeting, EHLO, STARTTLS, re-EHLO, up to three AUTH round-trips, MAIL, RCPT, DATA, the
 * final ack), so a server that answers just under the limit every time can hold the request for
 * minutes. Shared hosting — the environment this whole mode exists for — commonly caps
 * max_execution_time at 30-60s, and the SAPI then kills the script mid-flight: the visitor gets the
 * host's raw error page instead of our clean 502, and contact.php's own failure handling never runs.
 */
function sw_smtp_deadline($set = null) {
  static $at = 0.0;
  if ($set !== null) { $at = (float) $set; }
  return $at;
}

/** Whole seconds left in the session budget; 0 once it is spent. */
function sw_smtp_left() {
  $left = (int) ceil(sw_smtp_deadline() - microtime(true));
  return $left > 0 ? $left : 0;
}

/** Reads one complete SMTP reply (handles multi-line "250-" continuations). */
function sw_smtp_read($fp) {
  $out = '';
  while (true) {
    // Re-arm the socket with what is LEFT of the whole-session budget rather than a fresh full
    // timeout, so the total cannot outrun it however many round trips the server drags us through.
    $left = sw_smtp_left();
    // Budget spent: return an empty reply. Every caller compares against an expected code, so ''
    // fails every one of them and the send aborts cleanly instead of running until the SAPI kills it.
    if ($left <= 0) { return ''; }
    stream_set_timeout($fp, $left);
    $line = fgets($fp, 1024);
    if ($line === false) { break; }
    $out .= $line;
    // Last line of a reply has a SPACE in the 4th column ("250 ok"); "250-" continues.
    if (strlen($line) < 4 || $line[3] === ' ') { break; }
  }
  return $out;
}

/** Sends one command (or none) and returns the server's complete reply. */
function sw_smtp_say($fp, $cmd) {
  if ($cmd !== null) { fwrite($fp, $cmd . "\\r\\n"); }
  return sw_smtp_read($fp);
}

/** Sends one command (or none) and returns true when the reply starts with $expect. */
function sw_smtp_cmd($fp, $cmd, $expect) {
  return substr(sw_smtp_say($fp, $cmd), 0, strlen($expect)) === $expect;
}

/** RFC 2047 encodes a header value when it is not plain ASCII. */
function sw_smtp_header($value) {
  if (preg_match('/^[\\x20-\\x7E]*$/', $value)) { return $value; }
  return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

/**
 * Formats a display name for a From:/To: mailbox. Plain ASCII is NOT automatically safe here: in
 * the RFC 5322 grammar an unquoted comma separates mailboxes, so "Acme, Inc." <a@b> parses as two
 * addresses, and a bare quote opens a string that never closes. Any such name goes in a quoted
 * string with the two characters that are special inside one escaped; non-ASCII still takes the
 * RFC 2047 path, which is already a safe token and must NOT then be quoted.
 */
function sw_smtp_display_name($value) {
  $encoded = sw_smtp_header($value);
  if ($encoded !== $value) { return $encoded; }
  // strpbrk/addcslashes rather than two regexes: a character class needing a literal backslash has
  // to survive BOTH the JS template literal and PHP's single-quoted string, and the version that
  // did not returned NULL from preg_replace — which concatenates as an EMPTY display name.
  if (strpbrk($value, '()<>[]:;@\\\\,."') === false) { return $value; }
  return '"' . addcslashes($value, '"\\\\') . '"';
}

/**
 * Delivers one message over authenticated SMTP. Returns false on ANY failure — the caller
 * turns that into a 502 so the visitor can retry; it never falls back to mail().
 */
function sw_smtp_send($conf, $to, $subject, $body, $replyTo) {
  $host = (string) $conf['host'];
  $port = (int) $conf['port'];
  $secure = !empty($conf['secure']);
  $timeout = ${PHP_SMTP_TIMEOUT_S};
  // Start the whole-session clock BEFORE connecting — a black-holed host burns the budget on the
  // TCP connect just as effectively as on a slow reply.
  sw_smtp_deadline(microtime(true) + ${totalTimeoutS});
  // Peer verification ON (PHP default) — an unverified TLS session would hand the
  // credentials to anyone able to MITM the connection.
  $ctx = stream_context_create(array('ssl' => array(
    'verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true,
  )));
  $endpoint = ($secure ? 'ssl://' : 'tcp://') . $host . ':' . $port;
  // The connect gets the smaller of its own limit and the session budget — a 15s connect inside a
  // 10s budget would blow the whole thing on the first step.
  $connect = min($timeout, sw_smtp_left());
  if ($connect <= 0) { return false; }
  $fp = @stream_socket_client($endpoint, $errno, $errstr, $connect, STREAM_CLIENT_CONNECT, $ctx);
  if (!$fp) { return false; }
  stream_set_timeout($fp, $timeout); // re-armed from the remaining budget before every read

  $ok = true;
  // Greeting, then EHLO.
  if (!sw_smtp_cmd($fp, null, '220')) { $ok = false; }
  $ehlo = 'EHLO ' . (isset($_SERVER['SERVER_NAME']) && $_SERVER['SERVER_NAME'] !== '' ? $_SERVER['SERVER_NAME'] : 'localhost');
  $greeting = $ok ? sw_smtp_say($fp, $ehlo) : '';
  if ($ok && substr($greeting, 0, 3) !== '250') { $ok = false; }

  // STARTTLS when the server ADVERTISED it (don't poke servers that didn't — some drop the
  // connection on an unknown verb). Implicit-TLS connections are already encrypted.
  $encrypted = $secure;
  if ($ok && !$secure && stripos($greeting, 'STARTTLS') !== false) {
    if (substr(sw_smtp_say($fp, 'STARTTLS'), 0, 3) === '220') {
      // RFC 3207 6: everything learned before the handshake must be DISCARDED. PHP does not do
      // that for us — fgets() over-reads past the "220" into a userland buffer that survives
      // stream_socket_enable_crypto(), so bytes an on-path attacker appends to that line are read
      // back later as though they had arrived INSIDE the verified session (a forged capability
      // list, an AUTH acceptance, a "queued" receipt for mail that was never sent). A compliant
      // server says nothing more until the handshake, so anything already buffered means the
      // connection is under attack: abort rather than upgrade. Data that instead arrives between
      // this check and the handshake is consumed as handshake input and fails it, so both orders
      // end closed.
      $pending = stream_get_meta_data($fp);
      if (!empty($pending['unread_bytes'])) { $ok = false; }
      elseif (@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
        $encrypted = true;
        // RFC 3207: re-issue EHLO over the encrypted channel (the capability list can change).
        if (!sw_smtp_cmd($fp, $ehlo, '250')) { $ok = false; }
      }
    }
  }

  // AUTH (only when a user is configured). PLAIN first, LOGIN as the fallback.
  $user = isset($conf['user']) ? (string) $conf['user'] : '';
  $pass = isset($conf['pass']) ? (string) $conf['pass'] : '';
  // A relay reached over the LOOPBACK interface has no on-path attacker by construction, which is
  // the one case where an unencrypted, unauthenticated session is genuinely safe (the classic
  // shared-hosting "localhost:25"). Anywhere else, opportunistic TLS can simply be stripped: an
  // attacker forges the EHLO reply WITHOUT the STARTTLS capability, so the upgrade is never even
  // attempted, and a client that shrugs and continues hands the visitor's message — name, email,
  // whatever the form collects — to whoever is on the path, while still reporting success.
  $loopback = ($host === 'localhost' || $host === '::1' || strpos($host, '127.') === 0);
  // TWO rules, and they are not the same rule. Credentials never go on the wire unencrypted
  // ANYWHERE, loopback included — this password belongs to the customer's real mailbox and there is
  // no reading of "convenient" that justifies it. Separately, no MESSAGE goes out unencrypted to a
  // remote host: guarding only the password would let an unauthenticated remote relay carry the
  // visitor's submission in the clear to whoever forged the greeting. We ABORT, never downgrade.
  if ($ok && !$encrypted && $user !== '') { $ok = false; }
  if ($ok && !$encrypted && !$loopback) { $ok = false; }
  if ($ok && $user !== '') {
    $plain = base64_encode("\\0" . $user . "\\0" . $pass);
    if (substr(sw_smtp_say($fp, 'AUTH PLAIN ' . $plain), 0, 3) !== '235') {
      if (!sw_smtp_cmd($fp, 'AUTH LOGIN', '334')) { $ok = false; }
      elseif (!sw_smtp_cmd($fp, base64_encode($user), '334')) { $ok = false; }
      elseif (!sw_smtp_cmd($fp, base64_encode($pass), '235')) { $ok = false; }
    }
  }

  $from = (string) $conf['fromEmail'];
  if ($ok && !sw_smtp_cmd($fp, 'MAIL FROM:<' . $from . '>', '250')) { $ok = false; }
  if ($ok && !sw_smtp_cmd($fp, 'RCPT TO:<' . $to . '>', '250')) { $ok = false; }
  if ($ok && !sw_smtp_cmd($fp, 'DATA', '354')) { $ok = false; }

  if ($ok) {
    $fromName = isset($conf['fromName']) ? (string) $conf['fromName'] : '';
    $fromHeader = $fromName !== '' ? sw_smtp_display_name($fromName) . ' <' . $from . '>' : $from;
    $domain = strpos($from, '@') !== false ? substr($from, strpos($from, '@') + 1) : 'localhost';
    $headers = array(
      'From: ' . $fromHeader,
      'To: ' . $to,
      'Subject: ' . sw_smtp_header($subject),
      'Date: ' . date('r'),
      'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domain . '>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    );
    if ($replyTo !== '') { $headers[] = 'Reply-To: ' . $replyTo; }
    // Normalize to CRLF, then DOT-STUFF (a lone "." line would terminate DATA early).
    $normalized = preg_replace('/\\r\\n|\\r|\\n/', "\\r\\n", $body);
    $stuffed = preg_replace('/^\\./m', '..', $normalized);
    $payload = implode("\\r\\n", $headers) . "\\r\\n\\r\\n" . $stuffed . "\\r\\n.\\r\\n";
    fwrite($fp, $payload);
    if (!sw_smtp_cmd($fp, null, '250')) { $ok = false; }
  }

  @fwrite($fp, "QUIT\\r\\n");
  @fclose($fp);
  return $ok;
}
`;
