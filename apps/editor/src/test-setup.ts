import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Testing-library's async helpers (`findBy*`, `waitFor`) poll for 1000ms by default — a limit
// INDEPENDENT of vitest's `testTimeout`, which vite.config.ts already raised to 20s for this exact
// reason. Panels here mount behind a Framer Motion transition, so under the full parallel
// `turbo run test` load (many workers oversubscribing CPU) a `findByLabelText` for a control in a
// just-switched tab can be starved past one second and fail as "unable to find a label" — an
// intermittent failure that says nothing true about the component. Raising the async ceiling costs
// the fast path nothing (a resolved query still returns on its first poll); it only stops a loaded
// machine from being reported as a broken one.
// ★ 15s, not 5s. 5s was ALREADY this reasoning once, and it was still not enough: `SettingsView >
// discards unsaved edits` timed out finding a drill-in dialog during a full `pnpm verify`, where eleven
// package suites each spawn their own worker pool. The same file passes 8/8 run alone and 3/3 under
// synthetic CPU load, so the dialog is not failing to render — the query is being starved of the poll
// it needs. A resolved query still returns on its first poll, so the fast path is unchanged; this only
// stops an oversubscribed machine being reported as a broken component.
configure({ asyncUtilTimeout: 15000 });

// jsdom has no EventSource. Components that subscribe to the project's SSE change-stream
// (PublishBar, LivePreview) only need a no-op constructor in unit tests — real streaming is
// exercised by the Playwright E2E suite.
if (typeof (globalThis as { EventSource?: unknown }).EventSource === 'undefined') {
  class MockEventSource {
    onopen: ((ev: Event) => unknown) | null = null;
    onerror: ((ev: Event) => unknown) | null = null;
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  (globalThis as { EventSource?: unknown }).EventSource = MockEventSource;
}

// jsdom has no layout, so `window.scrollTo` only logs "Not implemented". The app resets the page to the top
// on every tab switch; a no-op keeps that from spamming every test that changes tab. A test that cares
// spies on it (App.test.tsx does).
if (typeof window !== 'undefined') window.scrollTo = () => undefined;
