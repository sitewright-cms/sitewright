// CONSENT MANAGER (core) — a first-party, dependency-free cookie-consent runtime for PUBLISHED
// static sites. PR2 of the consent epic ships the STATE MACHINE + UI only; the actual third-party
// gating (registry-injected scripts, click-to-load embeds) hooks onto this in later PRs.
//
// What it does: shows a consent banner (first layer: Accept all / Reject all / Customize) with an
// expandable preferences panel (per-category toggles; "Strictly necessary" is always on), remembers
// the choice in localStorage (versioned — bump `website.consent.version` to re-prompt), and broadcasts
// the decision so other runtimes can react:
//   - window dispatches a `sw:consentchange` CustomEvent { detail: {necessary, functional, analytics,
//     marketing} } whenever consent is set or changed (and once on load if already stored).
//   - window.swConsent = { get(): categories, open(): re-open preferences, set(categories) }.
//
// Same "only-used-ships" discipline as cart.ts: ships CONSENT_CSS + a `consent.js` file ONLY when a
// page uses the {{sw-consent}} helper (the `data-sw-consent` marker). First-party, audited, static
// code — tenants supply only DATA (category copy, version, layout) via an escaped config attribute.
//
// Security contract (a reviewer should check): the config + all copy reach the DOM via `textContent` /
// `setAttribute` — NEVER `innerHTML` (the UI is built with createElement). The privacy `href` is
// schema-/render-sanitized (safeUrl) before it reaches the mount. localStorage access is try/catch
// guarded and the stored record is re-validated on read. No network, no eval. PE: the mount ships empty
// + display:none, so with no JS there is no banner — and with no JS no third-party scripts load anyway.

// Only-used-ships detection. A code-first SOURCE / skeleton slot contains the HELPER call `{{sw-consent}}`
// (or `{{sw-consent-settings}}`); the `data-sw-consent` attribute only appears after Handlebars runs. The
// substring `sw-consent` covers every form (`{{sw-consent}}`, `{{sw-consent-settings}}`, `data-sw-consent`,
// `data-sw-consent-open`). A stray prose match only over-ships a few KB — benign, like the other runtimes.
export function usesConsent(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.includes('sw-consent');
}

// The optional categories the platform offers (Necessary is implicit + always granted).
export const CONSENT_CATEGORIES = ['functional', 'analytics', 'marketing'] as const;

// Brand-themed, dark-mode aware (every surface/text reads a `--sw-color-*` token whose fallback is the
// light value). The banner is hidden until the runtime adds `data-sw-enhanced` (PE-first).
export const CONSENT_CSS = [
  '[data-sw-consent]{display:none}',
  '[data-sw-consent][data-sw-enhanced="true"]{display:block;position:fixed;z-index:9996;left:1rem;right:1rem;bottom:1rem;margin:0 auto;max-width:min(64rem,calc(100vw - 2rem));background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1a1a23);border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);border-radius:.75rem;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:1.25rem 1.4rem;font-size:.9rem;line-height:1.5}',
  '[data-sw-consent][data-layout="box"][data-sw-enhanced="true"]{right:auto;max-width:min(26rem,calc(100vw - 2rem))}',
  '[data-sw-consent] .sw-consent-title{margin:0 0 .35rem;font-size:1.05rem;font-weight:700}',
  '[data-sw-consent] .sw-consent-intro{margin:0 0 .9rem}',
  '[data-sw-consent] .sw-consent-actions{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end}',
  // The buttons ride the vendored .btn classes the author already has; these are only layout nudges.
  '[data-sw-consent] .sw-consent-prefs{display:none;margin:.5rem 0 1rem;border-top:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);padding-top:.85rem}',
  '[data-sw-consent][data-prefs="open"] .sw-consent-prefs{display:block}',
  '[data-sw-consent] .sw-consent-cat{display:flex;gap:.7rem;align-items:flex-start;padding:.5rem 0}',
  '[data-sw-consent] .sw-consent-cat input{margin-top:.2rem;width:1.05rem;height:1.05rem;accent-color:var(--sw-color-primary,#4f46e5);flex:none}',
  '[data-sw-consent] .sw-consent-cat-name{font-weight:600}',
  '[data-sw-consent] .sw-consent-cat-desc{margin:.1rem 0 0;font-size:.82rem;opacity:.8}',
  '[data-sw-consent] .sw-consent-link{color:var(--sw-color-primary,#4f46e5);text-decoration:underline}',
  '@media (max-width:520px){[data-sw-consent] .sw-consent-actions .btn{flex:1 1 auto}}',
].join('');

// ES5-style (var / function) — served raw, never transpiled, like the other runtime bundles.
export const CONSENT_JS = `(function(){
  var STORE='sw-consent';
  function siteKey(){try{var s=document.currentScript;if(s&&s.src)return new URL('.',s.src).href;}catch(e){}return location.pathname||'/';}
  function keyOf(){return STORE+':'+siteKey();}
  function readStore(){try{var raw=localStorage.getItem(keyOf());if(!raw)return null;var o=JSON.parse(raw);return (o&&typeof o==='object'&&!(o instanceof Array))?o:null;}catch(e){return null;}}
  function writeStore(rec){try{localStorage.setItem(keyOf(),JSON.stringify(rec));}catch(e){}}
  function cfgOf(root){try{return JSON.parse(root.getAttribute('data-sw-consent-config')||'{}')||{};}catch(e){return {};}}
  function el(tag,opts){var e=document.createElement(tag);opts=opts||{};if(opts.text!=null)e.textContent=opts.text;if(opts.cls)e.className=opts.cls;var a=opts.attrs;if(a)for(var k in a){if(Object.prototype.hasOwnProperty.call(a,k))e.setAttribute(k,a[k]);}return e;}
  var CATS=['functional','analytics','marketing'];
  function emptyCats(v){return {functional:!!v,analytics:!!v,marketing:!!v};}
  function withNecessary(c){return {necessary:true,functional:!!c.functional,analytics:!!c.analytics,marketing:!!c.marketing};}
  // The live consent the page is operating under (necessary always true). Updated on store/apply.
  var current=withNecessary(emptyCats(false));
  function broadcast(){try{window.dispatchEvent(new CustomEvent('sw:consentchange',{detail:withNecessary(current)}));}catch(e){}}

  function enhance(root){
    if(root.getAttribute('data-sw-enhanced')==='true')return;
    var cfg=cfgOf(root);
    var version=(typeof cfg.v==='number'&&cfg.v>0)?cfg.v:1;
    var t=cfg.t||{};
    var cats=(cfg.cats&&cfg.cats.length)?cfg.cats:[];
    function txt(k,fb){return (typeof t[k]==='string'&&t[k])?t[k]:fb;}

    // Build the banner UI ONCE (idempotent). createElement + textContent only — no HTML-string sinks.
    var title=el('h2',{cls:'sw-consent-title',text:txt('title','We value your privacy')});
    var intro=el('p',{cls:'sw-consent-intro'});
    intro.appendChild(document.createTextNode(txt('intro','We use cookies to enhance your experience and analyze our traffic. Choose which categories you allow.')+' '));
    if(cfg.privacy){intro.appendChild(el('a',{cls:'sw-consent-link',text:txt('privacyLabel','Privacy policy'),attrs:{href:cfg.privacy,rel:'noopener noreferrer'}}));}

    // Preferences panel (toggles). Necessary first (locked on), then the configured optional categories.
    var prefs=el('div',{cls:'sw-consent-prefs',attrs:{role:'group','aria-label':txt('prefsTitle','Privacy preferences')}});
    var boxes={};
    function addCat(id,name,desc,locked){
      var row=el('label',{cls:'sw-consent-cat'});
      var cb=el('input',{attrs:{type:'checkbox'}});
      cb.checked=locked?true:!!current[id];
      if(locked){cb.disabled=true;}
      else{boxes[id]=cb;}
      var body=el('div',{});
      body.appendChild(el('div',{cls:'sw-consent-cat-name',text:name}));
      if(desc)body.appendChild(el('p',{cls:'sw-consent-cat-desc',text:desc}));
      row.appendChild(cb);row.appendChild(body);
      prefs.appendChild(row);
    }
    addCat('necessary',txt('necessary','Strictly necessary'),txt('necessaryDesc','Required for the site to function. Always on.'),true);
    for(var i=0;i<cats.length;i++){var c=cats[i];if(CATS.indexOf(c.id)<0)continue;addCat(c.id,c.label||c.id,c.desc||'',false);}

    var actions=el('div',{cls:'sw-consent-actions'});
    var btnCustomize=el('button',{cls:'btn btn-sm btn-ghost',text:txt('customize','Customize'),attrs:{type:'button'}});
    var btnReject=cfg.deny!==false?el('button',{cls:'btn btn-sm',text:txt('rejectAll','Reject all'),attrs:{type:'button'}}):null;
    var btnSave=el('button',{cls:'btn btn-sm',text:txt('save','Save preferences'),attrs:{type:'button',style:'display:none'}});
    var btnAccept=el('button',{cls:'btn btn-sm btn-primary',text:txt('acceptAll','Accept all'),attrs:{type:'button'}});

    function apply(catObj){current=withNecessary(catObj);writeStore({v:version,cats:{functional:current.functional,analytics:current.analytics,marketing:current.marketing},ts:+new Date()});root.setAttribute('hidden','');broadcast();}
    function openPrefs(){root.setAttribute('data-prefs','open');btnSave.style.display='';for(var id in boxes){if(boxes[id])boxes[id].checked=!!current[id];}}
    btnCustomize.addEventListener('click',openPrefs);
    if(btnReject)btnReject.addEventListener('click',function(){apply(emptyCats(false));});
    btnAccept.addEventListener('click',function(){apply(emptyCats(true));});
    btnSave.addEventListener('click',function(){var picked={};for(var i2=0;i2<CATS.length;i2++){var id2=CATS[i2];picked[id2]=boxes[id2]?!!boxes[id2].checked:false;}apply(picked);});

    actions.appendChild(btnCustomize);
    if(btnReject)actions.appendChild(btnReject);
    actions.appendChild(btnSave);
    actions.appendChild(btnAccept);

    root.setAttribute('role','region');
    root.setAttribute('aria-label',txt('title','We value your privacy'));
    root.appendChild(title);root.appendChild(intro);root.appendChild(prefs);root.appendChild(actions);
    root.setAttribute('data-sw-enhanced','true');

    // Decide visibility from the stored record (versioned).
    var rec=readStore();
    if(rec&&typeof rec.v==='number'&&rec.v>=version&&rec.cats){
      current=withNecessary(rec.cats);
      root.setAttribute('hidden','');
      broadcast(); // already-consented: tell late listeners the current state
    }else{
      root.removeAttribute('hidden');
    }

    // Public API + the re-open trigger ([data-sw-consent-open] / {{sw-consent-settings}}).
    window.swConsent={
      get:function(){return withNecessary(current);},
      set:function(c){apply({functional:!!(c&&c.functional),analytics:!!(c&&c.analytics),marketing:!!(c&&c.marketing)});},
      open:function(){root.removeAttribute('hidden');openPrefs();}
    };
  }

  function init(){
    var roots=document.querySelectorAll('[data-sw-consent]');
    if(roots[0])enhance(roots[0]); // one consent manager per site
    document.addEventListener('click',function(e){
      var t=e.target;while(t&&t!==document){if(t.getAttribute&&t.getAttribute('data-sw-consent-open')!=null){e.preventDefault();if(window.swConsent)window.swConsent.open();return;}t=t.parentNode;}
    });
  }
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;
