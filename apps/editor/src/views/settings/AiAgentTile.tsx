import { useCallback, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AiConfigView } from '@sitewright/schema';
import { api } from '../../api';
import { AiConfig } from '../AiConfig';
import { Modal } from '../ui/Modal';
import { PartRow, Row, RowBlock, SwitchRow, Tile } from './board/Tile';
import type { TileStatus } from './board/summaries';

/**
 * The project's AI AGENT, on the Website Settings board (where it lived before the Project Settings modal,
 * which only owners can open — so a client lost their way to it).
 *
 *   - "Own agent": the project's bring-your-own provider and key. Every writer may set it: it is billed to
 *     the project, and it answers the project's members first.
 *   - "Use Built-In Agent": the platform's own assistant on this project, even where the instance would not
 *     otherwise offer it. Agency staff switch it (the server says whether this viewer may), and it answers
 *     staff first.
 */

const HELP =
  "The on-page AI assistant. A project's own agent (its own provider and API key, billed to the project) answers its members first. Agency staff can also switch on the platform's built-in agent for this project, which answers staff first — and members whenever the project has no agent of its own.";

const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI-compatible', openrouter: 'OpenRouter' };

export function aiAgentStatus(config: AiConfigView | null): TileStatus {
  const own = Boolean(config?.enabled && config.hasKey);
  if (own && config?.useBuiltIn) return { kind: 'set', label: 'Own + built-in' };
  if (own) return { kind: 'set', label: 'Own agent' };
  if (config?.useBuiltIn) return { kind: 'set', label: 'Built-in' };
  return { kind: 'default', label: 'Platform default' };
}

export function AiAgentTile({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const [canSetBuiltIn, setCanSetBuiltIn] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Nothing is shown until the first read answers: a switch drawn before it would read "locked" to staff.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getAiConfig(projectId);
      setConfig(res.aiConfig);
      setCanSetBuiltIn(res.canSetBuiltIn === true);
      setUnavailable(null);
    } catch (err) {
      // No encryption key on the instance (the routes are not there), or no write access: say so in the tile.
      setUnavailable(err instanceof Error ? err.message : 'AI settings are not available');
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setBuiltIn(on: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setAiBuiltIn(projectId, on);
      setConfig(res.aiConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the built-in agent');
    } finally {
      setBusy(false);
    }
  }

  const own = config?.enabled && config.hasKey ? (PROVIDER_LABEL[config.provider] ?? config.provider) : 'not set';
  return (
    <>
      <Tile title="AI Agent" icon={<Bot className="h-4 w-4" />} status={aiAgentStatus(config)} span="c3" md={3} help={HELP}>
        <RowBlock n={4}>
          {!loaded ? null : unavailable ? (
            <Row label="Unavailable" value={unavailable} />
          ) : (
            <>
              <Row label="Own agent" value={own} />
              <SwitchRow
                label="Use Built-In Agent"
                ariaLabel="Use the platform's built-in agent on this project"
                checked={config?.useBuiltIn === true}
                onChange={(on) => void setBuiltIn(on)}
                disabledReason={!canSetBuiltIn ? "Your agency (an admin or a developer) decides whether this project uses the platform's agent." : busy ? 'Saving…' : undefined}
              />
              {error && <Row label="Not saved" value={error} />}
              <PartRow label="Own agent settings" ariaLabel="Edit this project's own AI agent" onClick={() => setOpen(true)} />
            </>
          )}
        </RowBlock>
      </Tile>
      {open && (
        <Modal
          title="AI Agent"
          size="lg"
          onClose={() => {
            setOpen(false);
            void load();
          }}
        >
          <div className="p-5">
            <AiConfig projectId={projectId} flat />
          </div>
        </Modal>
      )}
    </>
  );
}
