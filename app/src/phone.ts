// Phone side of Reins, inside the Even app: the slow things. Your vault, a rein to each agent, budgets, payees,
// the code an agent needs to connect, Telegram, and the backup words. Decisions happen on the glasses.
import './phone.css';
import type { Vault } from './vault.ts';
import type { State, AgentRow } from './lens.ts';

type Payee = { address: string; name: string; trusted: boolean; autoLimit: string };
type Ev = { t: number; text: string; level: 'info' | 'warn' | 'alarm' };
type PState = State & { payees?: Payee[]; link?: string; events?: Ev[]; telegramBot?: string | null };
type Ctx = {
  getVault(): Vault | null; getServer(): string; getState(): PState | null;
  setServer(url: string): Promise<void>; create(): Promise<Vault>; import(words: string): Promise<Vault>;
  api(method: string, path: string, body?: unknown): Promise<any>;
};

const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const n = (s: string | number | undefined) => Number(s ?? 0);
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(text: string) {
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = text;
  document.body.append(el); setTimeout(() => el.remove(), 2300);
}

export function mountPhone(ctx: Ctx) {
  const root = document.getElementById('app')!;
  let mode: 'intro' | 'words' | 'main' | '' = '';
  let selected: string | null = null;
  let renaming: string | null = null;
  let showWords = false;
  let stage: Stage | null = null;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); if (done) toast(done); } catch (e) { toast((e as Error).message); }
  };

  function frame() {
    const v = ctx.getVault();
    const want = !v ? 'intro' : showWords ? 'words' : 'main';
    if (want !== mode) { mode = want; stage?.stop(); stage = null; build(); }
    if (mode === 'main') update();
  }

  // ---------- first run ----------
  function build() {
    const v = ctx.getVault();
    if (mode === 'intro') {
      root.innerHTML = `
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
        </div>`;
      root.querySelector('#create')!.addEventListener('click', async () => { await ctx.create(); showWords = true; frame(); });
      root.querySelector('#import')!.addEventListener('click', async () => {
        try { await ctx.import((root.querySelector('#words') as HTMLTextAreaElement).value); frame(); }
        catch (e) { root.querySelector('#err')!.textContent = (e as Error).message; }
      });
      return;
    }
    if (mode === 'words') {
      root.innerHTML = `
        <div class="intro">
          <h2>Write these 24 words down</h2>
          <p class="dim" style="margin-top:8px">They are the only way back into your vault if you lose this phone. Nobody else has them, including us.</p>
          <div class="words">${v!.words.map(w => `<span>${esc(w)}</span>`).join('')}</div>
          <div><button class="go" id="done">I wrote them down</button></div>
        </div>`;
      root.querySelector('#done')!.addEventListener('click', () => { showWords = false; frame(); });
      return;
    }
    root.innerHTML = `
      <header class="top">
        <h1 class="mark">REINS</h1>
        <a href="#vault"><b class="num" id="vbal">…</b> in your vault</a>
      </header>
      <div class="stage" id="stage"><span class="vaultlabel">your vault</span><svg aria-hidden="true"></svg></div>
      <p class="now" id="now" aria-live="polite"></p>
      <section id="agent" hidden></section>
      <section id="connect"></section>
      <section id="payees"></section>
      <section id="telegram"></section>
      <section id="activity"></section>
      <section id="vault"></section>`;
    stage = new Stage(root.querySelector('#stage')!, id => { selected = id; update(); });
    root.addEventListener('click', onClick);
  }

  // ---------- main page ----------
  function update() {
    const v = ctx.getVault()!, s = ctx.getState();
    const $ = (q: string) => root.querySelector(q) as HTMLElement;
    if (!s) { $('#now').textContent = `Looking for your Reins server at ${ctx.getServer()}…`; return; }
    $('#vbal').textContent = `${s.vaultBalance} GRAM`;
    const live = s.agents.filter(a => a.status === 'active' || a.status === 'frozen');
    if (!selected || !s.agents.some(a => a.id === selected)) selected = live[0]?.id ?? null;
    stage!.render(s, selected);

    // One sentence on what is going on now.
    const now = $('#now');
    now.className = 'now' + (s.alarm ? ' alarm' : '');
    if (s.alarm) now.innerHTML = `${esc(s.alarm.agent)} moved ${esc(s.alarm.amount ?? 'money')} GRAM you never approved. Kill it from your glasses.`;
    else if (s.pending) {
      const c = s.pending;
      const what = c.kind === 'create' ? 'wants a wallet' : `asks ${esc(c.amount)} GRAM for ${esc(c.toName ?? short(c.to!))}`;
      now.innerHTML = `<span class="lensdot"></span>${esc(c.agent)} ${what}. Answer on your glasses.${s.pendingCount > 1 ? ` ${s.pendingCount - 1} more after that.` : ''}`;
    } else if (!live.length) now.textContent = 'No agents yet. Connect one below and it will appear here.';
    else now.textContent = `Nothing is waiting for you. ${s.spentToday} GRAM spent today.`;

    agentSection($('#agent'), s.agents.find(a => a.id === selected));
    connectSection($('#connect'), s);
    if (!renaming) payeesSection($('#payees'), s.payees ?? []);
    telegramSection($('#telegram'), s);
    activitySection($('#activity'), s.events ?? []);
    vaultSection($('#vault'), v, s);
  }

  const put = (el: HTMLElement, html: string) => { if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; } };

  function agentSection(el: HTMLElement, a?: AgentRow) {
    el.hidden = !a;
    if (!a) return;
    const killed = a.status === 'revoked', paused = a.status === 'frozen';
    const share = Math.min(100, (n(a.spentToday) / Math.max(n(a.daily), 1e-9)) * 100);
    put(el, `
      <div class="agent-head"><h2>${esc(a.name)}</h2><span class="dim">${killed ? 'killed today' : paused ? 'paused' : `${esc(a.balance)} GRAM in its wallet`}</span></div>
      ${killed ? `<p>Its key was revoked on chain and what it held came back to your vault.</p>` : `
      <div class="meter" role="img" aria-label="${esc(a.spentToday)} of ${esc(a.daily)} GRAM spent today"><i style="width:${share}%"></i></div>
      <p><span class="num">${esc(a.spentToday)}</span> of <span class="num">${esc(a.daily)}</span> GRAM spent today${a.last ? `. Last: ${esc(a.last.amount)} to ${esc(a.last.to)} at ${clock(a.last.at)}.` : '.'}</p>
      <div class="budget" aria-label="Daily budget">
        <button data-budget="-0.5" aria-label="Lower daily budget">−</button>
        <span class="val num">${esc(a.daily)}</span>
        <button data-budget="0.5" aria-label="Raise daily budget">+</button>
        <span class="dim">GRAM a day it may spend on payees you trust, without asking.</span>
      </div>
      <div class="actions">
        <button data-pause="${paused ? 'off' : 'on'}">${paused ? 'Resume' : 'Pause'} ${esc(a.name)}</button>
      </div>
      <p class="dim" style="margin-top:14px">To kill it, open Reins on your glasses. Killing revokes its key on chain.</p>`}`);
  }

  function connectSection(el: HTMLElement, s: PState) {
    const server = ctx.getServer();
    put(el, `
      <h2>Connect an agent</h2>
      <p>Give an agent this code once. It gets its own small wallet the moment you approve it on your glasses, and nothing more.</p>
      <div class="code" id="linkcode">${esc(s.link ?? '…')}</div>
      <button data-copy="${esc(s.link ?? '')}">Copy code</button>
      <button class="quiet" data-newlink>Make a new code</button>
      <details style="margin-top:14px"><summary>Setup for Claude Code, Hermes, Codex</summary>
        <pre>claude mcp add reins \\
  -e REINS_LINK=${esc(s.link ?? '')} \\
  -e REINS_SERVER=${esc(server)} \\
  -- npx tsx reins/kit/src/mcp.ts</pre>
        <p class="dim" style="margin-top:8px">Other agents: see docs/AGENTS.md in the Reins repo.</p>
      </details>`);
  }

  function payeesSection(el: HTMLElement, payees: Payee[]) {
    put(el, `
      <h2>Payees</h2>
      ${payees.length ? '' : '<p>When you approve a payment with "always trust" on your glasses, the payee shows up here.</p>'}
      ${payees.map(p => `
        <div class="row">
          <div class="grow">
            ${renaming === p.address
              ? `<input data-rename-input="${esc(p.address)}" value="${esc(p.name)}" aria-label="Payee name">`
              : `<button class="pname" data-rename="${esc(p.address)}">${esc(p.name)}</button>`}
            <div class="addr">${esc(short(p.address))}</div>
            <div class="dim" style="font-size:14px">${p.trusted ? `Paid without asking, up to ${esc(p.autoLimit)} GRAM` : 'Always asks you first'}</div>
          </div>
          <button class="switch" role="switch" aria-checked="${p.trusted}" aria-label="Trust ${esc(p.name)}" data-trust="${esc(p.address)}"></button>
        </div>`).join('')}`);
  }

  function telegramSection(el: HTMLElement, s: PState) {
    const bot = s.telegramBot;
    put(el, `
      <h2>Telegram</h2>
      ${s.telegram === 'linked'
        ? '<p>Linked. Warnings reach you there, and you can reject a request or pause an agent from the chat. Money only moves from your glasses.</p>'
        : s.telegram && bot
          ? `<p>Get warnings in Telegram, with Reject and Pause buttons.</p><p style="margin-top:14px"><a class="btn go" href="https://t.me/${esc(bot)}?start=${esc(s.telegram)}">Link Telegram</a></p>
             <p class="dim" style="margin-top:10px">Or send <b>/pair ${esc(s.telegram)}</b> to @${esc(bot)}.</p>`
          : '<p class="dim">This server has no Telegram bot set up.</p>'}`);
  }

  function activitySection(el: HTMLElement, events: Ev[]) {
    put(el, `
      <h2>Today</h2>
      ${events.length ? `<ul class="log">${events.slice(0, 14).map(e => `<li class="${e.level}"><time>${clock(e.t)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>` : '<p class="dim">Nothing has happened yet.</p>'}`);
  }

  function vaultSection(el: HTMLElement, v: Vault, s: PState) {
    const topup = (amt: number) => `ton://transfer/${v.address}?amount=${amt * 1e9}&text=Reins%20vault`;
    put(el, `
      <h2>Your vault</h2>
      <p><span class="num" style="font-size:40px">${esc(s.vaultBalance)}</span> GRAM, and <span class="num">${esc(s.atRisk)}</span> out in agent wallets.</p>
      <p class="actions"><a class="btn go" href="${topup(1)}">Add 1 GRAM</a><a class="btn" href="${topup(5)}">Add 5</a><button data-copy="${esc(v.address)}">Copy address</button></p>
      <p class="addr" style="margin-top:10px;word-break:break-all">${esc(v.address)}</p>
      <p class="dim" style="margin-top:10px">Opens Gram Wallet or any TON wallet. On testnet, free GRAM comes from @testgiver_ton_bot.</p>
      <details style="margin-top:16px"><summary>Backup words and server</summary>
        <p style="margin:10px 0"><button data-words>Show backup words</button></p>
        <label class="dim">Reins server <input id="server" value="${esc(ctx.getServer())}"></label>
        <p style="margin-top:10px"><button data-server>Use this server</button></p>
      </details>`);
  }

  // ---------- one click handler for the whole page ----------
  async function onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('button, a') as HTMLElement | null;
    if (!t) return;
    const s = ctx.getState();
    const a = s?.agents.find(x => x.id === selected);
    const d = t.dataset;
    if (d.copy !== undefined) { await navigator.clipboard?.writeText(d.copy).catch(() => {}); toast('Copied'); }
    else if (d.newlink !== undefined) await act(() => ctx.api('POST', '/lens/link'), 'New code made. The old one no longer works.');
    else if (d.budget && a) {
      const next = Math.max(0.5, +(n(a.daily) + Number(d.budget)).toFixed(3));
      a.daily = String(next); update();
      await act(() => ctx.api('POST', '/lens/budget', { agentId: a.id, daily: String(next) }));
    }
    else if (d.pause && a) await act(() => ctx.api('POST', '/lens/pause', { agentId: a.id, on: d.pause === 'on' }), d.pause === 'on' ? `${a.name} paused` : `${a.name} resumed`);
    else if (d.trust) {
      const p = s?.payees?.find(x => x.address === d.trust); if (!p) return;
      p.trusted = !p.trusted; update();
      await act(() => ctx.api('POST', '/lens/payee', { address: p.address, trusted: p.trusted }));
    }
    else if (d.rename) {
      renaming = d.rename; payeesSection(root.querySelector('#payees')!, s?.payees ?? []);
      const input = root.querySelector('[data-rename-input]') as HTMLInputElement; input.focus(); input.select();
      const finish = async (save: boolean) => {
        const addr = renaming; renaming = null;
        if (save && addr && input.value.trim()) await act(() => ctx.api('POST', '/lens/payee', { address: addr, name: input.value.trim() }), 'Renamed');
        update();
      };
      input.addEventListener('keydown', k => { if (k.key === 'Enter') void finish(true); if (k.key === 'Escape') void finish(false); });
      input.addEventListener('blur', () => void finish(true), { once: true });
    }
    else if (d.words !== undefined) { showWords = true; frame(); }
    else if (d.server !== undefined) await act(() => ctx.setServer((root.querySelector('#server') as HTMLInputElement).value), 'Server saved');
    else return;
    if (mode === 'main') update();
  }

  frame();
  setInterval(frame, 1500);
}

// ---------- the reins ----------
type Rein = {
  id: string; path: SVGPathElement; node: HTMLButtonElement;
  x: number; tx: number; sag: number; target: number;
  state: 'live' | 'paused' | 'alarm' | 'killed'; drawn: number; lastAt: number;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const HY = 44, NY = 222;

/** Your vault at the top, a rein to each agent. The more an agent has spent today, the tighter its rein. */
class Stage {
  private svg: SVGSVGElement;
  private reins = new Map<string, Rein>();
  private pulses: { id: string; t0: number }[] = [];
  private snaps: { lower: SVGPathElement; upper: SVGPathElement; x: number; t0: number; sag: number }[] = [];
  private raf = 0;
  private first = true;
  private width = 360;

  constructor(private el: HTMLElement, private onSelect: (id: string) => void) {
    this.svg = el.querySelector('svg')!;
    const handle = document.createElementNS(SVGNS, 'g');
    handle.innerHTML = `<circle class="handle" r="15"></circle><circle class="handle-core" r="5"></circle>`;
    this.svg.append(handle);
    const place = () => { this.width = el.clientWidth || 360; handle.setAttribute('transform', `translate(${this.width / 2} ${HY})`); };
    place(); addEventListener('resize', place);
    const tick = (t: number) => { this.step(t); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { cancelAnimationFrame(this.raf); }

  render(s: State, selected: string | null) {
    // Killed agents leave the stage: their rein snaps once, then they live on in the log.
    for (const a of s.agents) {
      const r = this.reins.get(a.id);
      if (a.status === 'revoked' && r && r.state !== 'killed') {
        this.snap(r); r.state = 'killed'; r.path.remove();
        r.node.style.transition = 'opacity .9s'; r.node.style.opacity = '0';
        setTimeout(() => r.node.remove(), 1000); this.reins.delete(a.id);
      }
    }
    const shown = s.agents.filter(a => a.status === 'active' || a.status === 'frozen');
    const slots = shown.length;
    shown.forEach((a, i) => {
      const x = this.width * ((i + 1) / (slots + 1));
      const state: Rein['state'] = a.status === 'revoked' ? 'killed' : s.alarm?.agentId === a.id ? 'alarm' : a.status === 'frozen' ? 'paused' : 'live';
      const tension = Math.min(1, n(a.spentToday) / Math.max(n(a.daily), 1e-9));
      const target = state === 'paused' ? 120 : 8 + (1 - tension) * 74;
      let r = this.reins.get(a.id);
      if (!r) {
        const path = document.createElementNS(SVGNS, 'path');
        this.svg.insertBefore(path, this.svg.firstChild);
        const node = document.createElement('button');
        node.className = 'node'; node.addEventListener('click', () => this.onSelect(a.id));
        this.el.append(node);
        r = { id: a.id, path, node, x, tx: x, sag: this.first ? target : 140, target, state, drawn: reduced || state === 'killed' ? 1 : 0, lastAt: a.last?.at ?? 0 };
        this.reins.set(a.id, r);
      }
      if (r.state !== 'killed' && state === 'killed') this.snap(r);
      if (a.last && a.last.at > r.lastAt) { r.lastAt = a.last.at; if (state !== 'killed') this.pulses.push({ id: a.id, t0: performance.now() }); }
      r.state = state; r.tx = x; r.target = target;
      r.path.setAttribute('class', `rein ${state === 'killed' ? 'ghost' : state}`);
      r.path.style.display = state === 'killed' ? 'none' : '';
      r.node.className = `node ${state === 'killed' ? 'killed' : state}${a.id === selected ? ' sel' : ''}`;
      r.node.style.left = `${x}px`; r.node.style.top = `${NY + 8}px`;
      const use = state === 'killed' ? 'killed' : state === 'paused' ? 'paused' : `${a.spentToday} of ${a.daily}`;
      const html = `<span class="name">${esc(a.name)}</span><span class="use">${esc(use)}</span>${a.waiting ? '<span class="wait">on your glasses</span>' : ''}`;
      if (r.node.dataset.html !== html) { r.node.dataset.html = html; r.node.innerHTML = html; }
      r.node.setAttribute('aria-pressed', String(a.id === selected));
    });
    for (const [id, r] of this.reins) if (!shown.some(a => a.id === id)) { r.path.remove(); r.node.remove(); this.reins.delete(id); }
    this.el.classList.toggle('empty', !shown.length);
    this.first = false;
  }

  private d(x: number, sag: number, wob = 0) {
    const hx = this.width / 2, mx = (hx + x) / 2 + wob, my = (HY + NY) / 2 + sag;
    return `M ${hx} ${HY + 15} Q ${mx} ${my} ${x} ${NY}`;
  }

  private step(now: number) {
    let i = 0;
    for (const r of this.reins.values()) {
      if (r.state === 'killed') continue;
      // A spring toward the target slack, so changes in spending visibly pull the rein.
      r.sag += (r.target - r.sag) * (reduced ? 1 : 0.06);
      r.x += (r.tx - r.x) * (reduced ? 1 : 0.15);
      const wob = r.state === 'alarm' && !reduced ? Math.sin(now / 38) * 5 : 0;
      r.path.setAttribute('d', this.d(r.x, r.sag, wob));
      if (r.drawn < 1) {
        // First appearance: the rein is paid out from your vault to the agent.
        r.drawn = Math.min(1, r.drawn + 0.022);
        const len = r.path.getTotalLength();
        const e = 1 - Math.pow(1 - Math.max(0, r.drawn - i * 0.08), 3);
        r.path.style.strokeDasharray = `${len}`; r.path.style.strokeDashoffset = `${len * (1 - e)}`;
        r.node.style.opacity = String(Math.max(0, e * 1.4 - 0.4));
        if (r.drawn >= 1) { r.path.style.strokeDasharray = ''; r.path.style.strokeDashoffset = ''; }
      }
      i++;
    }
    // A payment runs down the rein from your vault to the agent.
    this.pulses = this.pulses.filter(p => {
      const r = this.reins.get(p.id); if (!r || r.state === 'killed') return false;
      let dot = this.svg.querySelector(`[data-pulse="${p.t0}"]`) as SVGCircleElement | null;
      if (!dot) { dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', '6'); dot.setAttribute('class', 'pulse'); dot.dataset.pulse = String(p.t0); this.svg.append(dot); }
      const k = (now - p.t0) / 1100;
      if (k >= 1 || reduced) { dot.remove(); return false; }
      const len = r.path.getTotalLength(), pt = r.path.getPointAtLength(len * (k * k * (3 - 2 * k)));
      dot.setAttribute('cx', String(pt.x)); dot.setAttribute('cy', String(pt.y));
      return true;
    });
    // A killed agent's rein snaps in the middle: the top half springs back, the bottom half falls away.
    this.snaps = this.snaps.filter(sn => {
      const k = (now - sn.t0) / 1000;
      if (k >= 1 || reduced) { sn.lower.remove(); sn.upper.remove(); return false; }
      const hx = this.width / 2, bx = (hx + sn.x) / 2, by = (HY + NY) / 2 + sn.sag / 2;
      const recoil = 1 - Math.pow(k, 0.6);
      sn.upper.setAttribute('d', `M ${hx} ${HY + 15} L ${hx + (bx - hx) * recoil} ${HY + 15 + (by - HY - 15) * recoil}`);
      const fall = 420 * k * k;
      sn.lower.setAttribute('d', `M ${bx + k * 20} ${by + fall} Q ${(bx + sn.x) / 2} ${(by + NY) / 2 + fall * 0.6 + 20} ${sn.x} ${NY + fall * 0.3}`);
      sn.lower.style.opacity = sn.upper.style.opacity = String(1 - k);
      return true;
    });
  }

  private snap(r: Rein) {
    const mk = () => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', 'rein alarm'); this.svg.append(p); return p; };
    this.snaps.push({ upper: mk(), lower: mk(), x: r.x, t0: performance.now(), sag: r.sag });
  }
}
