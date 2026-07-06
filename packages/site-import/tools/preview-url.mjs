// Join a project's signed preview BASE (from GET /projects/:id/preview-url — always ends in '/') with a
// page ROUTE into the absolute URL the fidelity gate renders the clone at (no deploy needed).
//
// The join must NEVER produce a double slash. Preview/published pages link their stylesheet RELATIVELY
// (`<link href="styles.css">`), so a page URL like `…/<sig>//about` makes the browser resolve the sheet to
// `…/<sig>//styles.css`, which 404s (single-slash is 200). The page then renders with NO CSS at all — the
// skewed nav collapses, icons balloon — and the gate silently measures a stylesheet-less page as if it were
// a real style regression. That was the "clone not faithful, same story every time" trap: the harness, not
// the clone, was broken.
//
// Contract: `base` already ends in '/'. Strip any leading/trailing slashes from `route`, append exactly one
// trailing slash (home route '' → just BASE+base), then collapse any residual `//` left in the PATH while
// leaving the scheme separator `://` intact.
export function cloneUrlFor(origin, base, route) {
  const r = String(route ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${origin}${base}${r}${r ? '/' : ''}`.replace(/([^:])\/{2,}/g, '$1/');
}
