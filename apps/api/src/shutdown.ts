/**
 * Graceful shutdown, extracted so it can be unit-tested in isolation (the `exit` callback is injected, so
 * a test never actually terminates the runner).
 *
 * On a termination signal: close Fastify (which drains in-flight requests + terminates the render workers
 * via its `onClose` hooks), then close the DB connection, then `exit(0)`. A **force-exit failsafe** bounds
 * the whole thing — if `close()` hangs (a stuck connection or hook), we `exit(1)` after `timeoutMs` rather
 * than leaving the container to wait for the orchestrator's SIGKILL.
 */
export interface ShutdownDeps {
  /** Drain + close the HTTP server (Fastify `app.close`). */
  close: () => Promise<void>;
  /** Close the DB connection (libsql `client.close`) — may be called after a partial shutdown. */
  closeDb: () => void;
  /** Hard cap on the whole shutdown before forcing exit. */
  timeoutMs: number;
  log: (message: string) => void;
  /** Injected `process.exit` — overridable in tests. */
  exit: (code: number) => void;
}

export async function runShutdown(deps: ShutdownDeps): Promise<void> {
  const { close, closeDb, timeoutMs, log, exit } = deps;

  // A single-shot resolver: whichever path finishes first (clean close or the failsafe timeout) exits, and
  // the other is a no-op — so `exit` is never called twice and a late-but-successful close can't overwrite
  // an already-forced timeout.
  let settled = false;
  const done = (code: number, message?: string): void => {
    if (settled) return;
    settled = true;
    if (message) log(message);
    exit(code);
  };

  const failsafe = setTimeout(() => done(1, `shutdown timed out after ${timeoutMs}ms — forcing exit`), timeoutMs);
  // Never let the failsafe timer itself keep the process alive (no-op under fake timers → optional call).
  failsafe.unref?.();

  try {
    await close();
    try {
      closeDb();
    } catch (err) {
      // Non-fatal to the exit code, but surface it (never silently swallow).
      log(`DB close failed during shutdown — ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(failsafe);
    done(0);
  } catch (err) {
    clearTimeout(failsafe);
    done(1, `shutdown error — ${err instanceof Error ? err.message : String(err)}`);
  }
}
