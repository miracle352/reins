import {
  waitForEvenAppBridge, TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, TextContainerUpgrade, OsEventTypeList,
} from '@evenrealities/even_hub_sdk';
import { createAgentTx, fundTx, killTx } from '../../shared/vault.ts';
import { loadVault, createVault, importVault, type Vault } from './vault.ts';
import * as L from './lens.ts';
import { mountPhone } from './phone.ts';

const bridge = await waitForEvenAppBridge();
const store = { get: (k: string) => bridge.getLocalStorage(k), set: (k: string, v: string) => bridge.setLocalStorage(k, v) };
const SERVER_KEY = 'reins.server';
let server = (await store.get(SERVER_KEY).catch(() => '')) || (import.meta.env.VITE_REINS_SERVER as string) || 'http://localhost:8787';

// ---------- bridge calls: serialized with a timeout, as the SDK guide requires ----------
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>, ms = 5000): Promise<T> {
  const run = chain.then(() => Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error('bridge timeout')), ms))]));
  chain = run.catch(() => undefined);
  return run;
}

// ---------- page building ----------
const TEXT = { id: 1, name: 'body' };
const LIST = { id: 2, name: 'actions' };
let started = false;
let page: { mode: 'idle' | 'card' | 'alarm' | 'confirm' | 'note'; key: string; items: string[] } = { mode: 'note', key: '', items: [] };

const text = (content: string, h: number, capture: boolean) => new TextContainerProperty({
  xPosition: 0, yPosition: 0, width: 576, height: h, borderWidth: 0, borderColor: 0, paddingLength: 6,
  containerID: TEXT.id, containerName: TEXT.name, content, isEventCapture: capture ? 1 : 0,
});
const list = (items: string[]) => new ListContainerProperty({
  xPosition: 0, yPosition: 176, width: 576, height: 112, borderWidth: 1, borderColor: 6, borderRadius: 6, paddingLength: 4,
  containerID: LIST.id, containerName: LIST.name, isEventCapture: 1,
  itemContainer: new ListItemContainerProperty({ itemCount: items.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: items }),
});

async function show(mode: typeof page.mode, key: string, body: string, items: string[] = []) {
  if (page.mode === mode && page.key === key) {
    if (!items.length) await serial(() => bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: TEXT.id, containerName: TEXT.name, content: body })));
    return;
  }
  page = { mode, key, items };
  const textObject = [text(body, items.length ? 176 : 288, !items.length)];
  const listObject = items.length ? [list(items)] : undefined;
  const containerTotalNum = items.length ? 2 : 1;
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
let vault: Vault | null = null;
let state: L.State | null = null;
let busy = false;
let note: { text: string; until: number } | null = null;
let killTarget: { agentId: string; name: string; address: string } | null = null;

const flash = (t: string, ms = 4000) => { note = { text: t, until: Date.now() + ms }; void render(); };

async function render() {
  if (!vault) return show('note', 'setup', 'REINS\n\nOpen Reins on your phone to create\nor import your vault.');
  if (note && Date.now() < note.until) return show('note', note.text, note.text);
  note = null;
  if (!state) return show('note', 'loading', 'REINS\n\nConnecting to your Reins server…');
  if (killTarget) return show('confirm', killTarget.agentId, L.confirmKillText(killTarget.name), L.confirmKillActions());
  if (state.alarm) return show('alarm', state.alarm.agentId + state.alarm.text, L.alarmText(state.alarm, state.atRisk), L.alarmActions(state.alarm));
  if (state.pending) return show('card', state.pending.id, L.cardText(state.pending, state.pendingCount), L.cardActions(state.pending));
  return show('idle', 'idle', L.idleText(state));
}

async function poll() {
  if (!vault) return;
  try { state = await api('GET', '/lens/state'); }
  catch (e) { state = null; flash(`Server unreachable\n${server}\n${(e as Error).message}`, 3000); return; }
  if (!busy) await render();
}

// ---------- decisions ----------
async function decide(index: number) {
  if (busy || !vault || !state) return;
  const label = page.items[index] ?? '';
  busy = true;
  try {
    if (page.mode === 'card' && state.pending) {
      const c = state.pending;
      if (label.startsWith('x')) { await api('POST', '/lens/decide', { requestId: c.id, action: 'reject' }); flash(`Rejected.\n${c.agent} was told no.`); }
      else if (label.startsWith('#')) { killTarget = { agentId: agentIdOf(c.agent), name: c.agent, address: c.agentAddress }; }
      else {
        flash('Signing with your vault…', 20000);
        const seq = await vaultSeqno(vault);
        const boc = c.kind === 'create'
          ? createAgentTx(vault.keys, seq, c.operatorPub, BigInt(c.amountNano))
          : fundTx(vault.keys, seq, c.agentAddress, BigInt(c.amountNano));
        const trust = label.includes('trust');
        await api('POST', '/lens/decide', { requestId: c.id, action: trust ? 'trust' : 'fund', boc, name: c.toName });
        flash(c.kind === 'create' ? `Wallet created for ${c.agent}.` : `Sent exactly ${c.amount} GRAM.\n${c.agent} can pay now.${trust ? '\nPayee trusted.' : ''}`);
      }
    } else if (page.mode === 'alarm' && state.alarm) {
      const a = state.alarm;
      if (label.startsWith('#')) await kill(a.agentId, a.agent, a.agentAddress);
      else { await api('POST', '/lens/dismiss', { agentId: a.agentId }); flash('Alarm dismissed.'); }
    } else if (page.mode === 'confirm' && killTarget) {
      const t = killTarget; killTarget = null;
      if (label.startsWith('#')) await kill(t.agentId, t.name, t.address);
      else flash('Cancelled.');
    }
  } catch (e) { flash(`Failed: ${(e as Error).message}`, 6000); }
  finally { busy = false; await poll(); }
}

const agentIdOf = (name: string) => state!.agents.find(a => a.name === name)!.id;

async function kill(agentId: string, name: string, address: string) {
  flash(`Killing ${name}…`, 20000);
  const boc = killTx(vault!.keys, await vaultSeqno(vault!), address);
  await api('POST', '/lens/kill', { agentId, boc });
  flash(`${name} is dead.\nKey revoked on chain.\nFunds swept to your vault.`, 6000);
}

// ---------- input ----------
bridge.onEvenHubEvent(event => {
  const sys = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null;
  const lst = event.listEvent ? (event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null;
  // Double-tap always exits: Even's rule, so the user can always leave.
  if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || lst === OsEventTypeList.DOUBLE_CLICK_EVENT) { void bridge.shutDownPageContainer(1); return; }
  if (lst === OsEventTypeList.CLICK_EVENT) { void decide(event.listEvent!.currentSelectItemIndex ?? 0); return; }
  if (sys === OsEventTypeList.CLICK_EVENT && page.mode === 'idle') { void poll(); return; }
  if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) void poll();
});

// ---------- boot ----------
vault = await loadVault(store);
mountPhone({
  getVault: () => vault,
  getServer: () => server,
  getState: () => state,
  async setServer(url) { server = url.replace(/\/$/, ''); await store.set(SERVER_KEY, server); await hello(); },
  async create() { vault = await createVault(store); await hello(); return vault; },
  async import(words) { vault = await importVault(store, words); await hello(); return vault; },
});
async function hello() { if (vault) { await api('POST', '/lens/hello', { vault: vault.address }).catch(() => {}); await poll(); } }
await render();
await hello();
setInterval(poll, 3000);
