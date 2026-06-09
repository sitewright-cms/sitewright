import '@testing-library/jest-dom/vitest';

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
