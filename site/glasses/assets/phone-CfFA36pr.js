const i=r=>String(r).replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),E=r=>`${r.slice(0,6)}…${r.slice(-4)}`,T=r=>Number(r??0),q=r=>new Date(r).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",hour12:!1}),b=matchMedia("(prefers-reduced-motion: reduce)").matches;function H(r,a){const h=Number(r.dataset.v??a);if(r.dataset.v=String(a),h===a||b){r.textContent=G(a);return}const t=performance.now(),d=s=>{const o=Math.min(1,(s-t)/900),g=1-Math.pow(1-o,3);r.textContent=G(h+(a-h)*g),o<1&&requestAnimationFrame(d)};requestAnimationFrame(d)}const G=r=>(Math.round(r*1e3)/1e3).toString();function N(r){const a=document.createElement("div");a.className="toast",a.setAttribute("role","status"),a.textContent=r,document.body.append(a),setTimeout(()=>a.remove(),2300)}function B(r){const a=document.getElementById("app");let h="",t=null,d=null,s=!1,o=null;const g=async(m,e)=>{try{await m(),e&&N(e)}catch(n){N(n.message)}};function c(){const e=r.getVault()?s?"words":"main":"intro";e!==h&&(h=e,o?.stop(),o=null,f()),h==="main"&&v()}function f(){const m=r.getVault();if(h==="intro"){a.innerHTML=`
        <div class="intro">
          <h1 class="mark">REINS</h1>
          <p class="lead">Your agents spend. You hold the reins.</p>
          <ol>
            <li><b>Create a vault.</b> Its key stays on this phone.</li>
            <li><b>Top it up</b> from any TON wallet.</li>
            <li><b>Connect an agent.</b> It gets a small wallet and asks your glasses for anything more.</li>
          </ol>
          <div><button class="go" id="create">Create my vault</button></div>
          <details style="margin-top:22px"><summary>I already have one</summary>
            <textarea id="words" rows="4" placeholder="Your 24 words, separated by spaces"></textarea>
            <p style="margin-top:10px"><button id="import">Restore vault</button></p>
          </details>
          <p class="err" id="err"></p>
        </div>`,a.querySelector("#create").addEventListener("click",async()=>{await r.create(),s=!0,c()}),a.querySelector("#import").addEventListener("click",async()=>{try{await r.import(a.querySelector("#words").value),c()}catch(e){a.querySelector("#err").textContent=e.message}});return}if(h==="words"){a.innerHTML=`
        <div class="intro">
          <h2>Write these 24 words down</h2>
          <p class="dim" style="margin-top:8px">They are the only way back into your vault if you lose this phone. Nobody else has them, including us.</p>
          <div class="words">${m.words.map(e=>`<span>${i(e)}</span>`).join("")}</div>
          <div><button class="go" id="done">I wrote them down</button></div>
        </div>`,a.querySelector("#done").addEventListener("click",()=>{s=!1,c()});return}a.innerHTML=`
      <header class="top">
        <h1 class="mark"><svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true"><circle cx="9" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="8.5" r="1.9" fill="currentColor"/><path d="M11.3 13.4 C12.3 21 15 22 22 19.5" fill="none" stroke="#c8925a" stroke-width="2" stroke-linecap="round"/><circle cx="22" cy="19.5" r="1.8" fill="#c8925a"/></svg>REINS</h1>
        <a class="pill" href="#vault"><b class="num" id="vbal">…</b> GRAM</a>
      </header>
      <div class="stage" id="stage"><span class="vaultlabel">your vault</span><svg aria-hidden="true"></svg></div>
      <div class="now" id="now" aria-live="polite"></div>
      <section class="card" id="agent" hidden></section>
      <section class="card" id="connect"></section>
      <section class="card" id="payees"></section>
      <section class="card" id="telegram"></section>
      <section class="card" id="activity"></section>
      <section class="card" id="vault"></section>`,o=new z(a.querySelector("#stage"),e=>{t=e,v()}),a.addEventListener("click",O)}function v(){const m=r.getVault(),e=r.getState(),n=l=>a.querySelector(l);if(!e){n("#now").textContent=`Looking for your Reins server at ${r.getServer()}…`;return}H(n("#vbal"),Number(e.vaultBalance));const y=e.agents.filter(l=>l.status==="active"||l.status==="frozen");(!t||!e.agents.some(l=>l.id===t))&&(t=y[0]?.id??null),o.render(e,t);const u=n("#now");if(u.className="now"+(e.alarm?" alarm":e.pending?" waiting":""),e.alarm)u.innerHTML=`${i(e.alarm.agent)} moved ${i(e.alarm.amount??"money")} GRAM you never approved. Kill it from your glasses.`;else if(e.pending){const l=e.pending,w=l.kind==="create"?"wants a wallet":`asks ${i(l.amount)} GRAM for ${i(l.toName??E(l.to))}`;u.innerHTML=`<span class="lensdot"></span><span>${i(l.agent)} ${w}. Answer on your glasses.${e.pendingCount>1?` ${e.pendingCount-1} more after that.`:""}</span>`}else y.length?u.textContent=`Nothing is waiting for you. ${e.spentToday} GRAM spent today.`:u.textContent="No agents yet. Connect one below and it will appear here.";R(n("#agent"),e.agents.find(l=>l.id===t)),x(n("#connect"),e),d||M(n("#payees"),e.payees??[]),k(n("#telegram"),e),I(n("#activity"),e.events??[]),P(n("#vault"),m,e)}const p=(m,e)=>{m.dataset.html!==e&&(m.dataset.html=e,m.innerHTML=e)};function R(m,e){if(m.hidden=!e,!e)return;const n=e.status==="revoked",y=e.status==="frozen",u=Math.min(100,T(e.spentToday)/Math.max(T(e.daily),1e-9)*100);p(m,`
      <div class="agent-head"><h2>${i(e.name)}</h2><span class="dim">${n?"killed today":y?"paused":`${i(e.balance)} GRAM in its wallet`}</span></div>
      ${n?"<p>Its key was revoked on chain and what it held came back to your vault.</p>":`
      <div class="meter" role="img" aria-label="${i(e.spentToday)} of ${i(e.daily)} GRAM spent today"><i style="width:${u}%"></i></div>
      <p><span class="num">${i(e.spentToday)}</span> of <span class="num">${i(e.daily)}</span> GRAM spent today${e.last?`. Last: ${i(e.last.amount)} to ${i(e.last.to)} at ${q(e.last.at)}.`:"."}</p>
      <div class="budget" aria-label="Daily budget">
        <button data-budget="-0.5" aria-label="Lower daily budget">−</button>
        <span class="val num">${i(e.daily)}</span>
        <button data-budget="0.5" aria-label="Raise daily budget">+</button>
        <span class="dim">GRAM a day it may spend on payees you trust, without asking.</span>
      </div>
      <div class="actions">
        <button data-pause="${y?"off":"on"}">${y?"Resume":"Pause"} ${i(e.name)}</button>
      </div>
      <p class="dim" style="margin-top:14px">To kill it, open Reins on your glasses. Killing revokes its key on chain.</p>`}`)}function x(m,e){const n=r.getServer();p(m,`
      <h2>Connect an agent</h2>
      <p>Give an agent this code once. It gets its own small wallet the moment you approve it on your glasses, and nothing more.</p>
      <div class="code" id="linkcode" aria-label="${i(e.link??"")}">${[...e.link??"…"].map((y,u)=>`<span style="--i:${u}">${i(y)}</span>`).join("")}</div>
      <button data-copy="${i(e.link??"")}">Copy code</button>
      <button class="quiet" data-newlink>Make a new code</button>
      <details style="margin-top:14px"><summary>Setup for Claude Code, Hermes, Codex</summary>
        <pre>claude mcp add reins \\
  -e REINS_LINK=${i(e.link??"")} \\
  -e REINS_SERVER=${i(n)} \\
  -- npx tsx reins/kit/src/mcp.ts</pre>
        <p class="dim" style="margin-top:8px">Other agents: see docs/AGENTS.md in the Reins repo.</p>
      </details>`)}function M(m,e){p(m,`
      <h2>Payees</h2>
      ${e.length?"":'<p>When you approve a payment with "always trust" on your glasses, the payee shows up here.</p>'}
      ${e.map(n=>`
        <div class="row">
          <div class="grow">
            ${d===n.address?`<input data-rename-input="${i(n.address)}" value="${i(n.name)}" aria-label="Payee name">`:`<button class="pname" data-rename="${i(n.address)}">${i(n.name)}</button>`}
            <div class="addr">${i(E(n.address))}</div>
            <div class="dim" style="font-size:14px">${n.trusted?`Paid without asking, up to ${i(n.autoLimit)} GRAM`:"Always asks you first"}</div>
          </div>
          <button class="switch" role="switch" aria-checked="${n.trusted}" aria-label="Trust ${i(n.name)}" data-trust="${i(n.address)}"></button>
        </div>`).join("")}`)}function k(m,e){const n=e.telegramBot;p(m,`
      <h2>Telegram</h2>
      ${e.telegram==="linked"?"<p>Linked. Warnings reach you there, and you can reject a request or pause an agent from the chat. Money only moves from your glasses.</p>":e.telegram&&n?`<p>Get warnings in Telegram, with Reject and Pause buttons.</p><p style="margin-top:14px"><a class="btn go" href="https://t.me/${i(n)}?start=${i(e.telegram)}">Link Telegram</a></p>
             <p class="dim" style="margin-top:10px">Or send <b>/pair ${i(e.telegram)}</b> to @${i(n)}.</p>`:'<p class="dim">This server has no Telegram bot set up.</p>'}`)}function I(m,e){p(m,`
      <h2>Today</h2>
      ${e.length?`<ul class="log">${e.slice(0,14).map(n=>`<li class="${n.level}"><time>${q(n.t)}</time><span>${i(n.text)}</span></li>`).join("")}</ul>`:'<p class="dim">Nothing has happened yet.</p>'}`)}function P(m,e,n){const y=u=>`ton://transfer/${e.address}?amount=${u*1e9}&text=Reins%20vault`;p(m,`
      <h2>Your vault</h2>
      <p><span class="num" style="font-size:40px">${i(n.vaultBalance)}</span> GRAM, and <span class="num">${i(n.atRisk)}</span> out in agent wallets.</p>
      <p class="actions"><a class="btn go" href="${y(1)}">Add 1 GRAM</a><a class="btn" href="${y(5)}">Add 5</a><button data-copy="${i(e.address)}">Copy address</button></p>
      <p class="addr" style="margin-top:10px;word-break:break-all">${i(e.address)}</p>
      <p class="dim" style="margin-top:10px">Opens Gram Wallet or any TON wallet. On testnet, free GRAM comes from @testgiver_ton_bot.</p>
      <details style="margin-top:16px"><summary>Backup words and server</summary>
        <p style="margin:10px 0"><button data-words>Show backup words</button></p>
        <label class="dim">Reins server <input id="server" value="${i(r.getServer())}"></label>
        <p style="margin-top:10px"><button data-server>Use this server</button></p>
      </details>`)}async function O(m){const e=m.target.closest("button, a");if(!e)return;const n=r.getState(),y=n?.agents.find(l=>l.id===t),u=e.dataset;if(u.copy!==void 0)await navigator.clipboard?.writeText(u.copy).catch(()=>{}),N("Copied");else if(u.newlink!==void 0)await g(()=>r.api("POST","/lens/link"),"New code made. The old one no longer works.");else if(u.budget&&y){const l=Math.max(.5,+(T(y.daily)+Number(u.budget)).toFixed(3));y.daily=String(l),v(),await g(()=>r.api("POST","/lens/budget",{agentId:y.id,daily:String(l)}))}else if(u.pause&&y)await g(()=>r.api("POST","/lens/pause",{agentId:y.id,on:u.pause==="on"}),u.pause==="on"?`${y.name} paused`:`${y.name} resumed`);else if(u.trust){const l=n?.payees?.find(w=>w.address===u.trust);if(!l)return;l.trusted=!l.trusted,v(),await g(()=>r.api("POST","/lens/payee",{address:l.address,trusted:l.trusted}))}else if(u.rename){d=u.rename,M(a.querySelector("#payees"),n?.payees??[]);const l=a.querySelector("[data-rename-input]");l.focus(),l.select();const w=async A=>{const C=d;d=null,A&&C&&l.value.trim()&&await g(()=>r.api("POST","/lens/payee",{address:C,name:l.value.trim()}),"Renamed"),v()};l.addEventListener("keydown",A=>{A.key==="Enter"&&w(!0),A.key==="Escape"&&w(!1)}),l.addEventListener("blur",()=>void w(!0),{once:!0})}else if(u.words!==void 0)s=!0,c();else if(u.server!==void 0)await g(()=>r.setServer(a.querySelector("#server").value),"Server saved");else return;h==="main"&&v()}c(),setInterval(c,1500)}const L="http://www.w3.org/2000/svg",$=44,S=222;class z{constructor(a,h){this.el=a,this.onSelect=h,this.svg=a.querySelector("svg");const t=document.createElementNS(L,"g");t.innerHTML='<circle class="handle" r="15"></circle><circle class="handle-core" r="5"></circle>',this.svg.append(t);const d=()=>{this.width=a.clientWidth||360,t.setAttribute("transform",`translate(${this.width/2} ${$})`)};d(),addEventListener("resize",d);const s=o=>{this.step(o),this.raf=requestAnimationFrame(s)};this.raf=requestAnimationFrame(s)}svg;reins=new Map;pulses=[];snaps=[];raf=0;first=!0;width=360;stop(){cancelAnimationFrame(this.raf)}render(a,h){for(const s of a.agents){const o=this.reins.get(s.id);s.status==="revoked"&&o&&o.state!=="killed"&&(this.snap(o),o.state="killed",o.path.remove(),o.node.style.transition="opacity .25s",o.node.style.opacity="0",setTimeout(()=>o.node.remove(),300),this.reins.delete(s.id))}const t=a.agents.filter(s=>s.status==="active"||s.status==="frozen"),d=t.length;t.forEach((s,o)=>{const g=this.width*((o+1)/(d+1)),c=s.status==="revoked"?"killed":a.alarm?.agentId===s.id?"alarm":s.status==="frozen"?"paused":"live",f=Math.min(1,T(s.spentToday)/Math.max(T(s.daily),1e-9)),v=c==="paused"?120:8+(1-f)*74;let p=this.reins.get(s.id);if(!p){const M=document.createElementNS(L,"path");this.svg.insertBefore(M,this.svg.firstChild);const k=document.createElement("button");k.className="node",k.addEventListener("click",()=>this.onSelect(s.id)),this.el.append(k),p={id:s.id,path:M,node:k,x:g,tx:g,sag:this.first?v:140,target:v,state:c,drawn:b||c==="killed"?1:0,lastAt:s.last?.at??0},this.reins.set(s.id,p)}p.state!=="killed"&&c==="killed"&&this.snap(p),s.last&&s.last.at>p.lastAt&&(p.lastAt=s.last.at,c!=="killed"&&this.pulses.push({id:s.id,t0:performance.now()})),p.state=c,p.tx=g,p.target=v,p.path.setAttribute("class",`rein ${c==="killed"?"ghost":c}`),p.path.style.display=c==="killed"?"none":"",p.node.className=`node ${c==="killed"?"killed":c}${s.id===h?" sel":""}`,p.node.style.top=`${S+8}px`;const R=c==="killed"?"killed":c==="paused"?"paused":`${s.spentToday} of ${s.daily}`,x=`<span class="name">${i(s.name)}</span><span class="use">${i(R)}</span>${s.waiting?'<span class="wait">on your glasses</span>':""}`;p.node.dataset.html!==x&&(p.node.dataset.html=x,p.node.innerHTML=x),p.node.setAttribute("aria-pressed",String(s.id===h))});for(const[s,o]of this.reins)t.some(g=>g.id===s)||(o.path.remove(),o.node.remove(),this.reins.delete(s));this.el.classList.toggle("empty",!t.length),this.el.classList.toggle("waiting",!!a.pendingCount),this.el.classList.toggle("alarm",!!a.alarm),this.first=!1}d(a,h,t=0){const d=this.width/2,s=(d+a)/2+t,o=($+S)/2+h;return`M ${d} ${$+15} Q ${s} ${o} ${a} ${S}`}step(a){let h=0;for(const t of this.reins.values()){if(t.state==="killed")continue;t.sag+=(t.target-t.sag)*(b?1:.06),t.x+=(t.tx-t.x)*(b?1:.05),t.node.style.left=`${t.x}px`;const d=t.state==="alarm"&&!b?Math.sin(a/38)*5:0;if(t.path.setAttribute("d",this.d(t.x,t.sag,d)),t.drawn<1){t.drawn=Math.min(1,t.drawn+.022);const s=t.path.getTotalLength(),o=1-Math.pow(1-Math.max(0,t.drawn-h*.08),3);t.path.style.strokeDasharray=`${s}`,t.path.style.strokeDashoffset=`${s*(1-o)}`,t.node.style.opacity=String(Math.max(0,o*1.4-.4)),t.drawn>=1&&(t.path.style.strokeDasharray="",t.path.style.strokeDashoffset="")}h++}this.pulses=this.pulses.filter(t=>{const d=this.reins.get(t.id);if(!d||d.state==="killed")return!1;let s=this.svg.querySelector(`[data-pulse="${t.t0}"]`);s||(s=document.createElementNS(L,"circle"),s.setAttribute("r","6"),s.setAttribute("class","pulse"),s.dataset.pulse=String(t.t0),this.svg.append(s));const o=(a-t.t0)/1100;if(o>=1||b)return s.remove(),!1;const g=d.path.getTotalLength(),c=d.path.getPointAtLength(g*(o*o*(3-2*o)));return s.setAttribute("cx",String(c.x)),s.setAttribute("cy",String(c.y)),!0}),this.snaps=this.snaps.filter(t=>{const d=(a-t.t0)/1e3;if(d>=1||b)return t.lower.remove(),t.upper.remove(),!1;const s=this.width/2,o=(s+t.x)/2,g=($+S)/2+t.sag/2,c=1-Math.pow(d,.6);t.upper.setAttribute("d",`M ${s} ${$+15} L ${s+(o-s)*c} ${$+15+(g-$-15)*c}`);const f=420*d*d;return t.lower.setAttribute("d",`M ${o+d*20} ${g+f} Q ${(o+t.x)/2} ${(g+S)/2+f*.6+20} ${t.x} ${S+f*.3}`),t.lower.style.opacity=t.upper.style.opacity=String(1-d),!0})}snap(a){const h=()=>{const t=document.createElementNS(L,"path");return t.setAttribute("class","rein alarm"),this.svg.append(t),t};this.snaps.push({upper:h(),lower:h(),x:a.x,t0:performance.now(),sag:a.sag})}}export{B as m};
