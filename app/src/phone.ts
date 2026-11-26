// Phone-side page (inside the Even app): setup, top-up, agents, budgets, payees, Telegram.
// The glasses are for the moment; this page is for the settings you change once in a while.
import type { Vault } from './vault.ts';
import type { State } from './lens.ts';

type Payee = { address: string; name: string; trusted: boolean; autoLimit: string };
type Ctx = {
  getVault(): Vault | null; getServer(): string; getState(): (State & { payees?: Payee[] }) | null;
  setServer(url: string): Promise<void>; create(): Promise<Vault>; import(words: string): Promise<Vault>;
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function mountPhone(ctx: Ctx) {
  const root = document.getElementById('app')!;
  let reveal = false;
  let editing = false;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(ctx.getServer() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error);
  };

  const draw = () => {
    const v = ctx.getVault(), s = ctx.getState();
    if (!v) {
      root.innerHTML = `
        <h1>Reins</h1>
        <p class="lead">Your agents spend. You hold the reins.</p>
        <p>Reins keeps a small vault on this phone. Its key never leaves the phone. Your agents get only what you approve on your glasses.</p>
        <button class="primary" id="create">Create my vault</button>
        <details><summary>Import an existing vault</summary>
          <textarea id="words" rows="4" placeholder="24 words"></textarea>
          <button id="import">Import</button>
        </details>
        <p id="err" class="err"></p>`;
    } else {
      const agents = (s?.agents ?? []).filter(a => a.status !== 'revoked');
      const topup = (n: number) => `ton://transfer/${v.address}?amount=${n * 1e9}&text=Reins%20vault`;
      root.innerHTML = `
        <h1>Reins</h1>
        <div class="stats">
          <div><b>${esc(s?.vaultBalance ?? '…')}</b><span>vault GRAM</span></div>
          <div><b>${esc(s?.atRisk ?? '…')}</b><span>in agent wallets</span></div>
          <div><b>${esc(s?.spentToday ?? '…')}</b><span>spent today</span></div>
        </div>

        <section>
          <h2>Top up your vault</h2>
          <p class="muted">From Gram Wallet in Telegram, or any TON wallet. Testnet GRAM is free from @testgiver_ton_bot.</p>
          <a class="button primary" href="${topup(1)}">Add 1 GRAM</a><a class="button" href="${topup(5)}">Add 5</a>
          <button id="copy">Copy vault address</button>
          <code>${esc(v.address)}</code>
        </section>

        <section>
          <h2>Agents</h2>
          ${agents.map(a => `
            <div class="row">
              <div class="grow"><b>${esc(a.name)}</b> <span class="tag ${a.status}">${a.status === 'frozen' ? 'paused' : esc(a.status)}</span><br>
                <span class="muted">${esc(a.spentToday)} of ${esc(a.daily)} GRAM today · wallet ${esc(a.balance)}</span></div>
              <input class="budget" data-agent="${a.id}" value="${esc(a.daily)}" inputmode="decimal" title="Daily budget (GRAM)">
              <button data-pause="${a.id}" data-on="${a.status !== 'frozen'}">${a.status === 'frozen' ? 'Resume' : 'Pause'}</button>
            </div>`).join('') || '<p class="muted">No agents yet. Give an agent your Reins server address (see README), and it will ask your glasses for a wallet.</p>'}
          <p class="muted">Daily budget: what an agent may spend on trusted payees without asking. Kill lives on the glasses.</p>
        </section>

        <section>
          <h2>Payees</h2>
          ${(s?.payees ?? []).map(p => `
            <div class="row">
              <div class="grow"><b>${esc(p.name)}</b><br><span class="muted">${esc(short(p.address))} · ${p.trusted ? `auto up to ${esc(p.autoLimit)}` : 'always asks'}</span></div>
              <button data-trust="${esc(p.address)}" data-on="${!p.trusted}">${p.trusted ? 'Stop trusting' : 'Trust'}</button>
            </div>`).join('') || '<p class="muted">Approve a payment with "always trust" on your glasses to add one.</p>'}
        </section>

        <section>
          <h2>Telegram</h2>
          <p>${s?.telegram === 'linked' ? 'Linked. Alerts, Reject and Pause work there; money only moves from your glasses.' : s?.telegram ? `Send <code class="inline">/pair ${esc(s.telegram)}</code> to your Reins bot.` : 'Not set up on the server.'}</p>
        </section>

        <section>
          <h2>Activity</h2>
          ${(s?.ticker ?? []).map(t => `<p class="log">${esc(t)}</p>`).join('')}
        </section>

        <details><summary>Vault backup and server</summary>
          <button id="reveal">${reveal ? 'Hide' : 'Show'} backup words</button>
          ${reveal ? `<p class="words">${esc(v.words.join(' '))}</p>` : ''}
          <label>Server <input id="server" value="${esc(ctx.getServer())}"></label><button id="save">Save</button>
        </details>`;
    }
    const $ = (q: string) => root.querySelector(q) as HTMLElement | null;
    $('#copy')?.addEventListener('click', () => navigator.clipboard?.writeText(v!.address));
    $('#reveal')?.addEventListener('click', () => { reveal = !reveal; draw(); });
    $('#save')?.addEventListener('click', async () => { await ctx.setServer(($('#server') as HTMLInputElement).value); draw(); });
    $('#create')?.addEventListener('click', async () => { await ctx.create(); reveal = true; draw(); });
    $('#import')?.addEventListener('click', async () => {
      try { await ctx.import(($('#words') as HTMLTextAreaElement).value); draw(); } catch (e) { $('#err')!.textContent = (e as Error).message; }
    });
    root.querySelectorAll<HTMLButtonElement>('[data-pause]').forEach(b => b.addEventListener('click', async () => { await post('/lens/pause', { agentId: b.dataset.pause, on: b.dataset.on === 'true' }); }));
    root.querySelectorAll<HTMLButtonElement>('[data-trust]').forEach(b => b.addEventListener('click', async () => { await post('/lens/payee', { address: b.dataset.trust, trusted: b.dataset.on === 'true' }); }));
    root.querySelectorAll<HTMLInputElement>('.budget').forEach(i => {
      i.addEventListener('focus', () => { editing = true; });
      i.addEventListener('change', async () => { editing = false; await post('/lens/budget', { agentId: i.dataset.agent, daily: i.value }).catch(e => alert(e.message)); });
      i.addEventListener('blur', () => { editing = false; });
    });
  };
  draw();
  setInterval(() => { if (!reveal && !editing && !(document.activeElement instanceof HTMLTextAreaElement)) draw(); }, 4000);
}
