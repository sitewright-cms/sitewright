# The Sitewright website: work-in-progress sources

Backup of the pages, snippets, styles and datasets of the new Sitewright website while it is being built on the test
instance (project `sitewright`). This branch is a backup, not for merging. When the site ships, the project is exported
as a seed bundle into `apps/api/example_projects/` and these sources are not needed in the repo.

- `pages/<id>.hbs`: a page; line 1 is a `{{!-- META {...} --}}` header with its path, parent, title and data.
- `snippets/`, `chrome/` (header, footer, critical CSS), `settings.json`, `datasets/` (media slots and demo data).
- `sc-src/` + `sc-tools/build.mjs`: the showcase pages are generated from these so each code sample equals its demo.
- `push.mjs`, `shoot.mjs`, `linkcheck.mjs`: push to the instance, screenshot pages, check every internal link.
  They read a session cookie from `../sw2003.cookie`, which is never committed.
- `AGENT-BRIEF.md`: the design and accuracy rules the pages were written to.
