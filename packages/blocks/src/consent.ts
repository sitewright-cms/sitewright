// CONSENT MANAGER — a first-party, dependency-free cookie-consent runtime for PUBLISHED static sites.
// It runs the banner state machine + UI, injects managed registry integrations on consent, AND gates
// author content: cross-origin `<iframe>` embeds (held click-to-load) and `<script type="text/plain"
// data-sw-consent="cat">` tags (activated on consent). One runtime, shipped whenever the manager is on.
//
// What it does: shows a consent banner (first layer: Accept all / Reject all / Customize) with an
// expandable preferences panel (per-category toggles; "Strictly necessary" is always on), remembers
// the choice in localStorage (versioned — bump `website.consent.version` to re-prompt), and broadcasts
// the decision so other runtimes (and its own gates) react:
//   - window dispatches a `sw:consentchange` CustomEvent { detail: {necessary, functional, analytics,
//     marketing} } whenever consent is set or changed (and once on load if already stored).
//   - window.swConsent = { get(): categories, open(): re-open preferences, set(categories) }.
//
// AUTHOR-CONTENT GATING: at publish a cross-origin author `<iframe>` is emitted HELD (its `src` moved to
// `data-sw-consent-src`, category in `data-sw-consent-cat`); a `<script type="text/plain" data-sw-consent>`
// stays inert. This runtime loads/activates them when their category is consented (or via the placeholder's
// "Allow once" = this one only / "Always allow" = grant the category). In PREVIEW a `grantAll` config flag
// pre-grants everything so the editor renders WYSIWYG. createElement/textContent only — never innerHTML.
//
// Same "only-used-ships" discipline as cart.ts: ships CONSENT_CSS + a `consent.js` file ONLY when the
// manager is enabled (the `{{sw-consent}}` marker, or any held author content). First-party, audited,
// static code — tenants supply only DATA (category copy, version, layout) via an escaped config attribute.
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
  // Visibility is driven by `data-open` (NOT the `hidden` attr — this enhanced rule would override
  // `[hidden]{display:none}` on specificity). Closed = slid down + faded + non-interactive; `[data-open]`
  // slides it up. The transition gives the slideUp/slideDown on open/close.
  '[data-sw-consent][data-sw-enhanced="true"]{display:block;position:fixed;z-index:9996;left:1rem;right:1rem;bottom:1rem;margin:0 auto;max-width:min(64rem,calc(100vw - 2rem));background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1a1a23);border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);border-radius:.75rem;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:1.25rem 1.4rem;font-size:.9rem;line-height:1.5;transform:translateY(calc(100% + 1.5rem));opacity:0;visibility:hidden;transition:transform .35s cubic-bezier(.22,1,.36,1),opacity .3s ease,visibility .35s}',
  '[data-sw-consent][data-sw-enhanced="true"][data-open]{transform:none;opacity:1;visibility:visible}',
  '[data-sw-consent][data-layout="box"][data-sw-enhanced="true"]{right:auto;max-width:min(32rem,calc(100vw - 2rem))}',
  '@media (prefers-reduced-motion:reduce){[data-sw-consent][data-sw-enhanced="true"]{transition:none}}',
  '[data-sw-consent] .sw-consent-title{margin:0 0 .35rem;font-size:1.05rem;font-weight:700}',
  '[data-sw-consent] .sw-consent-intro{margin:0 0 .9rem}',
  '[data-sw-consent] .sw-consent-actions{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end}',
  // The buttons ride the vendored .btn classes the author already has; these are only layout nudges.
  '[data-sw-consent] .sw-consent-prefs{display:none;margin:.5rem 0 1rem;border-top:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);padding-top:.85rem}',
  '[data-sw-consent][data-prefs="open"] .sw-consent-prefs{display:block}',
  '[data-sw-consent] .sw-consent-cat{display:flex;gap:.7rem;align-items:flex-start;padding:.5rem 0}',
  // Toggle switch (self-contained, no daisyUI `toggle` util needed — the published sheet wouldn\'t scan it):
  // green when on (success), grey when off; the knob slides. The locked "necessary" toggle reads disabled.
  '[data-sw-consent] .sw-consent-cat input{appearance:none;-webkit-appearance:none;margin:.1rem 0 0;flex:none;position:relative;width:2.25rem;height:1.3rem;border-radius:999px;background:color-mix(in oklab,var(--sw-color-base-content,#000) 25%,transparent);cursor:pointer;transition:background .2s}',
  '[data-sw-consent] .sw-consent-cat input:checked{background:var(--sw-color-success,#16a34a)}',
  '[data-sw-consent] .sw-consent-cat input::before{content:"";position:absolute;top:.15rem;left:.15rem;width:1rem;height:1rem;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .2s}',
  '[data-sw-consent] .sw-consent-cat input:checked::before{transform:translateX(.95rem)}',
  '[data-sw-consent] .sw-consent-cat input:disabled{opacity:.55;cursor:not-allowed}',
  '[data-sw-consent] .sw-consent-cat input:focus-visible{outline:2px solid var(--sw-color-primary,#4f46e5);outline-offset:2px}',
  '[data-sw-consent] .sw-consent-cat-name{font-weight:600}',
  '[data-sw-consent] .sw-consent-cat-desc{margin:.1rem 0 0;font-size:.82rem;opacity:.8}',
  '[data-sw-consent] .sw-consent-link{color:var(--sw-color-primary,#4f46e5);text-decoration:underline}',
  '@media (max-width:520px){[data-sw-consent] .sw-consent-actions .btn{flex:1 1 auto}}',
  // Click-to-load placeholder for a HELD author <iframe>. A self-contained bordered card (the gated iframe
  // may sit anywhere, so the placeholder owns its own box) — themed via the same --sw-color-* tokens.
  '.sw-gate-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7rem;text-align:center;width:100%;min-height:11rem;padding:1.25rem;box-sizing:border-box;background:var(--sw-color-base-200,#e5e7eb);color:var(--sw-color-base-content,#1a1a23);border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);border-radius:.5rem}',
  '.sw-gate-ph .sw-gate-note{margin:0;font-size:.9rem;max-width:28rem}',
  '.sw-gate-ph .sw-gate-actions{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}',
].join('');

// ES5-style (var / function) — served raw, never transpiled, like the other runtime bundles.
export const CONSENT_JS = `(function(){
  var STORE='sw-consent';
  // Resolve the per-site storage key ONCE, at script-execution time: document.currentScript is the consent.js
  // element HERE, but is NULL inside a later event handler — so deriving it lazily would key a click→writeStore
  // off location.pathname yet key the init→readStore off the script URL, and consent would be silently lost on
  // reload (write key != read key). Caching it makes both sides use the same key.
  var SITE_KEY=(function(){try{var s=document.currentScript;if(s&&s.src)return new URL('.',s.src).href;}catch(e){}return location.pathname||'/';})();
  function keyOf(){return STORE+':'+SITE_KEY;}
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

  // ── AUTHOR-CONTENT GATING ───────────────────────────────────────────────────────────────────────
  // A held <iframe data-sw-consent-src> / inert <script type="text/plain" data-sw-consent> is loaded or
  // activated once its category is granted (current[cat] / a consentchange event), or via the placeholder.
  var GCATS={functional:1,analytics:1,marketing:1};
  function gcat(node){var c=node.getAttribute('data-sw-consent-cat')||node.getAttribute('data-sw-consent')||'';return GCATS[c]?c:'functional';}
  function loadGatedIframe(fr){
    if(fr.getAttribute('data-sw-gate-done')==='1')return;fr.setAttribute('data-sw-gate-done','1');
    var src=fr.getAttribute('data-sw-consent-src');fr.removeAttribute('data-sw-consent-src');
    if(src)fr.setAttribute('src',src);
    fr.style.display='';var ph=fr.__swPh;if(ph&&ph.parentNode)ph.parentNode.removeChild(ph);fr.__swPh=null;
  }
  function activateGatedScript(sc){
    if(sc.getAttribute('data-sw-gate-done')==='1')return;sc.setAttribute('data-sw-gate-done','1');
    var ns=document.createElement('script'),src=sc.getAttribute('src');
    if(src){ns.src=src;if(sc.getAttribute('async')!==null)ns.async=true;if(sc.getAttribute('defer')!==null)ns.defer=true;var co=sc.getAttribute('crossorigin');if(co!==null)ns.setAttribute('crossorigin',co);}
    else{ns.text=sc.textContent||'';}
    var id=sc.getAttribute('id');if(id)ns.id=id;
    if(sc.parentNode)sc.parentNode.replaceChild(ns,sc); // replacing a type=text/plain node with a typed one runs it
  }
  function gatePlaceholder(fr,cat,labels){
    var ph=el('div',{cls:'sw-gate-ph'});
    ph.appendChild(el('p',{cls:'sw-gate-note',text:(fr.getAttribute('data-sw-consent-note')||labels.note||'This content is loaded from a third party. Allow it to load?')}));
    var row=el('div',{cls:'sw-gate-actions'});
    var once=el('button',{cls:'btn btn-sm btn-primary',text:labels.once||'Allow once',attrs:{type:'button'}});
    once.addEventListener('click',function(){loadGatedIframe(fr);});
    row.appendChild(once);
    // "Always allow" grants the whole category — only meaningful when a consent banner is mounted (so the
    // grant persists + re-broadcasts). Without a [data-sw-consent] mount it would silently degrade to a
    // one-shot load, so we hide it rather than show a button that doesn't do what it says.
    if(window.swConsent&&document.querySelector('[data-sw-consent]')){
      var always=el('button',{cls:'btn btn-sm btn-ghost',text:labels.always||'Always allow',attrs:{type:'button'}});
      always.addEventListener('click',function(){try{var c=window.swConsent.get();c[cat]=true;window.swConsent.set(c);}catch(e){loadGatedIframe(fr);}});
      row.appendChild(always);
    }
    ph.appendChild(row);
    var w=fr.getAttribute('width');if(w&&/^[0-9]+$/.test(w))ph.style.maxWidth=w+'px';
    fr.style.display='none';fr.__swPh=ph;
    if(fr.parentNode)fr.parentNode.insertBefore(ph,fr);
  }
  function initGates(mountCfg){
    var t=(mountCfg&&mountCfg.t)||{};
    var labels={once:t.allowOnce,always:t.alwaysAllow,note:t.embedNote};
    var frames=document.querySelectorAll('iframe[data-sw-consent-src]');
    for(var i=0;i<frames.length;i++){var fr=frames[i],fc=gcat(fr);if(current[fc])loadGatedIframe(fr);else gatePlaceholder(fr,fc,labels);}
    var scripts=document.querySelectorAll('script[type="text/plain"][data-sw-consent]');
    for(var j=0;j<scripts.length;j++){var sc=scripts[j];if(current[gcat(sc)])activateGatedScript(sc);}
    window.addEventListener('sw:consentchange',function(e){try{var d=e.detail||{};
      var fs=document.querySelectorAll('iframe[data-sw-consent-src]');for(var a=0;a<fs.length;a++){if(d[gcat(fs[a])])loadGatedIframe(fs[a]);}
      var ss=document.querySelectorAll('script[type="text/plain"][data-sw-consent]');for(var b=0;b<ss.length;b++){if(d[gcat(ss[b])])activateGatedScript(ss[b]);}
    }catch(_e){}});
  }

  function enhance(root){
    if(root.getAttribute('data-sw-enhanced')==='true')return;
    var cfg=cfgOf(root);
    var version=(typeof cfg.v==='number'&&cfg.v>0)?cfg.v:1;
    var t=cfg.t||{};
    var cats=(cfg.cats&&cfg.cats.length)?cfg.cats:[];
    function txt(k,fb){return (typeof t[k]==='string'&&t[k])?t[k]:fb;}

    // Build the banner UI ONCE (idempotent). createElement + textContent only — no HTML-string sinks.
    // Title is a <div> (not a heading): the banner sits on every page and an <h1>/<h2> would pollute the
    // document outline / SEO. The region's aria-label carries the accessible name instead.
    var title=el('div',{cls:'sw-consent-title',text:txt('title','We value your privacy')});
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

    // Managed third-party integrations the runtime injects when their category is consented (de-duped by id).
    // NOTE: once a script is in the DOM it can't be retracted — withdrawing a category is honored on the NEXT
    // page load only (the banner re-prompt + version bump handle re-consent). Browsers don't un-run scripts.
    var ints=(cfg.ints&&cfg.ints.length)?cfg.ints:[];
    var loaded={},gtagLoaded=0;
    function injectScript(src,async,id){var s=document.createElement('script');s.src=src;s.async=!!async;s.setAttribute('data-sw-consent-loaded',id);(document.head||document.documentElement).appendChild(s);} // async set EXPLICITLY — a dynamically-created script defaults to async=true, so async:false must be forced off
    // ga4/gtm run a self-origin bootstrap (consent.js is 'self', so no inline-CSP issue) then load the external
    // gtag/gtm script; a plain 'script' just loads its src. CSP allows only the registered origins (derived at publish).
    function loadConsented(){
      for(var k=0;k<ints.length;k++){var it=ints[k];if(!it||loaded[it.id]||!current[it.cat])continue;loaded[it.id]=1;
        if(it.kind==='ga4'){window.dataLayer=window.dataLayer||[];if(!window.gtag)window.gtag=function(){window.dataLayer.push(arguments);};window.gtag('js',new Date());if(it.mid)window.gtag('config',it.mid);if(!gtagLoaded){gtagLoaded=1;injectScript(it.src,true,it.id);}} // gtag.js loads ONCE; extra GA4 ids just gtag('config',…)
        else if(it.kind==='gtm'){window.dataLayer=window.dataLayer||[];window.dataLayer.push({'gtm.start':+new Date(),event:'gtm.js'});injectScript(it.src,true,it.id);}
        else{injectScript(it.src,it.async!==false,it.id);}
      }
    }
    function showBanner(){root.setAttribute('data-open','');}
    function hideBanner(){root.removeAttribute('data-open');}
    function syncBoxes(){for(var id in boxes){if(boxes[id])boxes[id].checked=!!current[id];}} // reflect current on the toggles
    function apply(catObj){current=withNecessary(catObj);writeStore({v:version,cats:{functional:current.functional,analytics:current.analytics,marketing:current.marketing},ts:+new Date()});syncBoxes();hideBanner();broadcast();loadConsented();}
    // Open preferences: reveal the panel + Save, HIDE the now-redundant Customize button, sync the toggles.
    function openPrefs(){root.setAttribute('data-prefs','open');btnCustomize.style.display='none';btnSave.style.display='';syncBoxes();}
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

    // Decide visibility. PREVIEW pre-grant (grantAll) auto-accepts everything so the editor renders
    // gated embeds + integrations WYSIWYG — never set on a real publish. Else honor the stored record.
    var rec=readStore();
    if(cfg.grantAll){
      apply(emptyCats(true)); // sets current, stays closed, broadcasts + loadConsented (gates read current in initGates)
    }else if(rec&&typeof rec.v==='number'&&rec.v>=version&&rec.cats){
      current=withNecessary(rec.cats); // already-consented → stays closed
      broadcast(); // tell late listeners the current state
      loadConsented(); // re-inject the integrations the visitor already consented to (on every page load)
    }else{
      showBanner(); // first visit → slide the banner up
    }

    // Public API + the re-open trigger ([data-sw-consent-open] / {{sw-consent-settings}} / a[href="#sw-consent"]).
    window.swConsent={
      get:function(){return withNecessary(current);},
      set:function(c){apply({functional:!!(c&&c.functional),analytics:!!(c&&c.analytics),marketing:!!(c&&c.marketing)});},
      open:function(){showBanner();openPrefs();}
    };
  }

  function init(){
    var roots=document.querySelectorAll('[data-sw-consent]');
    var mountCfg=roots[0]?cfgOf(roots[0]):{};
    if(roots[0])enhance(roots[0]); // one consent manager per site — sets current + window.swConsent
    initGates(mountCfg); // hydrate held author iframes/scripts AFTER enhance has applied current/grantAll
    // Re-open triggers: a [data-sw-consent-open] element OR a SAME-PAGE anchor href="#sw-consent"
    // (e.g. <a href="#sw-consent">Cookie settings</a>). Match the LITERAL href (not the resolved
    // .hash, which a cross-page /other#sw-consent link would also report) and only swallow the click
    // when there's a manager to open — so a cross-page link still navigates normally.
    document.addEventListener('click',function(e){
      var t=e.target;while(t&&t!==document){
        if(t.getAttribute){
          if(t.getAttribute('data-sw-consent-open')!=null&&window.swConsent){e.preventDefault();window.swConsent.open();return;}
          if(t.getAttribute('href')==='#sw-consent'&&window.swConsent){e.preventDefault();window.swConsent.open();return;}
        }
        t=t.parentNode;
      }
    });
    // Also open when the URL targets #sw-consent via hash navigation (a cross-page link landing here, or
    // back/forward). Guarded on a stored decision so a FIRST-time visitor still sees the normal banner.
    function fromHash(){if(location.hash==='#sw-consent'&&window.swConsent&&readStore())window.swConsent.open();}
    window.addEventListener('hashchange',fromHash);
    fromHash();
    // Enforce-with-a-loud-error: if the CSP blocks a consented integration's origin, name it so the owner
    // can add it to that integration's allowed origins (the gating still worked — this is the hardening layer).
    window.addEventListener('securitypolicyviolation',function(e){try{if(e.blockedURI&&/script-src|connect-src|frame-src|img-src/.test(e.violatedDirective||'')){console.error('[sw-consent] CSP blocked '+e.blockedURI+' ('+e.violatedDirective+'). If this is a consented integration, add its origin to that integration\\'s allowed origins.');}}catch(_e){}});
  }
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;
