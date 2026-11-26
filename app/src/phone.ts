// Phone-side page (inside the Even app): setup, vault backup, server, Telegram pairing.
import type { Vault } from './vault.ts';
import type { State } from './lens.ts';

type Ctx = {
  getVault(): Vault | null; getServer(): string; getState(): State | null;
  setServer(url: string): Promise<void>; create(): Promise<Vault>; import(words: string): Promise<Vault>;
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function mountPhone(ctx: Ctx) {
  const root = document.getElementById('app')!;
  let reveal = false;
  const draw = () => {
    const v = ctx.getVault(), s = ctx.getState();
    root.innerHTML = v ? `
      <h1>Reins</h1>
      <p class="muted">Your agents spend. You hold the reins.</p>
      <section>
        <h2>Vault</h2>
        <code id="addr">${esc(v.address)}</code>
        <button id="copy">Copy address</button>
        <p>Balance: <b>${esc(s?.vaultBalance ?? '…')}</b> GRAM · At risk in agents: <b>${esc(s?.atRisk ?? '…')}</b></p>
        <p class="muted">Testnet only. Top up from @testgiver_ton_bot. Reins drips from here to your agents, only what you approve.</p>
        <button id="reveal">${reveal ? 'Hide' : 'Show'} backup words</button>
        ${reveal ? `<p class="words">${esc(v.words.join(' '))}</p>` : ''}
      </section>
      <section>
        <h2>Agents</h2>
        ${(s?.agents ?? []).map(a => `<p>${esc(a.name)} · ${esc(a.status)}</p>`).join('') || '<p class="muted">None yet. Point an agent at your Reins server.</p>'}
      </section>
      <section>
        <h2>Telegram</h2>
        <p>${s?.telegram === 'linked' ? 'Linked. Alerts and the kill switch also work there.' : s?.telegram ? `Send <code>/pair ${esc(s.telegram)}</code> to your Reins bot.` : 'Bot not configured on the server.'}</p>
      </section>
      <section>
        <h2>Server</h2>
        <input id="server" value="${esc(ctx.getServer())}" /><button id="save">Save</button>
      </section>`
      : `
      <h1>Reins</h1>
      <p>Reins keeps a small vault on this phone. Its key never leaves the phone.</p>
      <button id="create">Create a new vault</button>
      <p class="muted">Or import 24 words:</p>
      <textarea id="words" rows="4" placeholder="word1 word2 …"></textarea>
      <button id="import">Import</button>
      <p id="err" class="err"></p>`;
    root.querySelector('#copy')?.addEventListener('click', () => navigator.clipboard?.writeText(v!.address));
    root.querySelector('#reveal')?.addEventListener('click', () => { reveal = !reveal; draw(); });
    root.querySelector('#save')?.addEventListener('click', async () => { await ctx.setServer((root.querySelector('#server') as HTMLInputElement).value); draw(); });
    root.querySelector('#create')?.addEventListener('click', async () => { await ctx.create(); reveal = true; draw(); });
    root.querySelector('#import')?.addEventListener('click', async () => {
      try { await ctx.import((root.querySelector('#words') as HTMLTextAreaElement).value); draw(); }
      catch (e) { root.querySelector('#err')!.textContent = (e as Error).message; }
    });
  };
  draw();
  setInterval(() => { if (!reveal && !(document.activeElement instanceof HTMLInputElement)) draw(); }, 5000);
}
