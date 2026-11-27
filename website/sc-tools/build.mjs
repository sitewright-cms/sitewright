// Builds the showcase pages: sc-src/<id>.hbs → site/pages/<id>.hbs.
//
// A source file is a normal page source plus two directives, so every code window shows EXACTLY the
// markup that produced the live demo above it:
//
//   <!--demo:NAME-->…markup…<!--/demo-->     emits the markup live, and remembers it under NAME
//   <!--code:NAME file="label"-->           emits a dark code window with NAME's markup, escaped + highlighted
//
// Inside a demo:
//   <!--elide:text-->…<!--/elide-->          live: kept · code: replaced by an <!-- text --> comment line
//   <!--hide-->…<!--/hide-->                 live: kept · code: dropped
//
//   node build.mjs <id> [<id>…]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'sc-src');
const OUT = join(here, '..', 'site', 'pages');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A literal mustache in a sample must not execute: `\{{` is Handlebars' escape.
const hb = (s) => esc(s).replace(/\{\{/g, '\\{{');
const span = (cls, s) => `<span class="${cls}">${s}</span>`;

/** Highlight a value that may contain mustaches (an attribute string or text). */
function mixed(s, baseCls) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf('{{', i);
    if (j === -1) { out += baseCls ? span(baseCls, hb(s.slice(i))) : hb(s.slice(i)); break; }
    if (j > i) out += baseCls ? span(baseCls, hb(s.slice(i, j))) : hb(s.slice(i, j));
    const k = s.indexOf('}}', j);
    const end = k === -1 ? s.length : k + 2;
    out += span('tk-hb', hb(s.slice(j, end)));
    i = end;
  }
  return out;
}

/** Tokenize authored markup into the site's code-window token spans. */
function highlight(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('{{', i)) {
      const k = src.indexOf('}}', i);
      const end = k === -1 ? src.length : k + 2;
      out += span('tk-hb', hb(src.slice(i, end)));
      i = end;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const k = src.indexOf('-->', i);
      const end = k === -1 ? src.length : k + 3;
      out += span('tk-com', hb(src.slice(i, end)));
      i = end;
      continue;
    }
    const tag = /^<\/?[a-zA-Z][a-zA-Z0-9-]*/.exec(src.slice(i));
    if (tag) {
      out += span('tk-tag', esc(tag[0]));
      i += tag[0].length;
      // attributes until the closing > (quotes may hold > and mustaches)
      while (i < src.length) {
        const ch = src[i];
        if (ch === '>') { out += span('tk-tag', '&gt;'); i += 1; break; }
        if (src.startsWith('/>', i)) { out += span('tk-tag', '/&gt;'); i += 2; break; }
        if (/\s/.test(ch)) { out += ch; i += 1; continue; }
        if (src.startsWith('{{', i)) {
          const k = src.indexOf('}}', i);
          const end = k === -1 ? src.length : k + 2;
          out += span('tk-hb', hb(src.slice(i, end)));
          i = end;
          continue;
        }
        const name = /^[^\s=>/]+/.exec(src.slice(i));
        if (name) {
          out += span('tk-attr', hb(name[0]));
          i += name[0].length;
          if (src[i] === '=') {
            out += '=';
            i += 1;
            const q = src[i];
            if (q === '"' || q === "'") {
              const close = src.indexOf(q, i + 1);
              const end = close === -1 ? src.length : close + 1;
              out += mixed(src.slice(i, end), 'tk-str');
              i = end;
            } else {
              const v = /^[^\s>]+/.exec(src.slice(i));
              if (v) { out += mixed(v[0], 'tk-str'); i += v[0].length; }
            }
          }
          continue;
        }
        out += esc(ch);
        i += 1;
      }
      continue;
    }
    // text up to the next tag / mustache / comment
    let j = i + 1;
    while (j < src.length && src[j] !== '<' && !src.startsWith('{{', j)) j += 1;
    out += hb(src.slice(i, j));
    i = j;
  }
  return out;
}

/** Remove the common leading indentation and blank edge lines. */
function dedent(s) {
  const lines = s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

function codeOf(markup) {
  // elide → one comment line at the block's own indentation; hide → nothing
  let s = markup.replace(/([ \t]*)<!--elide:([\s\S]*?)-->[\s\S]*?<!--\/elide-->/g, (_, ind, text) => `${ind}<!-- ${text.trim()} -->`);
  s = s.replace(/[ \t]*<!--hide-->[\s\S]*?<!--\/hide-->\n?/g, '');
  return dedent(s);
}

function liveOf(markup) {
  return markup
    .replace(/<!--elide:[\s\S]*?-->/g, '')
    .replace(/<!--\/elide-->/g, '')
    .replace(/<!--hide-->/g, '')
    .replace(/<!--\/hide-->/g, '');
}

function windowFor(file, code) {
  return (
    `<div class="ws-window overflow-hidden rounded-2xl">\n` +
    `  <div class="ws-dots flex items-center gap-1.5 border-b border-white/10 px-4 py-3"><i></i><i></i><i></i><span class="ml-3 font-code text-xs text-white/50">${esc(file)}</span></div>\n` +
    `<pre class="overflow-x-auto"><code>${highlight(code)}</code></pre>\n` +
    `</div>`
  );
}

// The close of every showcase page: the other demos as a compact grid. Inlined (not a shared snippet,
// which other writers own); the list is named in the page's own source so the renderer builds it.
const SHOWCASE_NEXT = `<section class="border-t border-base-content/10 bg-base-200/50">
  <div class="mx-auto max-w-7xl px-6 py-16 sm:py-20">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h2 class="ws-display text-3xl font-bold sm:text-4xl">More of the showcase</h2>
      <a class="btn btn-ghost btn-sm" href="{{sw-url '/showcase'}}">All demos {{sw-icon "arrow-right" "h-4 w-4"}}</a>
    </div>
    <div class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {{#each pages.showcase._attributes.children}}
      {{#unless (eq path @root.page.path)}}
      <a class="ws-tile rounded-2xl border border-base-content/10 bg-base-100 p-4" href="{{sw-url path}}">
        <span class="flex items-center gap-2 font-heading font-semibold">{{#if data.icon}}{{sw-icon data.icon "h-4 w-4 ws-ink"}}{{/if}}{{title}}</span>
      </a>
      {{/unless}}
      {{/each}}
    </div>
  </div>
</section>`;

function build(id) {
  const src = readFileSync(join(SRC, `${id}.hbs`), 'utf8').replace('{{> showcase-next}}', SHOWCASE_NEXT);
  const demos = new Map();
  let out = src.replace(/<!--demo:([\w-]+)-->([\s\S]*?)<!--\/demo-->/g, (_, name, markup) => {
    if (demos.has(name)) throw new Error(`${id}: duplicate demo "${name}"`);
    demos.set(name, markup);
    return liveOf(markup);
  });
  out = out.replace(/([ \t]*)<!--code:([\w-]+)(?:\s+file="([^"]*)")?-->/g, (_, ind, name, file) => {
    const markup = demos.get(name);
    if (markup === undefined) throw new Error(`${id}: code window for unknown demo "${name}"`);
    return windowFor(file || 'page.hbs', codeOf(markup));
  });
  if (/<!--(demo|code|elide|hide)/.test(out)) throw new Error(`${id}: unprocessed directive left`);
  writeFileSync(join(OUT, `${id}.hbs`), out);
  console.log(`built ${id} (${out.length} chars, ${demos.size} demos)`);
}

for (const id of process.argv.slice(2)) build(id);
