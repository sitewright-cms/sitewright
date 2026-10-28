/**
 * booking.js — fills `{{sw-booking}}` (the booking widget) and `{{sw-booking-status}}` (a booking's own page).
 *
 * The widget asks the platform what can be booked and shows it on the BUSINESS's clock (an appointment in
 * Berlin is at nine in Berlin), naming the time zone when it is not the visitor's. Four pickers, one per
 * offering mode: a week of days with times (`duration`, `slots`), a start and a length inside the free
 * stretches of a day (`range`), and a month calendar with check-in and check-out (`days`). Then the
 * visitor's details, the form routes' bot evidence (honeypot, time, interaction), proof of work and the
 * project's captcha when the set-up asks, and the booking.
 *
 * ★ The server decides. Everything shown here is a listing the server re-checks when the visitor books, so
 * a time that went meanwhile is answered `taken` and the visitor is sent back to choose again.
 * ★ No address in the markup: every URL comes from `window.__swb` (render.ts), and in the editor's preview
 * it adds `?preview=1`, so trying the widget there books nothing.
 *
 * (No backticks or dollar-brace in this file's runtime: it is one template literal.)
 */
export const BOOKING_JS = `(function(){
  var LOC=document.documentElement.getAttribute('lang')||undefined;
  var DAY=86400000,MIN=60000;
  function q(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  function mk(tag,part,text){var e=document.createElement(tag);if(part){e.setAttribute('data-sw-part',part);}if(text!=null){e.textContent=String(text);}return e;}
  function show(e,on){if(!e){return;}if(on){e.removeAttribute('hidden');}else{e.setAttribute('hidden','');}}
  function part(root,name){return root.querySelector('[data-sw-part="'+name+'"]');}
  function labelsOf(m){try{var o=JSON.parse(m.getAttribute('data-sw-labels')||'{}');return o&&typeof o==='object'?o:{};}catch(e){return {};}}
  function api(s,w){return window.__swb?window.__swb(s,w):'';}
  function isPreview(){return !!(window.__swb&&window.__swb.preview);}
  function call(url,init){
    return fetch(url,init||{headers:{accept:'application/json'}}).then(function(r){
      return r.json().then(function(b){return {status:r.status,body:b||{}};},function(){return {status:r.status,body:{}};});
    });
  }
  function post(url,body){return call(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});}

  // ---- clocks: machine parts in en-US, display in the page's language ----------------------------
  var fmts={};
  function fmt(key,tz,opts){
    var k=key+'|'+tz;
    if(!fmts[k]){
      var o={timeZone:tz};for(var p in opts){if(Object.prototype.hasOwnProperty.call(opts,p)){o[p]=opts[p];}}
      var loc=key.charAt(0)==='#'?'en-US':LOC;
      try{fmts[k]=new Intl.DateTimeFormat(loc,o);}catch(e){o.timeZone='UTC';fmts[k]=new Intl.DateTimeFormat('en-US',o);}
    }
    return fmts[k];
  }
  function pad(n){return (n<10?'0':'')+n;}
  function parts(t,tz){
    var ps=fmt('#p',tz,{hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(t)),o={};
    for(var i=0;i<ps.length;i++){o[ps[i].type]=ps[i].value;}
    return {y:+o.year,m:+o.month,d:+o.day,h:(+o.hour)%24,mi:+o.minute};
  }
  function ymdOf(t,tz){var p=parts(t,tz);return p.y+'-'+pad(p.m)+'-'+pad(p.d);}
  function utcOf(d){var a=d.split('-');return Date.UTC(+a[0],+a[1]-1,+a[2]);}
  function addDays(d,n){var x=new Date(utcOf(d)+n*DAY);return x.getUTCFullYear()+'-'+pad(x.getUTCMonth()+1)+'-'+pad(x.getUTCDate());}
  // When a date begins on tz's clock: the UTC midnight, moved by the zone's offset, three times over. Where
  // the clocks jump forward AT midnight (Santiago, Cairo, Havana) the date has no 00:00: the passes then
  // alternate between the hour before the jump and the jump itself, and the third lands on the jump, which
  // is where that date begins (a test pins it).
  function startOf(d,tz){
    var g=utcOf(d),t=g;
    for(var i=0;i<3;i++){var p=parts(t,tz);t-=Date.UTC(p.y,p.m-1,p.d,p.h,p.mi)-g;}
    return t;
  }
  function dayName(d){return fmt('wd','UTC',{weekday:'short'}).format(new Date(utcOf(d)));}
  function dayNum(d){return fmt('dn','UTC',{day:'numeric'}).format(new Date(utcOf(d)));}
  function dateLabel(d){return fmt('dl','UTC',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date(utcOf(d)));}
  function shortDate(d){return fmt('sd','UTC',{day:'numeric',month:'short'}).format(new Date(utcOf(d)));}
  function monthLabel(d){return fmt('ml','UTC',{month:'long',year:'numeric'}).format(new Date(utcOf(d)));}
  function timeLabel(t,tz){return fmt('hm',tz,{hour:'numeric',minute:'2-digit'}).format(new Date(t));}
  // A wall-clock time from the set-up ("15:00"), in the page's own way of writing times.
  function clockLabel(c){var a=String(c||'').split(':');return timeLabel(Date.UTC(2000,0,1,+a[0]||0,+a[1]||0),'UTC');}
  function zoneName(tz){
    try{var ps=new Intl.DateTimeFormat(LOC,{timeZone:tz,timeZoneName:'longGeneric'}).formatToParts(new Date());for(var i=0;i<ps.length;i++){if(ps[i].type==='timeZoneName'){return ps[i].value;}}}catch(e){}
    return tz.split('_').join(' ');
  }
  function visitorZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){return '';}}
  function length(min){var h=Math.floor(min/60),m=min%60;return h+':'+pad(m);}
  // A booking, as a person reads it: its dates, and its times where times matter.
  function when(start,end,tz,mode,unit){
    if(mode==='days'){
      var a=ymdOf(start,tz);
      if(unit==='day'){var z=ymdOf(end-1,tz);return a===z?dateLabel(a):dateLabel(a)+' – '+dateLabel(z);}
      return dateLabel(a)+', '+timeLabel(start,tz)+' – '+dateLabel(ymdOf(end,tz))+', '+timeLabel(end,tz);
    }
    var da=ymdOf(start,tz),db=ymdOf(end,tz);
    return dateLabel(da)+', '+timeLabel(start,tz)+' – '+(db===da?'':dateLabel(db)+', ')+timeLabel(end,tz);
  }

  // ---- the form routes' bot evidence: trusted events only, passive listeners -------------------------
  function evidence(root){
    var p=0,k=0,f={},t0=Date.now();
    function note(ev,kind){if(!ev||ev.isTrusted===false){return;}if(kind==='p'){p++;}else{k++;}var tg=ev.target;if(tg&&tg.name){f[tg.name]=1;}}
    root.addEventListener('pointerdown',function(ev){note(ev,'p');},{passive:true});
    root.addEventListener('touchstart',function(ev){note(ev,'p');},{passive:true});
    root.addEventListener('keydown',function(ev){note(ev,'k');},{passive:true});
    // Autofill and a pasted value arrive as input events, so they count: an autofilling visitor is no bot.
    root.addEventListener('input',function(ev){note(ev,'k');},{passive:true});
    return function(){var n=0;for(var x in f){if(Object.prototype.hasOwnProperty.call(f,x)){n++;}}return {_hpt:'',_elapsed:String(Date.now()-t0),_ix:p+'.'+k+'.'+n};};
  }

  // ---- proof of work: find n with sha256(salt + n) = challenge. REJECTS when it cannot, never posts without ----
  function solve(url){
    if(!window.crypto||!window.crypto.subtle||!window.TextEncoder){return Promise.reject(new Error('pow'));}
    return call(url).then(function(r){
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

  // ---- captcha: the vendor script once per page; the widget rendered EXPLICITLY into its own box ----
  // The box carries none of the vendors' class names, so their auto-render (which a contact form on the same
  // page relies on) never touches it, and the widget id is always ours: the answer is read and the widget
  // reset by that id, never "the first widget on the page".
  function loadScript(src,mark){
    var sel=window.CSS&&window.CSS.escape?window.CSS.escape(mark):mark.replace(/[^A-Za-z0-9_-]/g,'');
    if(document.querySelector('script[data-sw-captcha-src="'+sel+'"]')){return;}
    var s=document.createElement('script');
    s.src=src;s.async=true;s.defer=true;s.setAttribute('data-sw-captcha-src',mark);
    document.head.appendChild(s);
  }
  function Captcha(provider,key,box){
    var id=null,waiting=false;
    function vendor(){return provider==='hcaptcha'?window.hcaptcha:window.grecaptcha;}
    // Runs cb once the vendor can render: now, on reCAPTCHA's own ready(), or when its script has arrived.
    function whenReady(cb){
      var v=vendor();
      if(v&&v.render){cb();return;}
      if(v&&v.ready){v.ready(cb);return;}
      if(provider==='hcaptcha'){loadScript('https://js.hcaptcha.com/1/api.js','hcaptcha');}
      else{loadScript('https://www.google.com/recaptcha/api.js','recaptcha');}
      var tries=0,timer=setInterval(function(){
        var w=vendor();
        if(w&&w.render){clearInterval(timer);cb();}
        else if(++tries>200){clearInterval(timer);}
      },100);
    }
    return {
      mount:function(){
        if(provider==='recaptcha-v3'){if(!window.grecaptcha){loadScript('https://www.google.com/recaptcha/api.js?render='+encodeURIComponent(key),'recaptcha-v3-'+key);}return;}
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
      field:provider==='hcaptcha'?'h-captcha-response':'g-recaptcha-response'
    };
  }

  // ---- the widget ------------------------------------------------------------------------------
  // Answers that arrive after a newer request was made are dropped, so a quick change of resource or week
  // can never draw the older listing over the newer one.
  var STALE={};
  function Widget(mount){
    var id=mount.getAttribute('data-sw-booking')||'',oid=encodeURIComponent(id);
    var L=labelsOf(mount);
    function t(k){var v=L['booking.'+k];return typeof v==='string'?v:'';}
    var evid=evidence(mount),preview=isPreview();
    var loading=part(mount,'loading');
    var note=mk('p','note'),picker=mk('div','picker'),form=mk('form','details'),done=mk('div','done'),message=mk('p','message'),retry=mk('button','retry',t('retry'));
    message.setAttribute('role','status');retry.type='button';retry.className='btn';
    show(note,false);show(form,false);show(done,false);show(retry,false);
    mount.appendChild(note);mount.appendChild(picker);mount.appendChild(form);mount.appendChild(done);mount.appendChild(message);mount.appendChild(retry);
    var o=null,tz='UTC',resource='',choice=null,sending=false,seq=0,again=null,refocus=null;
    function say(text){message.textContent=text||'';}
    // For good: the offering is gone, or cannot be booked at all.
    function fail(text){show(loading,false);show(picker,false);show(form,false);show(retry,false);say(text);}
    // For now: a refused or failed read can be tried again, from where the visitor was.
    function trouble(r,redo){
      if(r===STALE){return;}
      if(r&&r.status===404){fail(t('unavailable'));return;}
      busy(false);
      say(r&&(r.status===503||r.status===429)?t('busy'):t('failed'));
      again=redo;show(retry,true);
    }
    retry.addEventListener('click',function(){show(retry,false);say('');var redo=again;again=null;if(redo){redo();}});
    if(!window.__swb||!id||mount.hasAttribute('data-sw-captcha-missing')){fail(t('unavailable'));return;}

    // The picker's frame: an optional resource choice, then the mode's own view.
    var resSel=null,view=mk('div','view');
    function today(){return ymdOf(Date.now(),tz);}
    // A days listing is fetched once and stops at 400 days, so its calendar does too.
    function lastDay(){return ymdOf(Date.now()+(o.mode==='days'?Math.min(o.maxAdvanceDays,400):o.maxAdvanceDays)*DAY,tz);}
    function list(from,to){
      var mine=++seq;
      var u=api(oid+'/availability')+'?from='+Math.floor(from)+'&to='+Math.ceil(to)+(resource?'&resource='+encodeURIComponent(resource):'');
      return call(u).then(function(r){if(mine!==seq){throw STALE;}return r;},function(e){if(mine!==seq){throw STALE;}throw e;});
    }
    function itemsOf(r){return (r.body.kind==='windows'?r.body.windows:r.body.times)||[];}
    function frame(){
      picker.textContent='';
      if(o.resources&&o.resources.length>1){
        var w=mk('label','field');w.appendChild(mk('span','label',t('resource')));
        resSel=document.createElement('select');resSel.name='resource';
        var any=document.createElement('option');any.value='';any.textContent=t('any');resSel.appendChild(any);
        for(var i=0;i<o.resources.length;i++){var op=document.createElement('option');op.value=String(o.resources[i].id);op.textContent=String(o.resources[i].name);resSel.appendChild(op);}
        resSel.addEventListener('change',function(){resource=resSel.value;reload();});
        w.appendChild(resSel);picker.appendChild(w);
      }
      picker.appendChild(view);
      var vz=visitorZone();
      if(o.mode!=='days'&&vz&&vz!==tz){note.textContent=t('time_zone').split('{zone}').join(zoneName(tz));show(note,true);}
    }
    function navBar(label,canBack,canNext,onBack,onNext){
      var nav=mk('div','nav'),b=mk('button',null,t('earlier')),n=mk('button',null,t('later'));
      b.type='button';n.type='button';b.disabled=!canBack;n.disabled=!canNext;
      b.setAttribute('data-sw-nav','earlier');n.setAttribute('data-sw-nav','later');
      b.addEventListener('click',function(){refocus={nav:'earlier'};onBack();});
      n.addEventListener('click',function(){refocus={nav:'later'};onNext();});
      nav.appendChild(b);nav.appendChild(mk('span','range-label',label));nav.appendChild(n);
      return nav;
    }
    function busy(on){
      view.setAttribute('aria-busy',on?'true':'false');
      if(resSel){resSel.disabled=on;}
      if(on){q('button',view).forEach(function(b){b.disabled=true;});}
    }
    // After a redraw, focus goes back to the control the visitor used, or to its equivalent; the node
    // they clicked was replaced, and focus left on the body sends a keyboard user back to the top.
    function restoreFocus(){
      var f=refocus;refocus=null;if(!f){return;}
      var el=null;
      if(f.nav){el=view.querySelector('[data-sw-nav="'+f.nav+'"]');if(el&&el.disabled){el=null;}}
      if(f.day){el=view.querySelector('[data-sw-date="'+f.day+'"]');}
      if(!el||el.disabled){el=view.querySelector('[aria-pressed="true"]')||view.querySelector('button:not([disabled]),select');}
      if(el){el.focus();}
    }
    function pressable(btn,on){btn.setAttribute('aria-pressed',on?'true':'false');}

    // ---- a week at a time: duration, slots, range ----
    // A listing past 2000 entries is cut short (truncated): every day from the last listed start on is then
    // incomplete, and is fetched on its own when the visitor opens it.
    var day0='',items=[],sel='',cut=Infinity,extra={};
    function setWeek(d,r){day0=d;items=itemsOf(r);cut=r.body.truncated&&items.length?items[items.length-1].start:Infinity;extra={};}
    // ahead > 0: when this week has nothing free, look up to that many weeks further, and come back to
    // origin (empty) when none of them has anything either.
    function loadWeek(d,ahead,origin){
      var from=Math.max(Date.now(),startOf(d,tz)),to=startOf(addDays(d,7),tz);
      busy(true);
      list(from,to).then(function(r){
        if(r.status!==200){trouble(r,function(){loadWeek(d,ahead,origin);});return;}
        setWeek(d,r);
        if(!items.length&&ahead>0&&addDays(d,7)<=lastDay()){loadWeek(addDays(d,7),ahead-1,origin||d);return;}
        if(!items.length&&origin){day0=origin;}
        drawWeek();
      }).catch(function(e){trouble(e,function(){loadWeek(d,ahead,origin);});});
    }
    function loadDay(d,from,to){
      busy(true);
      list(Math.max(Date.now(),from),to).then(function(r){
        if(r.status!==200){trouble(r,function(){loadDay(d,from,to);});return;}
        extra[d]=itemsOf(r);
        refocus={day:d};drawWeek();
      }).catch(function(e){trouble(e,function(){loadDay(d,from,to);});});
    }
    function bounds(){var b=[];for(var i=0;i<=7;i++){b.push(startOf(addDays(day0,i),tz));}return b;}
    // Range: every start on the grid inside a free stretch, with the longest length that fits there. Steps go
    // in real minutes; where the step does not divide an hour, a change of clocks could move them off the
    // grid of the local clock, so those are checked against it.
    function starts(list){
      var out={},step=o.stepMin*MIN,min=o.minMin*MIN,check=60%o.stepMin!==0;
      for(var i=0;i<list.length;i++){
        var w=list[i];
        for(var s=w.start;s+min<=w.end;s+=step){
          if(check){var p=parts(s,tz);if((p.h*60+p.mi)%o.stepMin!==0){continue;}}
          var max=Math.min(o.maxMin,Math.floor((w.end-s)/MIN));
          if(!out[s]||out[s].max<max){out[s]={start:s,max:max};}
        }
      }
      return Object.keys(out).map(function(k){return out[k];}).sort(function(a,b){return a.start-b.start;});
    }
    function drawWeek(){
      view.textContent='';busy(false);
      var b=bounds(),byDay=[[],[],[],[],[],[],[]],partial=[];
      var known=o.mode==='range'?starts(items):items;
      for(var i=0;i<known.length;i++){for(var j=0;j<7;j++){if(known[i].start>=b[j]&&known[i].start<b[j+1]){byDay[j].push(known[i]);break;}}}
      for(var k0=0;k0<7;k0++){
        var dk=addDays(day0,k0);
        partial[k0]=b[k0+1]>cut&&!extra[dk];
        if(extra[dk]){
          var own=o.mode==='range'?starts(extra[dk]):extra[dk];
          byDay[k0]=own.filter(function(x){return x.start>=b[k0]&&x.start<b[k0+1];});
        }
      }
      var label=shortDate(day0)+' – '+shortDate(addDays(day0,6));
      view.appendChild(navBar(label,day0>today(),addDays(day0,7)<=lastDay(),function(){loadWeek(addDays(day0,-7)<today()?today():addDays(day0,-7),0);},function(){loadWeek(addDays(day0,7),0);}));
      var days=mk('div','days'),first=-1,selIdx=-1;
      for(var k=0;k<7;k++){
        var d=addDays(day0,k),btn=mk('button','day');btn.type='button';
        btn.appendChild(mk('small',null,dayName(d)));btn.appendChild(mk('span',null,dayNum(d)));
        btn.setAttribute('aria-label',dateLabel(d));btn.setAttribute('data-sw-date',d);
        var open=byDay[k].length>0||partial[k];
        if(!open){btn.disabled=true;}else if(first<0){first=k;}
        if(d===sel&&open){selIdx=k;}
        (function(day){btn.addEventListener('click',function(){sel=day;refocus={day:day};drawWeek();});})(d);
        days.appendChild(btn);
      }
      if(selIdx<0){selIdx=first;sel=first>=0?addDays(day0,first):'';}
      for(var m=0;m<7;m++){pressable(days.children[m],m===selIdx);}
      view.appendChild(days);
      if(selIdx<0){view.appendChild(mk('p','empty',t('none_here')));restoreFocus();return;}
      if(partial[selIdx]){loadDay(sel,b[selIdx],b[selIdx+1]);return;}
      if(!byDay[selIdx].length){view.appendChild(mk('p','empty',t('no_times')));restoreFocus();return;}
      if(o.mode==='range'){drawRange(byDay[selIdx]);restoreFocus();return;}
      var times=mk('div','times');
      byDay[selIdx].forEach(function(x){
        var tb=mk('button','time',timeLabel(x.start,tz));tb.type='button';
        tb.setAttribute('aria-label',when(x.start,x.end,tz,o.mode));
        tb.addEventListener('click',function(){choose({start:x.start,end:x.end,places:x.places,resources:x.resources});});
        times.appendChild(tb);
      });
      view.appendChild(times);
      restoreFocus();
    }
    function drawRange(opts){
      var wrap=mk('div','choices'),sw=mk('label','field'),lw=mk('label','field');
      var ss=document.createElement('select'),ls=document.createElement('select');ss.name='start';ls.name='length';
      sw.appendChild(mk('span','label',t('start')));sw.appendChild(ss);lw.appendChild(mk('span','label',t('length')));lw.appendChild(ls);
      opts.forEach(function(x,i){var op=document.createElement('option');op.value=String(i);op.textContent=timeLabel(x.start,tz);ss.appendChild(op);});
      function lengths(){
        ls.textContent='';var x=opts[+ss.value];
        // The whole stretch, so the option reads as a length and not as a second start time.
        for(var m=o.minMin;m<=x.max;m+=o.stepMin){var op=document.createElement('option');op.value=String(m);op.textContent=timeLabel(x.start,tz)+' – '+timeLabel(x.start+m*MIN,tz)+' ('+length(m)+')';ls.appendChild(op);}
      }
      ss.addEventListener('change',lengths);lengths();
      wrap.appendChild(sw);wrap.appendChild(lw);view.appendChild(wrap);
      var go=mk('button','continue',t('continue'));go.type='button';go.className='btn btn-primary';
      go.addEventListener('click',function(){var x=opts[+ss.value];choose({start:x.start,end:x.start+(+ls.value)*MIN});});
      view.appendChild(go);
    }

    // ---- days: one calendar month at a time, the whole horizon fetched once ----
    var free={},month='',checkIn='',units=0;
    function loadDays(){
      busy(true);
      var from=Date.now(),to=from+Math.min(o.maxAdvanceDays,400)*DAY;
      list(from,to).then(function(r){
        if(r.status!==200){trouble(r,loadDays);return;}
        free={};(r.body.days||[]).forEach(function(x){free[x.date]=x.resources||true;});
        if(!month){var firstFree=Object.keys(free).sort()[0];month=(firstFree||today()).slice(0,8)+'01';}
        checkIn='';units=0;drawMonth();
      }).catch(function(e){trouble(e,loadDays);});
    }
    // How many units in a row are free from d, on one resource where the listing names them.
    function run(d){
      var n=0,common=null,cur=d;
      while(n<o.maxUnits){
        var r=free[cur];if(!r){break;}
        if(r!==true){common=common===null?r.slice():common.filter(function(x){return r.indexOf(x)>=0;});if(!common.length){break;}}
        n++;cur=addDays(cur,1);
      }
      return n;
    }
    function endOf(n){return o.unit==='night'?addDays(checkIn,n):addDays(checkIn,n-1);}
    function drawMonth(){
      view.textContent='';busy(false);
      var nextMonth=addDays(month,32).slice(0,8)+'01';
      var lead=(new Date(utcOf(month)).getUTCDay()+6)%7,len=Math.round((utcOf(nextMonth)-utcOf(month))/DAY);
      view.appendChild(navBar(monthLabel(month),month>today().slice(0,8)+'01',nextMonth<=lastDay(),function(){month=addDays(month,-1).slice(0,8)+'01';drawMonth();},function(){month=nextMonth;drawMonth();}));
      var grid=mk('div','days');
      for(var w=0;w<7;w++){grid.appendChild(mk('span','weekday',dayName(addDays('2024-01-01',w))));}
      for(var f=0;f<lead;f++){grid.appendChild(mk('span','filler'));}
      var maxRun=checkIn?run(checkIn):0;
      for(var i=0;i<len;i++){
        var d=addDays(month,i),btn=mk('button','day',dayNum(d));btn.type='button';btn.setAttribute('aria-label',dateLabel(d));btn.setAttribute('data-sw-date',d);
        var asEnd=0;
        if(checkIn&&!units){for(var n=o.minUnits;n<=maxRun;n++){if(endOf(n)===d){asEnd=n;}}}
        var canStart=run(d)>=o.minUnits;
        btn.disabled=!(canStart||asEnd);
        pressable(btn,d===checkIn||!!(units&&d===endOf(units)));
        if(checkIn&&units&&d>checkIn&&d<endOf(units)){btn.setAttribute('data-sw-in-range','');}
        (function(day,n){btn.addEventListener('click',function(){
          // A start with a single possible length needs no second click.
          if(n){units=n;}else{checkIn=day;units=Math.min(run(day),o.maxUnits)===o.minUnits?o.minUnits:0;}
          refocus={day:day};drawMonth();
        });})(d,asEnd);
        grid.appendChild(btn);
      }
      view.appendChild(grid);
      if(checkIn&&!units){view.appendChild(mk('p','hint',t('pick_check_out')));restoreFocus();return;}
      if(checkIn&&units){
        var unitLabel=o.unit==='night'?t('nights'):t('days');
        var line=(o.unit==='night'?t('check_in')+' '+dateLabel(checkIn)+', '+clockLabel(o.checkIn)+' · '+t('check_out')+' '+dateLabel(endOf(units))+', '+clockLabel(o.checkOut):dateLabel(checkIn)+(units>1?' – '+dateLabel(endOf(units)):''))+' · '+unitLabel+': '+units;
        view.appendChild(mk('p','summary',line));
        var go=mk('button','continue',t('continue'));go.type='button';go.className='btn btn-primary';
        go.addEventListener('click',function(){choose({date:checkIn,units:units,text:line});});
        view.appendChild(go);
      }
      restoreFocus();
    }

    function reload(){say('');show(retry,false);if(o.mode==='days'){loadDays();}else{loadWeek(day0||today(),0);}}

    // ---- the visitor's details ----
    var summary=mk('p','summary'),fields={};
    function field(name,type,required,auto,max){
      var w=mk('label','field'),label=t(name)+(required?'':' ('+t('optional')+')');
      w.appendChild(mk('span','label',label));
      var i=document.createElement(type==='textarea'?'textarea':'input');
      if(type!=='textarea'){i.type=type;}
      i.name=name;i.maxLength=max;if(required){i.required=true;}if(auto){i.setAttribute('autocomplete',auto);}
      w.appendChild(i);fields[name]=i;return w;
    }
    var grid=mk('div','choices');
    grid.appendChild(field('name','text',true,'name',200));
    grid.appendChild(field('email','email',true,'email',320));
    grid.appendChild(field('phone','tel',false,'tel',40));
    var qtyWrap=mk('label','field'),qty=document.createElement('input');
    // The default too, so form.reset() after a booking puts 1 back rather than an empty field.
    qty.type='number';qty.name='quantity';qty.min='1';qty.step='1';qty.value='1';qty.defaultValue='1';
    qtyWrap.appendChild(mk('span','label',t('quantity')));qtyWrap.appendChild(qty);grid.appendChild(qtyWrap);
    form.appendChild(summary);form.appendChild(grid);form.appendChild(field('note','textarea',false,'',2000));
    var hp=mk('div','hp'),hpIn=document.createElement('input');
    hpIn.type='text';hpIn.name='_hpt';hpIn.tabIndex=-1;hpIn.setAttribute('autocomplete','off');hp.setAttribute('aria-hidden','true');hp.appendChild(hpIn);form.appendChild(hp);
    var capP=preview?'':mount.getAttribute('data-sw-captcha')||'',capBox=mk('div','captcha'),cap=null;
    if(capP){cap=Captcha(capP,mount.getAttribute('data-captcha-sitekey')||'',capBox);if(capP!=='recaptcha-v3'){form.appendChild(capBox);}}
    var actions=mk('div','actions'),back=mk('button','back',t('back')),submit=mk('button','submit');
    back.type='button';back.className='btn';submit.type='submit';submit.className='btn btn-primary';
    actions.appendChild(back);actions.appendChild(submit);
    // A paid offering: the total before the visitor goes to pay (the server's price; the provider charges it).
    var total=mk('p','total','');show(total,false);form.appendChild(total);form.appendChild(actions);
    // Minor units by the platform's own decimals for the currency (the provider charges by them), not the browser's.
    function money(pr,n){var v=pr.amountMinor*n/Math.pow(10,pr.digits);try{return new Intl.NumberFormat(document.documentElement.lang||undefined,{style:'currency',currency:pr.currency,minimumFractionDigits:pr.digits,maximumFractionDigits:pr.digits}).format(v);}catch(e){return v.toFixed(pr.digits)+' '+pr.currency;}}
    function showTotal(){
      var pr=o.price;if(!pr||!choice){show(total,false);return;}
      var n=pr.per==='unit'?Math.max(1,Math.floor(+qty.value)||1):pr.per==='night'?Math.max(1,choice.units||1):1;
      total.textContent=t('total')+': '+money(pr,n);show(total,true);
    }
    qty.addEventListener('input',showTotal);
    back.addEventListener('click',function(){show(form,false);show(picker,true);say('');refocus={};restoreFocus();});

    function choose(c){
      choice=c;say('');
      summary.textContent=c.text||when(c.start,c.end,tz,o.mode);
      var maxQ=Math.max(1,Math.min(o.maxQuantity,c.places||o.maxQuantity));
      show(qtyWrap,o.maxQuantity>1);qty.max=String(maxQ);if(+qty.value>maxQ){qty.value=String(maxQ);}
      // A paid request is sent as a request (it is paid once accepted); its total shows all the same.
      submit.textContent=o.confirmation==='request'?t('submit_request'):o.price?t('submit_pay'):t('submit');
      showTotal();
      show(picker,false);show(form,true);
      if(cap){cap.mount();}
      fields.name.focus();
    }
    function payload(){
      var p=evid();p._hpt=hpIn.value;
      ['name','email','phone','note'].forEach(function(k){p[k]=fields[k].value;});
      if(choice.date){p.date=choice.date;p.units=String(choice.units);}
      else{p.start=String(choice.start);if(o.mode==='range'){p.end=String(choice.end);}}
      if(o.maxQuantity>1){p.quantity=String(Math.floor(+qty.value)||1);}
      if(resource){p.resource=resource;}
      // The page's language, so the customer's emails come in it (the server keeps it only if the site has it).
      if(LOC){p.lang=String(LOC);}
      return p;
    }
    // The captcha first, then the proof of work, then the booking. On a stale proof of work the same captcha
    // answer is sent again: the server checks the proof of work BEFORE the captcha, so it was not spent.
    function attempt(retried){
      var p=payload();
      return (cap?cap.token():Promise.resolve('')).then(function(tk){
        if(tk){p[cap.field]=tk;}
      },function(){throw new Error('captcha');}).then(function(){
        return mount.hasAttribute('data-sw-pow')?solve(api(oid+'/challenge')):'';
      }).then(function(sol){
        if(sol){p._pow=sol;}
        return post(api(oid,1),p);
      }).then(function(r){
        if(r.status===400&&r.body.error==='challenge-failed'&&!retried){return attempt(true);}
        return r;
      });
    }
    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(sending||!choice){return;}
      sending=true;submit.disabled=true;back.disabled=true;var label=submit.textContent;submit.textContent=t('sending');say('');
      q('[aria-invalid]',form).forEach(function(x){x.removeAttribute('aria-invalid');});
      function end(){sending=false;submit.disabled=false;back.disabled=false;submit.textContent=label;}
      attempt(false).then(function(r){end();result(r);}).catch(function(err){end();say(err&&err.message==='captcha'?t('captcha'):t('failed'));});
    });
    function result(r){
      var b=r.body||{},code=b.error||'';
      if(r.status===200&&b.ok){success(b);return;}
      if(code==='taken'||code==='not-offered'||code==='too-soon'||code==='too-far'||code==='unknown-resource'){show(form,false);show(picker,true);reload();say(t('taken'));return;}
      if(code==='invalid-fields'){(b.fields||[]).forEach(function(n){if(fields[n]){fields[n].setAttribute('aria-invalid','true');}});say(t('check_details'));return;}
      if(code==='invalid'){say(t('check_details'));return;}
      if(code==='captcha-failed'){if(cap){cap.reset();}say(t('captcha'));return;}
      if(code==='busy'||code==='full'||r.status===429){say(t('busy'));return;}
      if(code==='not-found'||code==='captcha-unavailable'){fail(t('unavailable'));return;}
      say(t('failed'));
    }
    function success(b){
      // A paid booking: on to the provider's page to pay, the time held meanwhile. A TOP-LEVEL navigation (a popup
      // after an await is blocked), and only to https: the server checked, but this is the last place to refuse.
      if(b.pay){
        if(!/^https:\\/\\//i.test(String(b.pay))){say(t('failed'));return;}
        show(form,false);show(picker,false);done.textContent='';
        var go=mk('p','done-message',t('to_payment'));go.tabIndex=-1;done.appendChild(go);show(done,true);go.focus();
        window.location.assign(String(b.pay));return;
      }
      show(form,false);show(picker,false);done.textContent='';
      var head=mk('p','done-message',b.preview?t('preview'):b.state==='pending'?t('requested'):t('booked'));
      head.tabIndex=-1;done.appendChild(head);
      done.appendChild(mk('p','summary',b.start?when(b.start,b.end,tz,o.mode,o.unit):summary.textContent));
      var path=mount.getAttribute('data-status-path');
      // In the FRAGMENT: it never reaches a server, a Referer header or a page-view beacon, as a query would.
      if(path&&b.reference){var a=mk('a','manage',t('manage'));a.href=path+'#t='+encodeURIComponent(b.reference);done.appendChild(a);}
      var another=mk('button','another',t('another'));another.type='button';another.className='btn';
      another.addEventListener('click',function(){show(done,false);show(picker,true);form.reset();choice=null;refocus={};reload();});
      var row=mk('div','actions');row.appendChild(another);done.appendChild(row);
      show(done,true);head.focus();
      if(cap){cap.reset();}
    }

    // ---- start: the first listing names the offering, so its clock and mode are known from then on ----
    function start(){
      var now=Date.now();
      // Eight days: the first page ends at next week's midnight on the business's clock, which a change of
      // clocks can put up to an hour past seven days from now.
      list(now,now+8*DAY).then(function(r){
        if(r.status!==200||!r.body.offering){trouble(r,start);return;}
        o=r.body.offering;tz=o.timeZone||'UTC';
        show(loading,false);frame();
        if(o.mode==='days'){loadDays();return;}
        var d=today();
        setWeek(d,r);
        var end=startOf(addDays(d,7),tz);items=items.filter(function(x){return x.start<end;});
        if(cut>=end){cut=Infinity;}
        if(!items.length&&cut===Infinity&&addDays(d,7)<=lastDay()){loadWeek(addDays(d,7),5,d);return;}
        drawWeek();
      // Anything that failed here, a network error or an answer that could not be drawn, starts over.
      }).catch(function(e){show(loading,false);trouble(e,start);});
    }
    // Only once it is near the screen: a widget far down a long page asks nothing of the server until then.
    if(window.IntersectionObserver){
      var io=new IntersectionObserver(function(es){for(var i=0;i<es.length;i++){if(es[i].isIntersecting){io.disconnect();start();return;}}},{rootMargin:'300px'});
      io.observe(mount);
    }else{start();}
  }

  // ---- a booking's own page: its state, and cancelling it ----------------------------------------
  function Status(mount){
    var L=labelsOf(mount);
    function t(k){var v=L['booking.'+k];return typeof v==='string'?v:'';}
    function p(name){return part(mount,name);}
    var message=p('message');
    function say(text){if(message){message.textContent=text||'';}}
    function state(s){
      show(p('status-loading'),false);
      ['booked','pending','payment','cancelled','unknown'].forEach(function(x){show(p('status-'+x),x===s);});
    }
    // The reference rides in the fragment (#t=), which no server or analytics beacon sees; ?t= is read too.
    var token='';
    try{var u=new URL(window.location.href);token=new URLSearchParams(u.hash.slice(1)).get('t')||u.searchParams.get('t')||'';}catch(e){}
    if(!window.__swb||!token){state('unknown');return;}
    var url=api('_booking/'+encodeURIComponent(token));
    call(url).then(function(r){
      if(r.status===404){state('unknown');return;}
      if(r.status!==200){show(p('status-loading'),false);say(r.status===429||r.status===503?t('busy'):t('failed'));return;}
      var b=r.body,of=b.offering||{};
      // Only a booked booking reads as booked: a time held while it is paid waits for its payment, a request for its answer.
      state(b.state==='booked'?'booked':b.state==='hold'&&p('status-payment')?'payment':'pending');
      var d=p('details');
      if(d){
        var name=d.querySelector('[data-sw-field="offering"]'),wh=d.querySelector('[data-sw-field="when"]');
        if(name){name.textContent=of.name||'';}
        if(wh&&b.start){wh.textContent=when(b.start,b.end,of.timeZone||'UTC',of.mode,of.unit);}
        show(d,true);
      }
      // An accepted paid request: its deadline, and on to the provider to pay (the time stays held until then).
      var pay=p('pay');
      if(b.payable&&pay){
        var by=p('pay-by');
        if(by&&b.payBy){var ptz=of.timeZone||'UTC';by.textContent=t('pay_by')+': '+dateLabel(ymdOf(b.payBy,ptz))+', '+timeLabel(b.payBy,ptz);show(by,true);}
        show(pay,true);
        pay.addEventListener('click',function(){
          if(isPreview()){say(t('preview'));return;}
          pay.disabled=true;say('');
          post(url+'/pay',LOC?{lang:String(LOC)}:{}).then(function(r){
            var to=r.body&&r.body.pay;
            // Only to https: the server checked, but this is the last place to refuse.
            if(r.status===200&&to&&/^https:\\/\\//i.test(String(to))){say(t('to_payment'));window.location.assign(String(to));return;}
            pay.disabled=false;
            if(r.status===404){show(pay,false);state('unknown');return;}
            say(r.status===503||r.status===429?t('busy'):t('failed'));
          },function(){pay.disabled=false;say(t('failed'));});
        });
      }
      var cancel=p('cancel'),confirm=p('cancel-confirm'),yes=p('cancel-yes'),no=p('cancel-no');
      if(!cancel||!b.cancellable){return;}
      // A paid booking: what cancelling now does with the money, said BEFORE the yes. An authored confirmation
      // without its place for it gets one: a customer must never lose a payment unwarned.
      if(b.refund){
        var said=t(b.refund==='full'?'cancel_refund':'cancel_no_refund'),money=p('cancel-refund');
        if(!money&&confirm){money=mk('p','cancel-refund');confirm.insertBefore(money,yes&&yes.parentNode===confirm?yes:null);}
        // No confirmation step at all: said beside the button, before it is pressed.
        if(money){money.textContent=said;show(money,true);}else{say(said);}
      }
      show(cancel,true);
      cancel.addEventListener('click',function(){if(confirm&&yes){show(cancel,false);show(confirm,true);yes.focus();}else{go();}});
      if(no){no.addEventListener('click',function(){show(confirm,false);show(cancel,true);cancel.focus();});}
      if(yes){yes.addEventListener('click',go);}
      function go(){
        // Never from the editor's preview: it would cancel a real booking.
        if(isPreview()){say(t('preview'));return;}
        if(yes){yes.disabled=true;}
        cancel.disabled=true;
        post(url+'/cancel',{}).then(function(c){
          if(yes){yes.disabled=false;}
          cancel.disabled=false;
          if(c.status===200){show(confirm,false);show(cancel,false);show(d,false);state('cancelled');return;}
          if(c.status===404){show(confirm,false);show(cancel,false);state('unknown');return;}
          if(c.body&&c.body.error==='started'){show(confirm,false);show(cancel,false);say(t('started'));return;}
          say(c.status===503||c.status===429?t('busy'):t('failed'));
        },function(){if(yes){yes.disabled=false;}cancel.disabled=false;say(t('failed'));});
      }
    },function(){show(p('status-loading'),false);say(t('failed'));});
  }

  function init(){
    q('[data-sw-booking]').forEach(function(m){if(m.getAttribute('data-sw-enhanced')){return;}m.setAttribute('data-sw-enhanced','true');Widget(m);});
    q('[data-sw-booking-status]').forEach(function(m){if(m.getAttribute('data-sw-enhanced')){return;}m.setAttribute('data-sw-enhanced','true');Status(m);});
  }
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;
