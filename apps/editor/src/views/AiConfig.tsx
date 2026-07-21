import { useEffect, useState, type FormEvent } from 'react';
import type { AiProviderKind } from '@sitewright/schema';
import { api, type AiConfigInput, type AiTestResult } from '../api';
import { glassCard, glassInput, primaryButton, ghostButton, toggleInput } from '../theme';

/** A representative model id for each provider (OpenRouter uses `vendor/model`). */
export function modelPlaceholder(p: AiProviderKind): string {
  return p === 'anthropic' ? 'claude-haiku-4-5' : p === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'gpt-4o-mini';
}

/**
 * Per-project "bring your own agent" AI config — when enabled + keyed it OVERRIDES the platform-wide
 * assistant for this project (its usage is billed to the project's own key, not the platform budget).
 * The API key is write-only (the server returns only a `hasKey` flag; leave it blank to keep the stored
 * one). Owner/member only; a non-writer gets a 403 which we surface as a notice.
 */
export function AiConfig({ projectId, flat = false }: { projectId: string; flat?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AiProviderKind>('anthropic');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [limit, setLimit] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(
        await api.testAiConfig(projectId, {
          provider,
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(provider === 'openai' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          ...(apiKey ? { apiKey } : {}),
        }),
      );
    } catch (e) {
      setTestResult({ ok: false, model: model.trim(), error: e instanceof Error ? e.message : 'test failed' });
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { aiConfig } = await api.getAiConfig(projectId);
        if (!active) return;
        if (aiConfig) {
          setEnabled(aiConfig.enabled);
          setProvider(aiConfig.provider);
          setModel(aiConfig.model ?? '');
          setBaseUrl(aiConfig.baseUrl ?? '');
          setHasKey(aiConfig.hasKey);
          setLimit(aiConfig.monthlyTokenLimit != null ? String(aiConfig.monthlyTokenLimit) : '');
          setMaxTokens(aiConfig.maxOutputTokens != null ? String(aiConfig.maxOutputTokens) : '');
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load AI config');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const limitNum = limit.trim() === '' ? undefined : Number(limit);
      if (limitNum !== undefined && (!Number.isInteger(limitNum) || limitNum < 0)) {
        setError('Monthly token limit must be a non-negative whole number.');
        return;
      }
      const maxTokensNum = maxTokens.trim() === '' ? undefined : Number(maxTokens);
      if (maxTokensNum !== undefined && (!Number.isInteger(maxTokensNum) || maxTokensNum < 1024 || maxTokensNum > 32000)) {
        setError('Max output tokens must be a whole number between 1024 and 32000.');
        return;
      }
      const body: AiConfigInput = {
        enabled,
        provider,
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(provider === 'openai' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(limitNum !== undefined ? { monthlyTokenLimit: limitNum } : {}),
        ...(maxTokensNum !== undefined ? { maxOutputTokens: maxTokensNum } : {}),
      };
      const { aiConfig } = await api.putAiConfig(projectId, body);
      setHasKey(aiConfig.hasKey);
      setApiKey('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save AI config');
    }
  }

  if (loading) return null;
  const field = `${glassInput} px-2 py-1`;

  const body = (
    <form onSubmit={save} className={`flex flex-col gap-3 ${flat ? '' : 'mt-3'}`}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={toggleInput} aria-label="Use this project's own AI provider" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Use this project’s own AI provider (bring your own key)
        </label>
        {enabled && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-xs text-slate-500">
              Provider
              <select className={field} aria-label="AI provider" value={provider} onChange={(e) => setProvider(e.target.value as AiProviderKind)}>
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI-compatible (custom endpoint)</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Model
              <input className={field} aria-label="AI model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={modelPlaceholder(provider)} />
            </label>
            {provider === 'openrouter' && (
              <p className="col-span-2 -mt-1 text-[11px] text-slate-400">
                Uses openrouter.ai — pick a model that supports tool/function calling (and vision if you want the agent to see screenshots).
              </p>
            )}
            {provider === 'openai' && (
              <label className="col-span-2 flex flex-col text-xs text-slate-500">
                Base URL <span className="text-slate-400">(public host only)</span>
                <input className={field} aria-label="AI base URL" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </label>
            )}
            <label className="flex flex-col text-xs text-slate-500">
              API key
              <input className={field} aria-label="AI API key" type="password" value={apiKey} placeholder={hasKey ? '•••••• (leave blank to keep)' : ''} onChange={(e) => setApiKey(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Monthly token cap <span className="text-slate-400">(0 = unlimited)</span>
              <input className={field} aria-label="Monthly token cap" type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Max output tokens / reply <span className="text-slate-400">(blank = default 8192)</span>
              <input
                className={field}
                aria-label="Max output tokens per reply"
                type="number"
                min={1024}
                max={32000}
                value={maxTokens}
                placeholder="8192"
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButton}>
            Save AI config
          </button>
          {enabled && (
            <button type="button" className={ghostButton} onClick={() => void testConnection()} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          )}
          {saved && <span className="text-sm text-green-600">Saved.</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          {testResult &&
            (testResult.ok ? (
              <span className="text-sm text-green-600">✓ Connected{testResult.model ? ` (${testResult.model})` : ''}</span>
            ) : (
              <span className="text-sm text-red-600" title={testResult.error}>✗ {testResult.error}</span>
            ))}
        </div>
      </form>
  );

  // `flat` embeds the form directly (e.g. inside the Project Settings "AI Assistant" tab); otherwise it
  // stays a self-contained collapsible card (its original Website-Settings placement, now unused).
  if (flat) return body;

  return (
    <details className={`mb-4 ${glassCard} p-3`} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-bold text-slate-700">
        AI Assistant <span className="font-normal text-slate-400">— this project’s own provider (optional)</span>
      </summary>
      {body}
    </details>
  );
}
