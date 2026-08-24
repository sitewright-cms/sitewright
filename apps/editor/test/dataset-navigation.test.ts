import { describe, it, expect, vi, afterEach } from 'vitest';
import { onDatasetViewRequest, requestDatasetView } from '../src/lib/dataset-navigation';

/**
 * The signal that carries "View dataset" across the tree — the entry modal is stacked deep inside the
 * page editor, the Data rail is a sibling of it under App.
 */
describe('dataset view requests', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it('delivers the slug to a subscriber', () => {
    const seen = vi.fn();
    cleanups.push(onDatasetViewRequest(seen));
    requestDatasetView('team');
    expect(seen).toHaveBeenCalledWith('team');
  });

  it('stops delivering once unsubscribed', () => {
    const seen = vi.fn();
    onDatasetViewRequest(seen)();
    requestDatasetView('team');
    expect(seen).not.toHaveBeenCalled();
  });

  it('ignores a malformed or empty request rather than selecting nothing', () => {
    const seen = vi.fn();
    cleanups.push(onDatasetViewRequest(seen));
    requestDatasetView('');
    window.dispatchEvent(new CustomEvent('sitewright:view-dataset', { detail: 42 }));
    expect(seen).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is listening (the rail may not be mounted)', () => {
    expect(() => requestDatasetView('team')).not.toThrow();
  });
});
