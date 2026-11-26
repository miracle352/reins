import {
  waitForEvenAppBridge, TextContainerProperty, ListContainerProperty, ListItemContainerProperty, ImageContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, TextContainerUpgrade, ImageRawDataUpdate, OsEventTypeList, AudioInputSource,
} from '@evenrealities/even_hub_sdk';
import { toNano } from '@ton/core';
import { createAgentTx, fundTx, killTx } from '../../shared/vault.ts';
import type { Intent } from '../../shared/intent.ts';
import { signLogin } from '../../shared/auth.ts';
import { loadVault, createVault, importVault, type Vault } from './vault.ts';
import * as L from './lens.ts';
import { mountPhone } from './phone.ts';

const bridge = await waitForEvenAppBridge();
const store = { get: (k: string) => bridge.getLocalStorage(k), set: (k: string, v: string) => bridge.setLocalStorage(k, v) };
const SERVER_KEY = 'reins.server';
let server = (await store.get(SERVER_KEY).catch(() => '')) || (import.meta.env.VITE_REINS_SERVER as string) || 'http://localhost:8787';

// ---------- bridge calls: serialized with a timeout, as the SDK guide requires ----------
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>, ms = 6000): Promise<T> {
  const run = queue.then(() => Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('bridge timeout')), ms))]));
  queue = run.catch(() => undefined);
  return run;
}

// ---------- rendering ----------
// Text boxes use ids 1..7, the list 8, images 10..13.
let started = false;
let shown: { key: string; shape: string; texts: string[]; images: string[]; actions: L.Action[] } = { key: '', shape: '', texts: [], images: [], actions: [] };
let renderSeq = 0;

const shapeOf = (p: L.Page) => JSON.stringify([p.texts.map(t => [t.x, t.y, t.w, t.h]), p.images?.map(i => [i.x, i.y, i.w, i.h]), p.items, p.listTop]);

async function show(key: string, p: L.Page) {
  const seq = ++renderSeq;
  const shape = shapeOf(p);
  const hasList = !!p.items?.length;
  if (shown.key === key && shown.shape === shape) {
    // Same screen: update only the text that changed (flicker-free), redraw only images that changed.
    for (let i = 0; i < p.texts.length; i++) {
      if (shown.texts[i] === p.texts[i].content) continue;
      shown.texts[i] = p.texts[i].content;
      await serial(() => bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: i + 1, containerName: `t${i}`, content: p.texts[i].content })));
    }
    await sendImages(p, seq, true);
    return;
  }
  shown = { key, shape, texts: p.texts.map(t => t.content), images: [], actions: p.actions ?? [] };
  const textObject = p.texts.map((t, i) => new TextContainerProperty({
    xPosition: t.x, yPosition: t.y, width: t.w, height: t.h, borderWidth: 0, borderColor: 0, paddingLength: 2,
    containerID: i + 1, containerName: `t${i}`, content: t.content || ' ', isEventCapture: !hasList && i === 0 ? 1 : 0,
  }));
  const listObject = hasList ? [new ListContainerProperty({
    xPosition: 0, yPosition: p.listTop ?? 176, width: 576, height: 288 - (p.listTop ?? 176), borderWidth: 1, borderColor: 5, borderRadius: 8, paddingLength: 4,
    containerID: 8, containerName: 'actions', isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({ itemCount: p.items!.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: p.items }),
  })] : undefined;
  const imageObject = p.images?.map((im, i) => new ImageContainerProperty({ xPosition: im.x, yPosition: im.y, width: im.w, height: im.h, containerID: 10 + i, containerName: `i${i}` }));
  const containerTotalNum = textObject.length + (listObject?.length ?? 0) + (imageObject?.length ?? 0);
  const page = { containerTotalNum, textObject, listObject, imageObject };
  if (!started) { started = true; await serial(() => bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))); }
  else await serial(() => bridge.rebuildPageContainer(new RebuildPageContainer(page)));
  await sendImages(p, seq, false);
}

/** Images go one at a time after the text, so the decision is readable before the art arrives. */
async function sendImages(p: L.Page, seq: number, onlyChanged: boolean) {
  for (const [i, im] of (p.images ?? []).entries()) {
    if (onlyChanged && shown.images[i] === im.key) continue;
    const bytes = await im.draw();
    if (seq !== renderSeq) return; // the screen moved on
    const r = await serial(() => bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: 10 + i, containerName: `i${i}`, imageData: bytes })), 8000).catch(e => String(e));
    if (r === 'success') shown.images[i] = im.key; else console.warn('image', im.key, r);
  }
}

// ---------- server ----------
// The device logs in once by signing with the vault key; the server hands back a token for this device.
const TOKEN_KEY = 'reins.token';
let token = await store.get(TOKEN_KEY).catch(() => '');
async function login() {
  if (!vault) return;
  const { ts, sig } = signLogin(vault.keys.secretKey, vault.address);
  const j = await raw('POST', '/lens/login', { pub: vault.keys.publicKey.toString('hex'), ts, sig });
  token = j.token; await store.set(TOKEN_KEY, token);
}
async function raw(method: string, path: string, body?: unknown) {
  const r = await fetch(server + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
  return j;
}
async function api(method: string, path: string, body?: unknown) {
  if (!token) await login();
  try { return await raw(method, path, body); }
  catch (e: any) { if (e.status !== 401 || !vault) throw e; await login(); return raw(method, path, body); }
}
const vaultSeqno = async (v: Vault) => (await api('GET', `/chain/wallet/${v.address}`)).seqno as number;

// ---------- app state ----------
type View =
  | { t: 'home' } | { t: 'agent'; id: string } | { t: 'activity' } | { t: 'why'; cardId: string }
  | { t: 'confirmKill'; agentId: string; name: string; address: string; back: View }
  | { t: 'confirmGive'; agentId: string; amount: number };
let vault: Vault | null = null;
let state: L.State | null = null;
let view: View = { t: 'home' };
let busy = false;
let listen: { hint: string; level: number } | null = null;
let overlay: { page: L.Page; key: string; until: number } | null = null;
let splashUntil = Date.now() + 1800;
let heardFor = '', retried = '';

const showResult = (headline: string, detail: string, ms = 3200) => { overlay = { page: L.result(headline, detail), key: 'res:' + headline + detail, until: Date.now() + ms }; void render(); };
const showNote = (text: string, ms = 3500) => { overlay = { page: L.note(text), key: 'note:' + text, until: Date.now() + ms }; void render(); };
const agentById = (id: string) => state?.agents.find(a => a.id === id);

/** What is on the lens. Alarms and requests interrupt browsing, never a confirm you started. */
function current(): { key: string; page: L.Page } {
  if (Date.now() < splashUntil) return { key: 'splash', page: L.splashPage('Your agents spend. You hold the reins.') };
  if (!vault) return { key: 'setup', page: L.note('REINS\n\nOpen Reins on your phone to create\nor import your vault.') };
  if (overlay && Date.now() < overlay.until) return { key: overlay.key, page: overlay.page };
  if (listen) return { key: 'listen', page: L.listening(listen.hint, listen.level) };
  if (!state) return { key: 'loading', page: L.note('REINS\n\nConnecting to your Reins server…') };
  if (view.t === 'confirmKill') return { key: 'ck:' + view.agentId, page: L.confirmKill(view.name, agentById(view.agentId)?.balance ?? '0') };
  if (view.t === 'confirmGive') { const a = agentById(view.agentId); if (a) return { key: 'cg:' + view.agentId, page: L.confirmGive(a, view.amount) }; }
  if (state.alarm) return { key: 'alarm:' + state.alarm.agentId + state.alarm.text, page: L.alarm(state.alarm, state.atRisk) };
  if (view.t === 'why' && state.pending?.id === view.cardId) return { key: 'why:' + view.cardId, page: L.why(state.pending) };
  if (state.pending) return { key: 'card:' + state.pending.id, page: L.card(state.pending, state.pendingCount) };
  if (view.t === 'agent') { const a = agentById(view.id); if (a) return { key: 'agent:' + a.id, page: L.agentPage(a) }; }
  if (view.t === 'activity') return { key: 'activity', page: L.activity(state) };
  return { key: 'home', page: L.home(state) };
}

async function render() {
  if (overlay && Date.now() >= overlay.until) overlay = null;
  const c = current();
  await show(c.key, c.page);
  // Hands-free: when a new request lands, listen once for a short answer.
  const p = state?.pending;
  if (p && c.key === 'card:' + p.id && heardFor !== p.id && !busy) {
    heardFor = p.id;
    void listenFor(L.isClean(p) ? 'Say "approve" or "reject"' : 'Say "reject", "why" or "kill it"', true);
  }
}

async function poll() {
  if (!vault) return;
  try { state = await api('GET', '/lens/state'); }
  catch (e) { state = null; showNote(`Server unreachable\n${server}\n${(e as Error).message}`, 3000); return; }
  if (!busy) await render();
}

// ---------- actions ----------
async function run(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (e) { showNote(`Failed: ${(e as Error).message}`, 6000); }
  finally { busy = false; await poll(); }
}

async function fund(c: L.Card, trust: boolean) {
  showResult('SIGNING', 'with the vault key on your phone…', 20000);
  const seq = await vaultSeqno(vault!);
  const boc = c.kind === 'create'
    ? createAgentTx(vault!.keys, seq, c.operatorPub, BigInt(c.amountNano))
    : fundTx(vault!.keys, seq, c.agentAddress, BigInt(c.amountNano));
  await api('POST', '/lens/decide', { requestId: c.id, action: trust ? 'trust' : 'fund', boc, name: c.toName });
  if (c.kind === 'create') showResult('CREATED', `${c.agent} has a wallet with ${c.amount} GRAM.\nAnything beyond its rules comes back here.`);
  else showResult(`SENT ${c.amount}`, `Exactly ${c.amount} GRAM to ${c.agent}. It can pay now.${trust ? '\n★ Payee trusted from now on.' : ''}`);
}
async function reject(c: L.Card) { await api('POST', '/lens/decide', { requestId: c.id, action: 'reject' }); showResult('REJECTED', `${c.agent} was told no. Nothing moved.`); }
async function kill(agentId: string, name: string, address: string) {
  const bal = agentById(agentId)?.balance ?? '';
  showResult('KILLING', `Revoking ${name}'s key on chain…`, 20000);
  const boc = killTx(vault!.keys, await vaultSeqno(vault!), address);
  await api('POST', '/lens/kill', { agentId, boc });
  view = { t: 'home' };
  showResult('KILLED', `${name}'s key is revoked on chain.\n${bal ? bal + ' GRAM' : 'Its funds'} swept back to your vault.`, 4500);
}
async function give(agentId: string, amount: number) {
  const a = agentById(agentId)!;
  showResult('SENDING', `${amount} GRAM from your vault to ${a.name}…`, 20000);
  const boc = fundTx(vault!.keys, await vaultSeqno(vault!), a.address, toNano(String(amount)) - toNano('0.02'));
  const r = await api('POST', '/lens/give', { agentId, amount: String(amount), boc });
  view = { t: 'agent', id: agentId };
  showResult(`SENT ${amount}`, `${a.name}'s budget today: ${r.daily} GRAM.`);
}
async function pause(agentId: string, on: boolean) {
  await api('POST', '/lens/pause', { agentId, on });
  showResult(on ? 'PAUSED' : 'RESUMED', on ? `${agentById(agentId)?.name} asks nothing and gets nothing.` : `${agentById(agentId)?.name} is back to work.`);
}
const askKill = (a: { id: string; name: string; address: string }) => { view = { t: 'confirmKill', agentId: a.id, name: a.name, address: a.address, back: view }; };

async function onSelect(index: number) {
  if (!vault || !state || busy) return;
  const action = shown.actions[index];
  const key = shown.key;
  const c = state.pending;
  switch (action) {
    case 'approve': case 'trust': if (c && key.startsWith('card:')) return run(() => fund(c, action === 'trust')); return;
    case 'reject': if (c) return run(() => reject(c)); return;
    case 'kill': {
      if (key.startsWith('alarm:') && state.alarm) { const a = state.alarm; return run(() => kill(a.agentId, a.agent, a.agentAddress)); }
      const a = key.startsWith('card:') && c ? state.agents.find(x => x.name === c.agent) : view.t === 'agent' ? agentById(view.id) : undefined;
      if (a) { askKill(a); return render(); }
      return;
    }
    case 'dismiss': if (state.alarm) { const a = state.alarm; return run(async () => { await api('POST', '/lens/dismiss', { agentId: a.agentId }); showNote('Alarm dismissed.'); }); } return;
    case 'cancel': view = view.t === 'confirmGive' ? { t: 'agent', id: view.agentId } : view.t === 'confirmKill' ? view.back : { t: 'home' }; showNote('Cancelled.', 1500); return;
    case 'yesKill': if (view.t === 'confirmKill') { const v = view; view = { t: 'home' }; return run(() => kill(v.agentId, v.name, v.address)); } return;
    case 'yesGive': if (view.t === 'confirmGive') { const v = view; return run(() => give(v.agentId, v.amount)); } return;
    case 'back': view = view.t === 'why' ? { t: 'home' } : { t: 'home' }; return render();
    case 'voice': {
      const n = view.t === 'agent' ? agentById(view.id)?.name : state.agents.find(a => a.status === 'active')?.name;
      return void listenFor(n ? `Try "give ${n} 1 more", "pause ${n}"\nor "how much today"` : 'Try "how much today".\nWith an agent: "give <name> 1 more", "pause <name>".');
    }
    case 'activity': view = { t: 'activity' }; return render();
    case 'give': if (view.t === 'agent') { view = { t: 'confirmGive', agentId: view.id, amount: 0.5 }; return render(); } return;
    case 'pause': case 'resume': if (view.t === 'agent') { const id = view.id; return run(() => pause(id, action === 'pause')); } return;
    default:
      if (action?.startsWith('agent:')) { view = { t: 'agent', id: action.slice(6) }; return render(); }
  }
}

// ---------- voice ----------
let mic: { chunks: Uint8Array[]; resolve: (pcm: Uint8Array) => void } | null = null;
// Dev-only test harness: replays recorded phrases. Remembers what it used, so a hot reload never replays a command.
const devVoice = import.meta.env.DEV
  ? (new URLSearchParams(location.search).get('voice')?.split(',') ?? []).slice(Number(sessionStorage.getItem('reins.voiceUsed') ?? 0))
  : [];

/** Records until ~0.9 s of silence after speech, or `ms`. Returns raw PCM (s16le mono 16 kHz). */
async function record(ms: number): Promise<Uint8Array> {
  if (devVoice.length) {
    const name = devVoice.shift()!;
    sessionStorage.setItem('reins.voiceUsed', String(Number(sessionStorage.getItem('reins.voiceUsed') ?? 0) + 1));
    for (const lv of [0.2, 0.6, 0.9, 0.7, 0.4, 0.1]) { if (listen) { listen.level = lv; void render(); } await new Promise(r => setTimeout(r, 200)); }
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
let spoke = false, quietMs = 0, lastMeter = 0;
function onAudio(chunk: Uint8Array) {
  if (!mic) return;
  mic.chunks.push(chunk);
  const s = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.length / 2));
  let e = 0; for (const v of s) e += v * v;
  const rms = Math.sqrt(e / Math.max(1, s.length));
  if (listen && Date.now() - lastMeter > 150) { lastMeter = Date.now(); listen.level = Math.min(1, rms / 6000); void render(); }
  const dur = (s.length / 16000) * 1000;
  if (rms > 900) { spoke = true; quietMs = 0; } else if (spoke) { quietMs += dur; if (quietMs > 900) finish(); }
}

/** Listens for one command. `onCard`: keep the decision on screen and listen in the background. */
async function listenFor(hint: string, onCard = false) {
  if (mic) return;
  spoke = false; quietMs = 0;
  if (!onCard) { listen = { hint, level: 0 }; await render(); }
  try {
    const pcm = await record(onCard ? 6000 : 7000);
    listen = null;
    if (pcm.length < 16000) { if (!onCard) showNote('Did not catch that.', 2000); else await render(); return; }
    if (!onCard) showNote('…', 4000);
    let b64 = ''; for (let i = 0; i < pcm.length; i += 0x8000) b64 += String.fromCharCode(...pcm.subarray(i, i + 0x8000));
    const { text, intent } = await api('POST', '/lens/voice', { pcm: btoa(b64) });
    if (overlay?.key === 'note:…') overlay = null;
    const decided = await act(intent as Intent, text);
    // On a request, one more chance after a refused or unclear answer ("approve" on a flagged one, then "why").
    const c = state?.pending;
    if (onCard && !decided && c && retried !== c.id) { retried = c.id; setTimeout(() => void listenFor('Say "reject", "why" or "kill it"', true), 3800); }
  } catch (e) { listen = null; showNote(`Voice failed: ${(e as Error).message}`); }
}

/** After a spoken kill/give, the confirm listens for "yes" or "no" (a tap works too). */
function confirmByVoice() { setTimeout(() => { if (view.t === 'confirmKill' || view.t === 'confirmGive') void listenFor('Say "yes" or "no"', true); }, 900); }

async function act(i: Intent, heard: string): Promise<boolean> {
  if (!state) return false;
  const c = state.pending;
  const said = `Heard "${heard}"`;
  const named = (name?: string) => state!.agents.find(a => a.name === name);
  switch (i.kind) {
    case 'approve': case 'trust':
      if (!c) { showNote(`${said}\nNothing to approve.`); return false; }
      // Voice can only approve clean requests. Anything flagged needs a physical tap.
      if (!L.isClean(c)) { showNote(`${said}\n\nThis one is flagged.\nTap to approve it.`, 3600); return false; }
      await run(() => fund(c, i.kind === 'trust')); return true;
    case 'reject': case 'no':
      if (view.t === 'confirmKill' || view.t === 'confirmGive') { view = view.t === 'confirmGive' ? { t: 'agent', id: view.agentId } : view.back; showNote(`${said}\nCancelled.`, 2000); return true; }
      if (c) { await run(() => reject(c)); return true; }
      showNote(said); return false;
    case 'yes':
      if (view.t === 'confirmKill') { const v = view; view = { t: 'home' }; await run(() => kill(v.agentId, v.name, v.address)); return true; }
      if (view.t === 'confirmGive') { const v = view; await run(() => give(v.agentId, v.amount)); return true; }
      if (c && L.isClean(c)) { await run(() => fund(c, false)); return true; }
      showNote(said); return false;
    case 'why': if (c) { view = { t: 'why', cardId: c.id }; await render(); return true; } showNote(said); return false;
    case 'kill': {
      if (state.alarm) { const a = state.alarm; await run(() => kill(a.agentId, a.agent, a.agentAddress)); return true; }
      const a = named(i.agent) ?? (c ? named(c.agent) : view.t === 'agent' ? agentById(view.id) : undefined);
      if (!a) { showNote(`${said}\nKill which agent?`); return false; }
      askKill(a); await render(); confirmByVoice(); return true;
    }
    case 'give': {
      const a = named(i.agent); if (!a) { showNote(`${said}\nWhich agent?`); return false; }
      view = { t: 'confirmGive', agentId: a.id, amount: Math.min(i.amount, 10) }; await render(); confirmByVoice(); return true;
    }
    case 'pause': case 'resume': {
      const a = named(i.agent) ?? (view.t === 'agent' ? agentById(view.id) : undefined);
      if (!a) { showNote(`${said}\nWhich agent?`); return false; }
      await run(() => pause(a.id, i.kind === 'pause')); return true;
    }
    case 'status': showResult(`${state.spentToday} GRAM`, `spent today   ·   ${state.atRisk} at risk   ·   vault ${state.vaultBalance}`, 5000); return true;
    default: {
      const n = state.agents.find(a => a.status === 'active')?.name ?? 'my agent';
      showNote(`${said}\n\nTry "approve", "reject", "why",\n"give ${n} 1 more" or "pause ${n}".`, 4500); return false;
    }
  }
}

// ---------- input ----------
bridge.onEvenHubEvent(event => {
  if (event.audioEvent?.audioPcm) { onAudio(event.audioEvent.audioPcm); return; }
  const sys = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null;
  const lst = event.listEvent ? (event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null;
  // Double-tap always exits: Even's rule, so the user can always leave.
  if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || lst === OsEventTypeList.DOUBLE_CLICK_EVENT) { void bridge.shutDownPageContainer(1); return; }
  if (lst === OsEventTypeList.CLICK_EVENT) { if (mic) finish(); void onSelect(event.listEvent!.currentSelectItemIndex ?? 0); return; }
  if (sys === OsEventTypeList.CLICK_EVENT) { if (mic) { finish(); return; } overlay = null; void poll(); return; }
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
async function hello() { if (vault) { token = ''; await api('POST', '/lens/hello').catch(e => console.warn('hello', e.message)); await poll(); } }
await render();
setTimeout(() => void render(), 1900); // leave the splash
await hello();
setInterval(poll, 3000);
