import { useEffect, useState, type FormEvent } from 'react';
import { api, type Project, type SmtpInput } from '../api';
import { glassCard, glassInput, primaryButton, ghostButton, toggleInput } from '../theme';

/**
 * Per-project SMTP config — used by forms whose delivery mode is "Project SMTP"
 * (userSmtp) and by "contact.php (SMTP)", which sends with these same credentials
 * from the exported site. The password is write-only (the API returns only a presence
 * flag; leave it blank to keep the stored one). Owner/admin only; a non-writer gets a
 * 403 which we surface as a notice.
 */
export function ProjectSmtp({ project }: { project: Project }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; to?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  // Only agency staff may aim the test message at an address of their choosing — a project member
  // is an invited client. The server enforces it either way; this just decides whether to offer the
  // field, so a client is not shown a control that would only ever 403.
  const [staff, setStaff] = useState(false);
  const [sendTo, setSendTo] = useState('');

  useEffect(() => {
    let active = true;
    void api
      .me()
      .then((m) => {
        if (active) setStaff(m.platformRole === 'admin' || m.platformRole === 'developer');
      })
      .catch(() => {
        /* not fatal: without this the field simply stays hidden */
      });
    return () => {
      active = false;
    };
  }, []);

  async function sendTest() {
    setSending(true);
    setResult(null);
    try {
      setResult(await api.sendProjectSmtpTest(project.id, staff && sendTo.trim() ? sendTo.trim() : undefined));
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'send failed' });
    } finally {
      setSending(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testProjectSmtp(project.id));
    } catch (e) {
      // A 404 here means "save first" — the route tests what is STORED, not what is on screen.
      setResult({ ok: false, error: e instanceof Error ? e.message : 'test failed' });
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { smtp } = await api.getProjectSmtp(project.id);
        if (!active) return;
        if (smtp) {
          setEnabled(true);
          setHost(smtp.host);
          setPort(smtp.port);
          setSecure(smtp.secure);
          setUser(smtp.user ?? '');
          setFromEmail(smtp.fromEmail);
          setFromName(smtp.fromName ?? '');
          setHasPassword(smtp.hasPassword);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load SMTP');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [project.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setResult(null); // what was tested is no longer what is stored
    try {
      if (!enabled) {
        await api.deleteProjectSmtp(project.id);
        setHasPassword(false);
        setSaved(true);
        return;
      }
      const body: SmtpInput = { host, port, secure, fromEmail, ...(user ? { user } : {}), ...(fromName ? { fromName } : {}), ...(password ? { password } : {}) };
      const { smtp } = await api.putProjectSmtp(project.id, body);
      setHasPassword(smtp.hasPassword);
      setPassword('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save SMTP');
    }
  }

  // The three actions share one result slot, so overlapping requests would display whichever
  // response happened to land last rather than the one the operator is waiting on.
  const busy = testing || sending;

  if (loading) return null;

  const field = `${glassInput} px-2 py-1`;

  return (
    <details
      className={`mb-4 ${glassCard} p-3`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-200">
        Project SMTP{' '}
        <span className="font-normal text-slate-400 dark:text-slate-500">
          — for “Project SMTP” and “contact.php (SMTP)” forms
        </span>
      </summary>
      {/* Any edit invalidates the last test: the endpoint checks what is STORED, so a ✓ left over
          from the previous settings would assert something nobody has verified. Clearing on the
          form's change event catches every field without threading a reset through each setter. */}
      <form onSubmit={save} onChange={() => setResult(null)} className="mt-3 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={toggleInput} aria-label="Configure project SMTP" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send this project’s form mail via its own SMTP
        </label>
        {enabled && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Host
              <input className={field} aria-label="SMTP host" value={host} onChange={(e) => setHost(e.target.value)} required />
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Port
              <input
                className={field}
                aria-label="SMTP port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) setPort(v);
                }}
                required
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Username
              <input className={field} aria-label="SMTP username" value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Password
              <input
                className={field}
                aria-label="SMTP password"
                type="password"
                value={password}
                placeholder={hasPassword ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              From email
              <input className={field} aria-label="SMTP from email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required />
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              From name
              <input className={field} aria-label="SMTP from name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className={toggleInput} aria-label="Use implicit TLS" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
              Use implicit TLS (port 465); otherwise STARTTLS
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButton} disabled={busy}>
            Save SMTP
          </button>
          {/* Form delivery is best-effort, so a broken SMTP is otherwise invisible until leads stop
              arriving. This tests what is SAVED — it authenticates but sends no mail. */}
          {enabled && (
            <>
              <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} onClick={() => void test()} disabled={busy}>
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} onClick={() => void sendTest()} disabled={busy}>
                {sending ? 'Sending…' : 'Send test message'}
              </button>
              {staff && (
                <input
                  className={`${glassInput} max-w-xs px-2 py-1 text-xs`}
                  aria-label="Test message recipient"
                  type="email"
                  value={sendTo}
                  placeholder="your address"
                  onChange={(e) => setSendTo(e.target.value)}
                />
              )}
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Both act on the SAVED settings, not what is on screen. “Test connection” sends no mail;
                “Send test message” sends real mail
                {staff ? ' — blank recipient means your own address.' : ' to your account address.'}
              </span>
            </>
          )}
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved.</span>}
          {result &&
            (result.ok ? (
              <span className="text-sm text-green-600 dark:text-green-400">
                ✓ {result.to ? `Sent to ${result.to}` : 'Connected'}
              </span>
            ) : (
              <span className="text-sm text-red-600 dark:text-red-400">✗ {result.error}</span>
            ))}
          {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </form>
    </details>
  );
}
