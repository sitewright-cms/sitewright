// CLICK-TO-LOAD EMBED — a privacy-first, consent-gated third-party media embed (YouTube / Google Maps).
// The real <iframe> is HELD as `data-embed-src` and never loaded until the visitor either consents to the
// embed's category (auto-loads via the `sw:consentchange` event) or clicks "Load" on the placeholder.
//
// It's a first-party COMPONENT (`data-sw-component="embed"`) — so its CSS/JS ship via the same only-used
// component pipeline as Modal/Tabs, and the per-page CSP `frame-src` is derived from the providers used
// (an <iframe> is its own browsing context, so the provider needs exactly one stable frame-src origin).
//
// Security: the runtime builds an <iframe> via createElement + setAttribute (no innerHTML of data); the
// src is the render-sanitized https URL baked into `data-embed-src`. The "Always allow" affordance only
// appears when the consent manager is present and just calls `window.swConsent.set` for THIS category.
// PE: with no JS there is a `<noscript>` link to view the content at the provider.

import { EMBED_PROVIDERS, type EmbedProvider } from '@sitewright/schema';

/** Only-used-ships + the per-page CSP frame-src scan: which embed providers a source/slot uses. */
export function embedProvidersInSource(html: string | null | undefined): Set<EmbedProvider> {
  const out = new Set<EmbedProvider>();
  if (typeof html !== 'string' || html.length === 0) return out;
  for (const p of EMBED_PROVIDERS) {
    // Detect the rendered marker (hand-authored component) OR the {{sw-embed "<provider>" …}} helper call.
    if (html.includes(`data-embed-providerkey="${p}"`) || new RegExp(`\\{\\{\\s*sw-embed\\s+"${p}"`).test(html)) out.add(p);
  }
  return out;
}

/** The provider display name + the default gating category + the default aspect ratio. */
export const EMBED_PROVIDER_META: Readonly<Record<EmbedProvider, { name: string; category: 'functional' | 'analytics' | 'marketing'; ratio: string }>> = {
  youtube: { name: 'YouTube', category: 'marketing', ratio: '16 / 9' },
  'google-maps': { name: 'Google Maps', category: 'functional', ratio: '4 / 3' },
};

// Themed, dark-mode aware (the placeholder surface reads a --sw-color-* token). Hidden controls until JS.
export const EMBED_CSS = [
  '[data-sw-component="embed"]{display:block;position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:.5rem;background:var(--sw-color-base-200,#e5e7eb);color:var(--sw-color-base-content,#1a1a23)}',
  '[data-sw-component="embed"] iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}',
  '[data-sw-component="embed"] .sw-embed-ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;text-align:center;padding:1rem;background-size:cover;background-position:center}',
  // A scrim so the text/buttons stay legible over a poster thumbnail.
  '[data-sw-component="embed"] .sw-embed-ph::before{content:"";position:absolute;inset:0;background:rgba(15,23,42,.45)}',
  '[data-sw-component="embed"] .sw-embed-ph>*{position:relative}',
  '[data-sw-component="embed"][data-embed-poster] .sw-embed-ph{color:#fff}',
  '[data-sw-component="embed"] .sw-embed-note{margin:0;font-size:.85rem;max-width:24rem}',
  '[data-sw-component="embed"] .sw-embed-always{font-size:.78rem;text-decoration:underline;background:none;border:0;color:inherit;cursor:pointer;opacity:.85}',
  '[data-sw-component="embed"] noscript a{color:var(--sw-color-primary,#4f46e5)}',
].join('');

// ES5-style IIFE — served raw, never transpiled.
export const EMBED_JS = `(function(){
  function el(tag,opts){var e=document.createElement(tag);opts=opts||{};if(opts.text!=null)e.textContent=opts.text;if(opts.cls)e.className=opts.cls;var a=opts.attrs;if(a)for(var k in a){if(Object.prototype.hasOwnProperty.call(a,k))e.setAttribute(k,a[k]);}return e;}
  function granted(cat){try{return window.swConsent?!!window.swConsent.get()[cat]:false;}catch(e){return false;}}
  function load(root){
    if(root.getAttribute('data-embed-loaded')==='1')return;root.setAttribute('data-embed-loaded','1');
    var src=root.getAttribute('data-embed-src');if(!src)return;
    var f=el('iframe',{attrs:{src:src,title:root.getAttribute('data-embed-title')||'Embedded content',loading:'lazy',allowfullscreen:'',referrerpolicy:'strict-origin-when-cross-origin',allow:'fullscreen; picture-in-picture; encrypted-media'}});
    var ph=root.querySelector('.sw-embed-ph');if(ph)ph.parentNode.removeChild(ph);
    root.appendChild(f);
  }
  var CATS={functional:1,analytics:1,marketing:1};
  function placeholder(root){
    var provider=root.getAttribute('data-embed-provider')||'this provider';
    var cat=root.getAttribute('data-embed-category')||'functional';
    var poster=root.getAttribute('data-embed-poster');
    var ph=el('div',{cls:'sw-embed-ph'});
    if(poster)ph.style.backgroundImage='url("'+poster.replace(/"/g,'%22')+'")';
    ph.appendChild(el('p',{cls:'sw-embed-note',text:(root.getAttribute('data-embed-note')||('This content is loaded from '+provider+'.')) }));
    var loadBtn=el('button',{cls:'btn btn-sm btn-primary',text:(root.getAttribute('data-embed-load')||'Load')+' '+provider,attrs:{type:'button'}});
    loadBtn.addEventListener('click',function(){load(root);});
    ph.appendChild(loadBtn);
    // "Always allow" appears whenever the page has a consent manager (its mount is on every page). NOTE: consent.js
    // loads AFTER this component runtime, so we detect the MOUNT here (window.swConsent isn't set yet at enhance
    // time); at click time window.swConsent is present → grant the (validated) category, else just load this one.
    if(document.querySelector('[data-sw-consent]')){var always=el('button',{cls:'sw-embed-always',text:(root.getAttribute('data-embed-always')||'Always allow')+' '+provider,attrs:{type:'button'}});
      always.addEventListener('click',function(){if(window.swConsent&&Object.prototype.hasOwnProperty.call(CATS,cat)){try{var c=window.swConsent.get();c[cat]=true;window.swConsent.set(c);return;}catch(e){}}load(root);});
      ph.appendChild(always);}
    root.insertBefore(ph,root.firstChild);
  }
  function enhance(root){
    if(root.getAttribute('data-sw-enhanced')==='true')return;root.setAttribute('data-sw-enhanced','true');
    var cat=root.getAttribute('data-embed-category')||'functional';
    if(granted(cat)){load(root);return;}
    placeholder(root);
    window.addEventListener('sw:consentchange',function(e){try{if(e.detail&&e.detail[cat])load(root);}catch(_e){}});
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="embed"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

/** Build the iframe src + the no-JS "view at provider" URL for a provider + id/query. */
export function buildEmbed(provider: EmbedProvider, idOrUrl: string): { src: string; watch: string; poster?: string } | null {
  const raw = idOrUrl.trim();
  if (!raw) return null;
  if (provider === 'youtube') {
    // Accept a bare id OR a youtube URL (watch?v= / youtu.be/ / embed/ / shorts/ / live/). Sanitize to the id charset.
    const m = /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{6,})/.exec(raw) || /^([A-Za-z0-9_-]{6,})$/.exec(raw);
    const id = m ? m[1] : '';
    if (!id) return null;
    return { src: `https://www.youtube-nocookie.com/embed/${id}`, watch: `https://www.youtube.com/watch?v=${id}`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }
  // google-maps: a full google.com/maps URL is reused, but ONLY with the exact host the frame-src allows
  // (a loose `google.<tld>` regex would accept `google.evil.com`). A URL parse pins the hostname; anything
  // else (a place name, a short-link, a ccTLD) falls through to a safe maps query on www.google.com.
  if (raw.startsWith('https://')) {
    try {
      const u = new URL(raw);
      if ((u.hostname === 'www.google.com' || u.hostname === 'google.com') && u.pathname.startsWith('/maps')) {
        const src = u.searchParams.has('output') ? raw : `${raw}${raw.includes('?') ? '&' : '?'}output=embed`;
        return { src, watch: raw };
      }
    } catch {
      /* not a URL → treat as a place query below */
    }
  }
  const q = encodeURIComponent(raw);
  return { src: `https://www.google.com/maps?q=${q}&output=embed`, watch: `https://www.google.com/maps?q=${q}` };
}
