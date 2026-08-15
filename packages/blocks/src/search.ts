// The `Search` component: the browser half of site search. The publish build emits
// `search-index[.<locale>].json` + `search-text[.<locale>].json` (apps/api/src/publish/search-index.ts);
// this reads them and renders a ranked list of PAGES. See docs/site-search.md §3.5, §3.6 and §5.
//
// ★ THE TOKENIZER IS DUPLICATED HERE, DELIBERATELY. Runtimes ship as JS strings (the house pattern —
// see BANNER_JS, CART_JS), so this cannot `import` the TypeScript tokenizer the build uses. The two
// MUST agree or a page simply never matches its own words, and nothing would report it. That agreement
// is held by `search-parity.behavior.test.ts`, which runs BOTH over the same corpus and fails on any
// divergence. If you change normalization in `search-tokenize.ts`, change it here too — the test will
// tell you if you forget.

import { escapeAttr, escapeHtml } from './escape.js';

/** Styles for the result list. Deliberately minimal: the author owns the input and the container. */
export const SEARCH_CSS = [
  // :where() → zero specificity, so an author's own layout rules beat this default outright.
  ':where([data-sw-component="search"] [data-sw-part="results"]){display:flex;flex-direction:column;gap:.25rem}',
  '.sw-search-hit{display:block;padding:.5rem .625rem;border-radius:.375rem;text-decoration:none;color:inherit}',
  '.sw-search-hit:hover,.sw-search-hit:focus-visible{background:rgb(0 0 0/.05)}',
  '.sw-search-hit-title{display:block;font-weight:600}',
  '.sw-search-hit-desc{display:block;font-size:.875em;opacity:.75}',
  '.sw-search-hit-snippet{display:block;font-size:.875em;opacity:.85;margin-top:.125rem}',
  '.sw-search-hit-snippet mark{background:rgb(255 214 0/.35);color:inherit;padding:0 .1em;border-radius:.15em}',
  // The visually-hidden live region that announces the result count.
  '[data-sw-component="search"] [data-sw-part="status"]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
  '@media (prefers-color-scheme: dark){.sw-search-hit:hover,.sw-search-hit:focus-visible{background:rgb(255 255 255/.08)}}',
].join('');

export const SEARCH_JS = `(function(){
  'use strict';
  var hosts = document.querySelectorAll('[data-sw-component="search"]');
  if (!hosts.length) return;

  // Resolve everything against THIS SCRIPT's URL. A published site is portable — it may live at a
  // domain root, in a sub-folder, or under /sites/<slug>/ — so a root-relative '/search-index.json'
  // would 404 in two of those three. The index sits beside this script at the site root.
  var here = document.currentScript && document.currentScript.src;
  if (!here) {
    // The publish build names chunks c-<type-lowercased>.js (build.ts componentChunkName), so this
    // is c-search.js — NOT c-Search.js. The wrong casing here matched nothing and was invisible in
    // a real browser, where document.currentScript already answers.
    var guess = document.querySelector('script[src*="c-search.js"]');
    here = guess ? guess.src : location.href;
  }

  // ---- tokenizer (mirror of packages/blocks/src/search-tokenize.ts) ---------------------------
  var LATIN_MARKS = /(\\p{sc=Latin})\\p{M}+/gu;
  var FALLBACK_WORD = /[\\p{L}\\p{N}\\p{M}]+/gu;
  var segmenter = null;
  function segFor(locale){
    if (segmenter) return segmenter;
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
    try { segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'word' }); } catch (e) { segmenter = null; }
    return segmenter;
  }
  function normalizeTerm(term, locale, fold){
    var lower = locale ? term.normalize('NFKC').toLocaleLowerCase(locale) : term.normalize('NFKC').toLowerCase();
    if (fold === false) return lower;
    // Latin bases only: in Thai/Devanagari/Hebrew a combining mark is a letter, not an accent.
    return lower.normalize('NFD').replace(LATIN_MARKS, '$1').normalize('NFC');
  }
  function tokenize(text, locale, fold){
    if (!text) return [];
    var out = [];
    var seg = segFor(locale);
    if (seg) {
      var it = seg.segment(text);
      for (var s of it) {
        if (!s.isWordLike) continue;
        var t = normalizeTerm(s.segment, locale, fold);
        if (t) out.push({ term: t, start: s.index, len: s.segment.length });
      }
      return out;
    }
    FALLBACK_WORD.lastIndex = 0;
    var m;
    while ((m = FALLBACK_WORD.exec(text)) !== null) {
      var ft = normalizeTerm(m[0], locale, fold);
      if (ft) out.push({ term: ft, start: m.index, len: m[0].length });
    }
    return out;
  }

  /** A 200 carrying valid JSON of the WRONG shape must leave the box inert, not throw on every key. */
  function usable(d){ return !!d && Array.isArray(d.pages) && !!d.terms && typeof d.terms === 'object'; }
  function decodeDeltas(d){ var out=[],acc=0; if (!d) return out; for (var i=0;i<d.length;i++){ acc+=d[i]; out.push(acc);} return out; }
  // ★ Plain object: a bare terms[q] would return an inherited function for 'constructor'/'toString'.
  function postingsFor(index, term){ return Object.prototype.hasOwnProperty.call(index.terms, term) ? index.terms[term] : null; }

  // ---- ranking (docs/site-search.md §5) --------------------------------------------------------
  var FIELD_WEIGHTS = { t: 8, h1: 5, d: 3, h2: 3, h3: 3, h4: 2, h5: 2, h6: 2 };
  var K1 = 1.2, B = 0.75, PREFIX_FACTOR = 0.6;
  // A pasted paragraph would otherwise run one whole-vocabulary scan per unmatched word, on the
  // main thread, on every debounce tick. Bound the query and the scan instead.
  var MAX_QUERY_CHARS = 200, MAX_QUERY_TERMS = 12, MAX_PREFIX_MATCHES = 64;

  function parseQuery(raw, locale, fold){
    var phrases = [], loose = [];
    var rest = raw.replace(/"([^"]+)"/g, function(_, inner){
      var toks = tokenize(inner, locale, fold).map(function(t){ return t.term; });
      if (toks.length) phrases.push(toks);
      return ' ';
    });
    loose = tokenize(rest, locale, fold).map(function(t){ return t.term; });
    return { phrases: phrases, loose: loose, endsOpen: /[^\\s"]$/.test(raw) };
  }

  function search(index, raw){
    var locale = index.lang, fold = index.fold !== false;
    var q = parseQuery(String(raw).slice(0, MAX_QUERY_CHARS), locale, fold);
    var joined = q.loose.slice();
    for (var p = 0; p < q.phrases.length; p++) joined = joined.concat(q.phrases[p]);
    // DEDUPED: the coverage tier counts DISTINCT query terms. Without this, \`foo "foo bar"\` counted
    // foo twice and inflated that page's tier against pages covering two genuinely different words.
    var allTerms = [], seenTerm = Object.create(null);
    for (var d = 0; d < joined.length && allTerms.length < MAX_QUERY_TERMS; d++) {
      if (seenTerm[joined[d]]) continue;
      seenTerm[joined[d]] = 1;
      allTerms.push(joined[d]);
    }
    if (!allTerms.length) return [];
    // Only the word still being TYPED completes by prefix. Doing it for every term without an exact
    // hit let a phrase word borrow a longer word's positions, so \`"cat nap"\` could report an exact
    // phrase match against "category nap".
    var openTerm = q.endsOpen && q.loose.length ? q.loose[q.loose.length - 1] : null;

    var pages = index.pages, N = pages.length;
    var avgdl = 0;
    for (var i = 0; i < N; i++) avgdl += pages[i].n;
    avgdl = avgdl / Math.max(1, N) || 1;

    // term -> { pageIndex -> ordinals }, plus df for idf.
    // ★ NULL-PROTOTYPE, for the same reason index.terms is read with hasOwnProperty: a plain {} makes
    // perTerm['constructor'] return Object.prototype.constructor — truthy, so the guard below skipped
    // initialization and info.hits[pageIndex] then threw on undefined. It surfaced only as an unhandled
    // rejection in a promise chain, so the query merely returned nothing and the test still passed.
    var perTerm = Object.create(null);
    for (var ti = 0; ti < allTerms.length; ti++) {
      var term = allTerms[ti];
      if (perTerm[term]) continue;
      var hits = Object.create(null), df = 0, exact = postingsFor(index, term);
      if (exact) {
        for (var e = 0; e < exact.length; e++) { hits[exact[e][0]] = decodeDeltas(exact[e][1]); df++; }
      }
      // Search-as-you-type: the still-open trailing term also matches by prefix, at a discount so
      // typing 'car' cannot let 'carpet' outrank a real hit on 'car'. Bounded, and never for a
      // phrase word.
      if (term === openTerm && term.length >= 2) {
        var taken = 0;
        for (var k in index.terms) {
          if (taken >= MAX_PREFIX_MATCHES) break;
          if (!Object.prototype.hasOwnProperty.call(index.terms, k)) continue;
          if (k === term || k.lastIndexOf(term, 0) !== 0) continue;
          taken++;
          var plist = index.terms[k];
          for (var pi = 0; pi < plist.length; pi++) {
            if (hits[plist[pi][0]]) continue;
            hits[plist[pi][0]] = decodeDeltas(plist[pi][1]);
            hits[plist[pi][0]].prefix = true;
            df++;
          }
        }
      }
      perTerm[term] = { hits: hits, df: df, exact: !!exact };
    }

    var scored = [];
    for (var pageIndex = 0; pageIndex < N; pageIndex++) {
      var page = pages[pageIndex];
      var covered = 0, score = 0, positions = [];
      for (var t2 = 0; t2 < allTerms.length; t2++) {
        var info = perTerm[allTerms[t2]];
        var ords = info.hits[pageIndex];
        var fieldHits = 0;
        for (var fk in FIELD_WEIGHTS) {
          if (!page.f || !page.f[fk]) continue;
          var list = page.f[fk];
          for (var li = 0; li < list.length; li++) if (list[li] === allTerms[t2]) fieldHits += FIELD_WEIGHTS[fk];
        }
        if (!ords && !fieldHits) continue;
        covered++;
        var df2 = Math.max(1, info.df);
        var idf = Math.log(1 + (N - df2 + 0.5) / (df2 + 0.5));
        var tf = ords ? ords.length : 0;
        var norm = tf > 0 ? (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * page.n) / avgdl)) : 0;
        var termScore = idf * (norm + fieldHits);
        if (ords && ords.prefix) termScore *= PREFIX_FACTOR;
        score += termScore;
        if (ords) positions.push(ords);
      }
      if (!covered) continue;

      // A quoted phrase is a FILTER, not a boost: pages without it are excluded outright.
      var phraseStart = -1;
      var phraseOk = true;
      for (var ph = 0; ph < q.phrases.length; ph++) {
        var found = phraseAt(perTerm, q.phrases[ph], pageIndex);
        if (found < 0) { phraseOk = false; break; }
        if (phraseStart < 0) phraseStart = found;
      }
      if (!phraseOk) continue;

      score *= proximity(positions);
      // Structural priors, bounded so they break ties without overturning relevance.
      score *= Math.pow(0.97, page.dep || 0);
      if (page.nv) score *= 1.1;
      if (page.u === '/') score *= 1.05;

      scored.push({ page: page, index: pageIndex, covered: covered, score: score, phraseStart: phraseStart, positions: positions });
    }

    // Sort TUPLE, not one opaque number: coverage tier, then score, then URL for determinism.
    scored.sort(function(a, b){
      if (b.covered !== a.covered) return b.covered - a.covered;
      if (b.score !== a.score) return b.score - a.score;
      return a.page.u < b.page.u ? -1 : a.page.u > b.page.u ? 1 : 0;
    });

    // Duplicate collapse: identical bodies at two URLs are ONE result (the canonical member).
    var seenGroup = Object.create(null), out = [];
    for (var s2 = 0; s2 < scored.length; s2++) {
      var g = scored[s2].page.g;
      if (g !== undefined && seenGroup[g]) continue;
      if (g !== undefined) seenGroup[g] = true;
      out.push(scored[s2]);
    }
    return out;
  }

  /** Ordinal where \`phrase\` starts on this page (terms at consecutive ordinals), or -1. */
  function phraseAt(perTerm, phrase, pageIndex){
    var first = perTerm[phrase[0]] && perTerm[phrase[0]].hits[pageIndex];
    if (!first) return -1;
    for (var i = 0; i < first.length; i++) {
      var ok = true;
      for (var w = 1; w < phrase.length; w++) {
        var next = perTerm[phrase[w]] && perTerm[phrase[w]].hits[pageIndex];
        if (!next || next.indexOf(first[i] + w) === -1) { ok = false; break; }
      }
      if (ok) return first[i];
    }
    return -1;
  }

  /** 1.0 when the matched terms sit together, easing to 0.9 when they are far apart. */
  function proximity(positions){
    if (positions.length < 2) return 1;
    var firsts = [];
    for (var i = 0; i < positions.length; i++) firsts.push(positions[i][0]);
    firsts.sort(function(a,b){ return a-b; });
    var span = firsts[firsts.length-1] - firsts[0];
    return 1 - Math.min(0.1, span / 2000);
  }

  // ---- rendering ------------------------------------------------------------------------------
  function snippet(text, offsets, hit, queryTerms, locale, fold){
    var ordinal = hit.phraseStart >= 0 ? hit.phraseStart : (hit.positions[0] ? hit.positions[0][0] : 0);
    var at = offsets[ordinal] || 0;
    var start = Math.max(0, at - 60), end = Math.min(text.length, at + 100);
    if (start > 0) { var sp = text.indexOf(' ', start); if (sp > -1 && sp < at) start = sp + 1; }
    if (end < text.length) { var ep = text.lastIndexOf(' ', end); if (ep > at) end = ep; }
    var window = text.slice(start, end);
    var frag = document.createDocumentFragment();
    if (start > 0) frag.appendChild(document.createTextNode('…'));
    var cursor = 0;
    var toks = tokenize(window, locale, fold);
    for (var i = 0; i < toks.length; i++) {
      var isHit = false;
      for (var q = 0; q < queryTerms.length; q++) {
        if (toks[i].term === queryTerms[q] || toks[i].term.lastIndexOf(queryTerms[q], 0) === 0) { isHit = true; break; }
      }
      if (!isHit) continue;
      // @security textContent + a created <mark>. Author text is NEVER assigned as innerHTML.
      frag.appendChild(document.createTextNode(window.slice(cursor, toks[i].start)));
      var mark = document.createElement('mark');
      mark.textContent = window.slice(toks[i].start, toks[i].start + toks[i].len);
      frag.appendChild(mark);
      cursor = toks[i].start + toks[i].len;
    }
    frag.appendChild(document.createTextNode(window.slice(cursor)));
    if (end < text.length) frag.appendChild(document.createTextNode('…'));
    return frag;
  }

  function enhance(host){
    var input = host.querySelector('[data-sw-part="input"]');
    var results = host.querySelector('[data-sw-part="results"]');
    if (!input || !results) return;
    var empty = host.querySelector('[data-sw-part="empty"]');
    var status = host.querySelector('[data-sw-part="status"]');
    if (!status) {
      status = document.createElement('p');
      status.setAttribute('data-sw-part', 'status');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      host.appendChild(status);
    }
    var limit = parseInt(host.getAttribute('data-sw-limit') || '10', 10) || 10;
    var index = null, textFile = null, loading = null, timer = null;
    // Which file pair we actually loaded: '' for the default locale, '.de' for a translated page.
    // The TEXT file must match the INDEX file, or offsets point into another language's strings.
    var suffix = '';

    function load(){
      if (loading) return loading;
      loading = fetch(new URL('search-index.json', here).href)
        .then(function(r){ if (!r.ok) throw new Error('no index'); return r.json(); })
        .then(function(data){
          var pageLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
          // One request on the default locale; a second only for a translated page.
          if (pageLang && data.lang && data.lang.toLowerCase() !== pageLang) {
            return fetch(new URL('search-index.' + pageLang + '.json', here).href)
              .then(function(r2){
                if (!r2.ok) return data;
                // suffix is set only AFTER the body parses: a truncated file mid-deploy would
                // otherwise leave the TEXT fetch pointing at a locale the index isn't for.
                return r2.json().then(function(parsed){ suffix = '.' + pageLang; return parsed; });
              })
              .catch(function(){ return data; });
          }
          return data;
        })
        .then(function(data){ index = usable(data) ? data : null; return index; })
        .catch(function(){ index = null; });
      return loading;
    }

    function loadText(){
      if (textFile) return Promise.resolve(textFile);
      return fetch(new URL('search-text' + suffix + '.json', here).href)
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){ textFile = d; return d; })
        .catch(function(){ return null; });
    }

    function render(query){
      if (!index) return;
      var hits = search(index, query).slice(0, limit);
      results.textContent = '';
      if (empty) empty.hidden = hits.length > 0 || !query;
      status.textContent = query ? String(hits.length) + ' results' : '';
      if (!hits.length) return;
      var terms = [];
      var parsed = parseQuery(query, index.lang, index.fold !== false);
      terms = parsed.loose.slice();
      for (var pp = 0; pp < parsed.phrases.length; pp++) terms = terms.concat(parsed.phrases[pp]);

      // ★ .catch is not optional here. Without it any failure in this callback becomes an unhandled
      // rejection and the result list silently never renders — and a mismatched text file is a REAL
      // case: an incremental deploy can serve a stale search-text.json with fewer pages than the
      // index. Snippets are an enhancement, so a failure degrades to results WITHOUT them.
      loadText().then(function(text){
        results.textContent = '';
        for (var i = 0; i < hits.length; i++) {
          var hit = hits[i];
          var a = document.createElement('a');
          a.className = 'sw-search-hit';
          // Resolved against the index URL, so sub-folder and /sites/<slug>/ hosting both work.
          // '' would resolve to the SCRIPT's own URL (WHATWG: an empty reference returns the
          // base unchanged), so every home-page result linked to c-search.js. '.' means "this directory".
          a.href = new URL(hit.page.u.replace(/^\\//, '') || '.', here).href;
          var title = document.createElement('span');
          title.className = 'sw-search-hit-title';
          title.textContent = hit.page.t || hit.page.u;
          a.appendChild(title);
          if (hit.page.d) {
            var desc = document.createElement('span');
            desc.className = 'sw-search-hit-desc';
            desc.textContent = hit.page.d;
            a.appendChild(desc);
          }
          var offs = text && text.offsets ? text.offsets[hit.index] : null;
          if (text && text.text && text.text[hit.index] != null && offs) {
            var sn = document.createElement('span');
            sn.className = 'sw-search-hit-snippet';
            sn.appendChild(snippet(text.text[hit.index], decodeDeltas(offs), hit, terms, index.lang, index.fold !== false));
            a.appendChild(sn);
          }
          results.appendChild(a);
        }
      }).catch(function(){
        // Snippets are an enhancement; a bad/stale text file must not cost the visitor the results.
      });
    }

    function onInput(){
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 2) { results.textContent = ''; if (empty) empty.hidden = true; status.textContent = ''; return; }
      timer = setTimeout(function(){
        load().then(function(){ render(q); }).catch(function(){ /* stay inert, never wedge */ });
      }, 120);
    }

    input.addEventListener('input', onInput);
    input.addEventListener('focus', load, { once: true });

    // Keyboard: Down/Up walk the results, Escape clears. Without this the list is reachable only by
    // Tab, which walks past every hit to leave the component.
    function move(step){
      var links = results.querySelectorAll('a.sw-search-hit');
      if (!links.length) return;
      var at = -1;
      for (var i = 0; i < links.length; i++) if (links[i] === document.activeElement) { at = i; break; }
      var next = at + step;
      if (next < 0) { input.focus(); return; }
      if (next >= links.length) next = links.length - 1;
      links[next].focus();
    }
    host.addEventListener('keydown', function(ev){
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if (ev.key === 'Escape') {
        input.value = '';
        results.textContent = '';
        if (empty) empty.hidden = true;
        status.textContent = '';
        input.focus();
      } else if (ev.key === 'Enter' && ev.target === input) {
        // Must not submit a wrapping form and reload the page.
        ev.preventDefault();
        onInput();
      }
    });
    host.setAttribute('data-sw-enhanced', 'true');
  }

  for (var i = 0; i < hosts.length; i++) enhance(hosts[i]);
})();`;

/** Options for {@link renderSearchBox} — the hash params of `{{sw-search}}`. */
export interface SearchBoxOptions {
  placeholder?: string;
  /** Accessible name for the input (it has no visible `<label>`). */
  label?: string;
  /** Text shown when a query matches nothing. */
  empty?: string;
  /** Maximum results rendered (default 10). */
  limit?: number;
  /** Extra classes on the wrapper, so the box adopts the site's design. */
  class?: string;
}

/**
 * The standard search-box markup: `{{sw-search}}`.
 *
 * The runtime's contract is `[data-sw-part="input"]` + `[data-sw-part="results"]`, and an author may
 * hand-write that instead to own the layout entirely. This helper exists so the common case does not
 * require knowing the contract at all.
 *
 * ★ It emits `data-sw-component` at RENDER time, which is why `sw-search` MUST have a row in
 * `REFERENCE_EMBEDS` (components.ts) — the publish path scans page SOURCES, so without that row the
 * box renders and no runtime ships. `components.test.ts` asserts this for every helper.
 */
export function renderSearchBox(options: SearchBoxOptions = {}): string {
  const placeholder = options.placeholder ?? 'Search…';
  const label = options.label ?? placeholder;
  const empty = options.empty ?? 'No results found.';
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, Number(options.limit))) : 10;
  const cls = options.class ? ` ${options.class}` : '';
  return (
    `<div data-sw-component="search" data-sw-limit="${limit}" class="sw-search${escapeAttr(cls)}">` +
    `<input data-sw-part="input" type="search" autocomplete="off" placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(label)}" />` +
    '<div data-sw-part="results"></div>' +
    `<p data-sw-part="empty" hidden>${escapeHtml(empty)}</p>` +
    '</div>'
  );
}
