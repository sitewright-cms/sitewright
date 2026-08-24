/**
 * "Take me to this dataset" — a one-way signal from a modal stacked over the page editor to the Data
 * rail, which lives in a different branch of the tree (App renders the rail; the modal is opened deep
 * inside the page editor).
 *
 * A window event rather than a context, matching how the platform-background refresh already crosses
 * the same gap: the two ends share no ancestor that would naturally own this state, and threading a
 * callback down would put a dataset concern in every component between them. Nothing is stored — the
 * rail reacts to the request and owns what happens next.
 */
const DATASET_VIEW_EVENT = 'sitewright:view-dataset';

/** Ask the Data rail to open and select `slug`. No-op if the rail is not mounted. */
export function requestDatasetView(slug: string): void {
  window.dispatchEvent(new CustomEvent(DATASET_VIEW_EVENT, { detail: slug }));
}

/** Subscribe to those requests. Returns the unsubscribe. */
export function onDatasetViewRequest(handler: (slug: string) => void): () => void {
  const listener = (e: Event): void => {
    const slug = (e as CustomEvent<unknown>).detail;
    if (typeof slug === 'string' && slug !== '') handler(slug);
  };
  window.addEventListener(DATASET_VIEW_EVENT, listener);
  return () => window.removeEventListener(DATASET_VIEW_EVENT, listener);
}
