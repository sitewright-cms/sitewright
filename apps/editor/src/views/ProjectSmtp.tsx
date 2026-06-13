import { useEffect, useState, type FormEvent } from 'react';
import { api, type Project, type SmtpInput } from '../api';
import { glassCard, glassInput, primaryButton, toggleInput } from '../theme';

/**
 * Per-project SMTP config — used by forms whose delivery mode is "Project SMTP"
 * (userSmtp). The password is write-only (the API returns only a presence flag;
 * leave it blank to keep the stored one). Owner/admin only; a non-writer gets a 403
 * which we surface as a notice.
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

  if (loading) return null;

  const field = `${glassInput} px-2 py-1`;

  return (
    <details
      className={`mb-4 ${glassCard} p-3`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-bold text-slate-700">
        Project SMTP <span className="font-normal text-slate-400">— for “Project SMTP” forms</span>
      </summary>
      <form onSubmit={save} className="mt-3 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={toggleInput} aria-label="Configure project SMTP" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send this project’s form mail via its own SMTP
        </label>
        {enabled && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-slate-500">
              Host
              <input className={field} aria-label="SMTP host" value={host} onChange={(e) => setHost(e.target.value)} required />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
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
            <label className="flex flex-col text-xs text-slate-500">
              Username
              <input className={field} aria-label="SMTP username" value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
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
            <label className="flex flex-col text-xs text-slate-500">
              From email
              <input className={field} aria-label="SMTP from email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              From name
              <input className={field} aria-label="SMTP from name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className={toggleInput} aria-label="Use implicit TLS" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
              Use implicit TLS (port 465); otherwise STARTTLS
            </label>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" className={primaryButton}>
            Save SMTP
          </button>
          {saved && <span className="text-sm text-green-600">Saved.</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>
    </details>
  );
}
