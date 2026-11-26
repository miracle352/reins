import {
  waitForEvenAppBridge, TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, TextContainerUpgrade, OsEventTypeList, AudioInputSource,
} from '@evenrealities/even_hub_sdk';
import { createAgentTx, fundTx, killTx } from '../../shared/vault.ts';
import { toNano } from '@ton/core';
import type { Intent } from '../../shared/intent.ts';
import { loadVault, createVault, importVault, type Vault } from './vault.ts';
import * as L from './lens.ts';
import { mountPhone } from './phone.ts';

const bridge = await waitForEvenAppBridge();
const store = { get: (k: string) => bridge.getLocalStorage(k), set: (k: string, v: string) => bridge.setLocalStorage(k, v) };
const SERVER_KEY = 'reins.server';
let server = (await store.get(SERVER_KEY).catch(() => '')) || (import.meta.env.VITE_REINS_SERVER as string) || 'http://localhost:8787';

// ---------- bridge calls: serialized with a timeout, as the SDK guide requires ----------
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>, ms = 5000): Promise<T> {
  const run = queue.then(() => Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('bridge timeout')), ms))]));
  queue = run.catch(() => undefined);
  return run;
}

// ---------- page building ----------
const TEXT = { id: 1, name: 'body' }, LIST = { id: 2, name: 'actions' };
let started = false;
let shown = { key: '', items: [] as string[] };

const textBox = (content: string, h: number, capture: boolean) => new TextContainerProperty({
  xPosition: 0, yPosition: 0, width: 576, height: h, borderWidth: 0, borderColor: 0, paddingLength: 6,
  containerID: TEXT.id, containerName: TEXT.name, content, isEventCapture: capture ? 1 : 0,
});
const listBox = (items: string[], top: number) => new ListContainerProperty({
  xPosition: 0, yPosition: top, width: 576, height: 288 - top, borderWidth: 1, borderColor: 6, borderRadius: 6, paddingLength: 4,
  containerID: LIST.id, containerName: LIST.name, isEventCapture: 1,
  itemContainer: new ListItemContainerProperty({ itemCount: items.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: items }),
});

/** Same key and same items: update the text in place (no flicker). Otherwise rebuild the page. */
async function show(key: string, page: L.Page, listTop = 176) {
  const same = shown.key === key && shown.items.join('|') === page.items.join('|');
  if (same) { await serial(() => bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: TEXT.id, containerName: TEXT.name, content: page.body }))); return; }
  shown = { key, items: page.items };
  const has = page.items.length > 0;
  const textObject = [textBox(page.body, has ? listTop : 288, !has)];
  const listObject = has ? [listBox(page.items, listTop)] : undefined;
  const containerTotalNum = has ? 2 : 1;
  if (!started) { started = true; await serial(() => bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum, textObject, listObject }))); }
  else await serial(() => bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject })));
}

// ---------- server ----------
async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(server + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
const vaultSeqno = async (v: Vault) => (await api('GET', `/chain/wallet/${v.address}`)).seqno as number;

// ---------- app state ----------
type View =
  | { t: 'home' } | { t: 'agent'; id: string } | { t: 'activity' } | { t: 'why'; cardId: string }
  | { t: 'confirmKill'; agentId: string; name: string; address: string }
  | { t: 'confirmGive'; agentId: string; amount: number };
let vault: Vault | null = null;
let state: L.State | null = null;
let view: View = { t: 'home' };
let busy = false;
let listeningHint: string | null = null;
let note: { text: string; until: number } | null = null;
let heardFor = ''; // card id we already listened for
let retried = ''; // card id we gave a second listen

const flash = (t: string, ms = 3500) => { note = { text: t, until: Date.now() + ms }; void render(); };
const agentById = (id: string) => state?.agents.find(a => a.id === id);

/** Decides what is on the lens. Order matters: alarms and requests interrupt browsing, never a confirm. */
function current(): { key: string; page: L.Page; top?: number } {
  if (!vault) return { key: 'setup', page: { body: 'REINS\n\nOpen Reins on your phone to create\nor import your vault.', items: [] } };
  if (note && Date.now() < note.until) return { key: 'note:' + note.text, page: { body: note.text, items: [] } };
  if (listeningHint) return { key: 'listen', page: { body: L.listening(listeningHint), items: [] } };
  if (!state) return { key: 'loading', page: { body: 'REINS\n\nConnecting to your Reins server…', items: [] } };
  if (view.t === 'confirmKill') return { key: 'ck:' + view.agentId, page: L.confirmKill(view.name) };
  if (view.t === 'confirmGive') { const a = agentById(view.agentId); if (a) return { key: 'cg:' + view.agentId, page: L.confirmGive(a, view.amount) }; }
  if (state.alarm) return { key: 'alarm:' + state.alarm.agentId + state.alarm.text, page: L.alarm(state.alarm, state.atRisk) };
  if (view.t === 'why' && state.pending?.id === view.cardId) return { key: 'why:' + view.cardId, page: L.why(state.pending), top: 236 };
  if (state.pending) return { key: 'card:' + state.pending.id, page: L.card(state.pending, state.pendingCount) };
  if (view.t === 'agent') { const a = agentById(view.id); if (a) return { key: 'agent:' + a.id + a.status, page: L.agentPage(a), top: 150 }; }
  if (view.t === 'activity') return { key: 'activity', page: L.activity(state), top: 236 };
  return { key: 'home', page: L.home(state), top: 84 };
}

async function render() {
  if (note && Date.now() >= note.until) note = null;
  const c = current();
  await show(c.key, c.page, c.top);
  // Hands-free: when a new request lands, listen once for a short answer.
  if (state?.pending && c.key === 'card:' + state.pending.id && heardFor !== state.pending.id && !busy) {
    heardFor = state.pending.id;
    void listenFor(L.isClean(state.pending) ? 'Say "approve" or "reject"' : 'Say "reject", "why" or "kill it"', true);
  }
}

async function poll() {
  if (!vault) return;
  try { state = await api('GET', '/lens/state'); }
  catch (e) { state = null; flash(`Server unreachable\n${server}\n${(e as Error).message}`, 3000); return; }
  if (!busy) await render();
}

// ---------- actions ----------
async function run(label: string, fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (e) { flash(`Failed: ${(e as Error).message}`, 6000); }
  finally { busy = false; await poll(); }
  void label;
}

async function fund(c: L.Card, trust: boolean) {
  flash('Signing with your vault…', 20000);
  const seq = await vaultSeqno(vault!);
  const boc = c.kind === 'create'
    ? createAgentTx(vault!.keys, seq, c.operatorPub, BigInt(c.amountNano))
    : fundTx(vault!.keys, seq, c.agentAddress, BigInt(c.amountNano));
  await api('POST', '/lens/decide', { requestId: c.id, action: trust ? 'trust' : 'fund', boc, name: c.toName });
  flash(c.kind === 'create' ? `Wallet created for ${c.agent}.` : `Sent exactly ${c.amount} GRAM.\n${c.agent} can pay now.${trust ? '\nPayee trusted.' : ''}`);
}
async function reject(c: L.Card) { await api('POST', '/lens/decide', { requestId: c.id, action: 'reject' }); flash(`Rejected.\n${c.agent} was told no.`); }
async function kill(agentId: string, name: string, address: string) {
  flash(`Killing ${name}…`, 20000);
  const boc = killTx(vault!.keys, await vaultSeqno(vault!), address);
  await api('POST', '/lens/kill', { agentId, boc });
  view = { t: 'home' };
  flash(`${name} is dead.\nKey revoked on chain.\nFunds swept to your vault.`, 6000);
}
async function give(agentId: string, amount: number) {
  const a = agentById(agentId)!;
  flash(`Sending ${amount} GRAM to ${a.name}…`, 20000);
  const boc = fundTx(vault!.keys, await vaultSeqno(vault!), a.address, toNano(String(amount)) - toNano('0.02'));
  const r = await api('POST', '/lens/give', { agentId, amount: String(amount), boc });
  view = { t: 'agent', id: agentId };
  flash(`Gave ${a.name} ${amount} GRAM.\nToday's budget: ${r.daily} GRAM.`);
}
async function pause(agentId: string, on: boolean) {
  await api('POST', '/lens/pause', { agentId, on });
  flash(`${agentById(agentId)?.name} ${on ? 'paused. Its requests are refused.' : 'resumed.'}`);
}
const askKill = (a: { id: string; name: string; address: string }) => { view = { t: 'confirmKill', agentId: a.id, name: a.name, address: a.address }; };

async function onSelect(index: number) {
  if (!vault || !state || busy) return;
  const label = shown.items[index] ?? '';
  const key = shown.key;
  if (key.startsWith('card:') && state.pending) {
    const c = state.pending;
    if (label.startsWith('x')) return run('reject', () => reject(c));
    if (label.startsWith('#')) { const a = state.agents.find(x => x.name === c.agent); if (a) askKill(a); return render(); }
    return run('fund', () => fund(c, label.includes('trust')));
  }
  if (key.startsWith('why:')) { view = { t: 'home' }; return render(); }
  if (key.startsWith('alarm:') && state.alarm) {
    const a = state.alarm;
    if (label.startsWith('#')) return run('kill', () => kill(a.agentId, a.agent, a.agentAddress));
    return run('dismiss', async () => { await api('POST', '/lens/dismiss', { agentId: a.agentId }); flash('Alarm dismissed.'); });
  }
  if (view.t === 'confirmKill' && key.startsWith('ck:')) {
    const v = view; view = { t: 'home' };
    if (label.startsWith('#')) return run('kill', () => kill(v.agentId, v.name, v.address));
    flash('Cancelled.'); return;
  }
  if (view.t === 'confirmGive' && key.startsWith('cg:')) {
    const v = view; view = { t: 'agent', id: v.agentId };
    if (label.startsWith('+')) return run('give', () => give(v.agentId, v.amount));
    flash('Cancelled.'); return;
  }
  if (key.startsWith('agent:') && view.t === 'agent') {
    const a = agentById(view.id); if (!a) return;
    if (label.startsWith('<')) { view = { t: 'home' }; return render(); }
    if (label.startsWith('mic')) return void listenFor(`Try "give ${a.name} 1 more", "pause" or "kill it"`);
    if (label.startsWith('+')) { view = { t: 'confirmGive', agentId: a.id, amount: 0.5 }; return render(); }
    if (label.startsWith('#')) { askKill(a); return render(); }
    return run('pause', () => pause(a.id, a.status !== 'frozen'));
  }
  if (key === 'activity') { view = { t: 'home' }; return render(); }
  if (key === 'home') {
    const target = L.homeTarget(state, index);
    if (target.agent) { view = { t: 'agent', id: target.agent.id }; return render(); }
    if (target.voice) { const n = state.agents.find(a => a.status === 'active')?.name ?? 'my agent'; return void listenFor(`Try "give ${n} 1 more" or "pause ${n}"`); }
    view = { t: 'activity' }; return render();
  }
}

// ---------- voice ----------
let mic: { chunks: Uint8Array[]; resolve: (pcm: Uint8Array) => void } | null = null;
const devVoice = import.meta.env.DEV ? new URLSearchParams(location.search).get('voice')?.split(',') ?? [] : [];

/** Records until ~0.9 s of silence after speech, or `ms`. Returns raw PCM (s16le mono 16 kHz). */
async function record(ms: number): Promise<Uint8Array> {
  if (devVoice.length) { // test harness: replay a recorded phrase as if spoken (dev builds only)
    const name = devVoice.shift()!; await new Promise(r => setTimeout(r, 1200));
    return new Uint8Array(await (await fetch(`/voice-test/${name}.pcm`)).arrayBuffer());
  }
  const done = new Promise<Uint8Array>(resolve => { mic = { chunks: [], resolve }; });
  await serial(() => bridge.audioControl(true, AudioInputSource.Glasses));
  const stop = setTimeout(() => finish(), ms);
  const out = await done; clearTimeout(stop);
  return out;
}
function finish() {
  if (!mic) return;
  const m = mic; mic = null;
  void serial(() => bridge.audioControl(false));
  const len = m.chunks.reduce((s, c) => s + c.length, 0);
  const pcm = new Uint8Array(len); let o = 0; for (const c of m.chunks) { pcm.set(c, o); o += c.length; }
  m.resolve(pcm);
}
let spoke = false, quietMs = 0;
function onAudio(chunk: Uint8Array) {
  if (!mic) return;
  mic.chunks.push(chunk);
  const s = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.length / 2));
  let e = 0; for (const v of s) e += v * v;
  const rms = Math.sqrt(e / Math.max(1, s.length));
  const dur = (s.length / 16000) * 1000;
  if (rms > 900) { spoke = true; quietMs = 0; } else if (spoke) { quietMs += dur; if (quietMs > 900) finish(); }
}

/** Listens for one command. `onCard`: keep the card on screen and listen in the background. */
async function listenFor(hint: string, onCard = false) {
  if (mic) return;
  spoke = false; quietMs = 0;
  if (!onCard) { listeningHint = hint; await render(); }
  try {
    const pcm = await record(onCard ? 6000 : 7000);
    listeningHint = null;
    if (pcm.length < 16000) { if (!onCard) flash('Did not catch that.'); else await render(); return; }
    let b64 = ''; for (let i = 0; i < pcm.length; i += 0x8000) b64 += String.fromCharCode(...pcm.subarray(i, i + 0x8000));
    const { text, intent } = await api('POST', '/lens/voice', { pcm: btoa(b64) });
    const decided = await act(intent as Intent, text);
    // On a request, give one more chance after a refused or unclear answer ("approve" on a flagged one -> "why").
    const c = state?.pending;
    if (onCard && !decided && c && retried !== c.id) { retried = c.id; setTimeout(() => void listenFor('Say "reject", "why" or "kill it"', true), 3800); }
  } catch (e) { listeningHint = null; flash(`Voice failed: ${(e as Error).message}`); }
}

async function act(i: Intent, heard: string): Promise<boolean> {
  if (!state) return false;
  const r = await act2(i, heard);
  return r === true;
}
async function act2(i: Intent, heard: string): Promise<boolean | void> {
  if (!state) return;
  const c = state.pending;
  const agentNamed = (name?: string) => state!.agents.find(a => a.name === name);
  const said = `Heard "${heard}"`;
  switch (i.kind) {
    case 'approve': case 'trust':
      if (!c) return flash(`${said}\nNothing to approve.`);
      // Voice can only approve clean requests. Anything flagged needs a physical tap.
      if (!L.isClean(c)) return flash(`${said}\nThis one is flagged.\nTap to approve it.`, 4000);
      await run('fund', () => fund(c, i.kind === 'trust')); return true;
    case 'reject': case 'no':
      if (view.t === 'confirmKill' || view.t === 'confirmGive') { view = view.t === 'confirmGive' ? { t: 'agent', id: view.agentId } : { t: 'home' }; return flash(`${said}\nCancelled.`); }
      if (c) { await run('reject', () => reject(c)); return true; }
      return flash(said);
    case 'yes':
      if (view.t === 'confirmKill') { const v = view; view = { t: 'home' }; return run('kill', () => kill(v.agentId, v.name, v.address)); }
      if (view.t === 'confirmGive') { const v = view; return run('give', () => give(v.agentId, v.amount)); }
      if (c && L.isClean(c)) return run('fund', () => fund(c, false));
      return flash(said);
    case 'why': if (c) { view = { t: 'why', cardId: c.id }; await render(); return true; } return flash(said);
    case 'kill': {
      if (state.alarm) { const a = state.alarm; return run('kill', () => kill(a.agentId, a.agent, a.agentAddress)); }
      const a = agentNamed(i.agent) ?? (c ? agentNamed(c.agent) : view.t === 'agent' ? agentById(view.id) : undefined);
      if (!a) return flash(`${said}\nKill which agent?`);
      askKill(a); await render(); confirmByVoice(); return true;
    }
    case 'give': {
      const a = agentNamed(i.agent); if (!a) return flash(`${said}\nWhich agent?`);
      view = { t: 'confirmGive', agentId: a.id, amount: Math.min(i.amount, 10) }; await render(); confirmByVoice(); return true;
    }
    case 'pause': case 'resume': {
      const a = agentNamed(i.agent) ?? (view.t === 'agent' ? agentById(view.id) : undefined);
      if (!a) return flash(`${said}\nWhich agent?`);
      return run('pause', () => pause(a.id, i.kind === 'pause'));
    }
    case 'status': return flash(`Today ${state.spentToday} GRAM spent\n${state.atRisk} GRAM at risk in agent wallets\nVault ${state.vaultBalance} GRAM`, 5000);
    default: {
      const n = state.agents.find(a => a.status === 'active')?.name ?? 'my agent';
      return flash(`${said}\nTry "approve", "reject", "why",\n"give ${n} 1 more" or "pause ${n}".`, 4500);
    }
  }
}

/** After a spoken kill/give, the confirm screen listens for "yes" or "no" (a tap works too). */
function confirmByVoice() { setTimeout(() => { if (view.t === 'confirmKill' || view.t === 'confirmGive') void listenFor('Say "yes" or "no"', true); }, 600); }

// ---------- input ----------
bridge.onEvenHubEvent(event => {
  if (event.audioEvent?.audioPcm) { onAudio(event.audioEvent.audioPcm); return; }
  const sys = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null;
  const lst = event.listEvent ? (event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null;
  // Double-tap always exits: Even's rule, so the user can always leave.
  if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || lst === OsEventTypeList.DOUBLE_CLICK_EVENT) { void bridge.shutDownPageContainer(1); return; }
  if (lst === OsEventTypeList.CLICK_EVENT) { if (mic) finish(); void onSelect(event.listEvent!.currentSelectItemIndex ?? 0); return; }
  if (sys === OsEventTypeList.CLICK_EVENT) { if (mic) { finish(); return; } void poll(); return; }
  if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) void poll();
});

// ---------- boot ----------
vault = await loadVault(store);
mountPhone({
  getVault: () => vault, getServer: () => server, getState: () => state,
  async setServer(url) { server = url.replace(/\/$/, ''); await store.set(SERVER_KEY, server); await hello(); },
  async create() { vault = await createVault(store); await hello(); return vault; },
  async import(words) { vault = await importVault(store, words); await hello(); return vault; },
});
async function hello() { if (vault) { await api('POST', '/lens/hello', { vault: vault.address }).catch(() => {}); await poll(); } }
await render();
await hello();
setInterval(poll, 3000);
