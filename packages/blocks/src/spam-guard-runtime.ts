/**
 * The proof of work and the captcha, as one piece of runtime shared by the widgets that post to the platform: the
 * booking widget and the cart. It is plain function declarations, spliced INTO each runtime's own IIFE, so nothing
 * lands on `window`.
 *
 * - `swPowSolve(url)` asks the challenge at `url` and finds n with sha256(salt + n) = challenge. It REJECTS when it
 *   cannot (no Web Crypto on plain http, a refused challenge), so a caller never posts without the work: a post the
 *   server will refuse anyway, shown to the visitor as sent, is how forms once failed silently.
 * - `swCaptcha(provider, siteKey, box)` draws the project's captcha EXPLICITLY into `box`. The box carries none of the
 *   vendors' class names, so their auto-render (which a contact form on the same page relies on) never touches it,
 *   and the widget id is always ours: the answer is read and the widget reset by that id, never "the first widget on
 *   the page". The vendor script is loaded once per page, marked as the forms runtime marks it, so a page with a form
 *   and a cart loads it once.
 *
 * (No backticks or dollar-brace in the runtime below: it is spliced into other template literals.)
 */
export const SPAM_GUARD_JS = `
  function swPowSolve(url){
    if(!window.crypto||!window.crypto.subtle||!window.TextEncoder){return Promise.reject(new Error('pow'));}
    return fetch(url,{headers:{accept:'application/json'}}).then(function(r){
      return r.json().then(function(b){return {status:r.status,body:b};},function(){return {status:r.status,body:null};});
    }).then(function(r){
      var c=r.body;
      if(r.status!==200||!c||typeof c.salt!=='string'||typeof c.maxnumber!=='number'){throw new Error('pow');}
      var enc=new TextEncoder(),n=0;
      function step(){
        if(n>c.maxnumber){throw new Error('pow');}
        return window.crypto.subtle.digest('SHA-256',enc.encode(c.salt+String(n))).then(function(buf){
          var b=new Uint8Array(buf),hex='';
          for(var i=0;i<b.length;i++){hex+=(b[i]<16?'0':'')+b[i].toString(16);}
          if(hex===c.challenge){return btoa(JSON.stringify({algorithm:c.algorithm,challenge:c.challenge,salt:c.salt,number:n,signature:c.signature}));}
          n++;
          return step();
        });
      }
      return step();
    });
  }
  function swCaptchaScript(src,mark){
    var sel=window.CSS&&window.CSS.escape?window.CSS.escape(mark):mark.replace(/[^A-Za-z0-9_-]/g,'');
    if(document.querySelector('script[data-sw-captcha-src="'+sel+'"]')){return;}
    var s=document.createElement('script');
    s.src=src;s.async=true;s.defer=true;s.setAttribute('data-sw-captcha-src',mark);
    document.head.appendChild(s);
  }
  function swCaptcha(provider,key,box){
    var id=null,waiting=false;
    function vendor(){return provider==='hcaptcha'?window.hcaptcha:window.grecaptcha;}
    // Runs cb once the vendor can render: now, on reCAPTCHA's own ready(), or when its script has arrived.
    function whenReady(cb){
      var v=vendor();
      if(v&&v.render){cb();return;}
      if(v&&v.ready){v.ready(cb);return;}
      if(provider==='hcaptcha'){swCaptchaScript('https://js.hcaptcha.com/1/api.js','hcaptcha');}
      else{swCaptchaScript('https://www.google.com/recaptcha/api.js','recaptcha');}
      var tries=0,timer=setInterval(function(){
        var w=vendor();
        if(w&&w.render){clearInterval(timer);cb();}
        // Twenty seconds and no script: give up for now, so the next mount() (the buyer's next try) asks again.
        else if(++tries>200){clearInterval(timer);waiting=false;}
      },100);
    }
    return {
      mount:function(){
        if(provider==='recaptcha-v3'){if(!window.grecaptcha){swCaptchaScript('https://www.google.com/recaptcha/api.js?render='+encodeURIComponent(key),'recaptcha-v3-'+key);}return;}
        if(id!==null||waiting){return;}
        waiting=true;
        whenReady(function(){try{id=vendor().render(box,{sitekey:key});}catch(e){}waiting=false;});
      },
      token:function(){
        var v=vendor();
        if(provider==='recaptcha-v3'){
          if(!v||!v.execute){return Promise.reject(new Error('captcha'));}
          return new Promise(function(res,rej){v.ready(function(){v.execute(key,{action:'submit'}).then(function(tk){if(tk){res(tk);}else{rej(new Error('captcha'));}},function(){rej(new Error('captcha'));});});});
        }
        var tk='';
        try{tk=id!==null&&v&&v.getResponse?v.getResponse(id):'';}catch(e){tk='';}
        return tk?Promise.resolve(tk):Promise.reject(new Error('captcha'));
      },
      reset:function(){var v=vendor();if(id!==null&&v&&v.reset){try{v.reset(id);}catch(e){}}},
      field:provider==='hcaptcha'?'h-captcha-response':'g-recaptcha-response',
      /** reCAPTCHA v3 has no widget: nothing to place on the page. */
      visible:provider!=='recaptcha-v3'
    };
  }
`;
