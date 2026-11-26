// Reins server: relays between agents (kit) and the glasses (lens), applies the rules, watches the chain.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Address } from '@ton/core';
import { agentAddress, fmt, fmtUser } from '../../shared/ton.ts';
import * as chain from './chain.ts';
import { db, save, log, id, type Agent, type Req } from './store.ts';
import { evaluate, DEFAULT_LIMITS, gram, toNanoStr } from './policy.ts';
import { startTelegram } from './telegram.ts';

const PORT = Number(process.env.PORT ?? 8787);
const BUFFER = toNanoStr(process.env.REINS_BUFFER ?? '0.3');
const TOKEN = process.env.REINS_TOKEN; // optional shared secret
const DAY = 86_400_000;

// --- small cache so the lens can poll every few seconds without hammering toncenter ---
const cache = new Map<string, { at: number; v: any }>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  const v = await fn(); cache.set(key, { at: Date.now(), v }); return v;
}
const agentBal = (a: Agent) => cached(`bal:${a.address}`, 8000, () => chain.balance(a.address));

const agentOf = (agentId: string) => db.agents.find(a => a.id === agentId);
function spentToday(agentId: string) {
  return db.requests
    .filter(r => r.agentId === agentId && r.kind === 'pay' && ['approved', 'paid'].includes(r.status) && Date.now() - r.createdAt < DAY)
    .reduce((s, r) => s + BigInt(r.amount!), 0n);
}
function cardFor(r: Req) {
  const a = agentOf(r.agentId);
  const contact = r.to ? db.contacts.find(c => { try { return Address.parse(c.address).equals(Address.parse(r.to!)); } catch { return false; } }) : undefined;
  return {
    id: r.id, kind: r.kind, agent: a?.name, purpose: r.purpose, flags: r.flags,
    amount: r.kind === 'create' ? gram(BUFFER) : gram(BigInt(r.amount!)),
    amountNano: r.kind === 'create' ? BUFFER.toString() : r.amount,
    to: r.to, toName: contact?.name, agentAddress: a?.address, operatorPub: a?.operatorPub,
  };
}

// --- routes ---
type H = (body: any, params: string[]) => Promise<any>;
const routes: [string, RegExp, H][] = [];
const route = (m: string, p: RegExp, h: H) => routes.push([m, p, h]);
class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

// Kit (the agent side)
route('POST', /^\/kit\/agents$/, async b => {
  if (!db.vault) throw new HttpError(409, 'Open Reins on your glasses first so it can create your vault.');
  const pub = BigInt('0x' + String(b.operatorPub));
  const existing = db.agents.find(a => a.operatorPub === b.operatorPub);
  if (existing) return { agentId: existing.id, address: existing.address, status: existing.status };
  const { index, address } = agentAddress(Address.parse(db.vault), pub);
  const agent: Agent = { id: id(), name: String(b.name ?? 'agent').slice(0, 20), operatorPub: b.operatorPub, address: fmt(address), index: index.toString(), status: 'awaiting_create', createdAt: Date.now() };
  db.agents.push(agent);
  db.requests.push({ id: id(), agentId: agent.id, kind: 'create', purpose: `New agent wants a wallet`, flags: [], status: 'pending', auto: false, createdAt: Date.now() });
  log(`${agent.name} asked for a wallet`, 'info', { agentId: agent.id, requestId: db.requests[db.requests.length - 1].id }); save();
  return { agentId: agent.id, address: agent.address, status: agent.status };
});

route('GET', /^\/kit\/agents\/(\w+)$/, async (_b, [aid]) => {
  const a = agentOf(aid); if (!a) throw new HttpError(404, 'unknown agent');
  const st = await cached(`st:${a.address}`, 6000, () => chain.state(a.address));
  const seq = st === 'active' ? await cached(`seq:${a.address}`, 3000, () => chain.seqno(a.address)) : 0;
  return { ...a, chainState: st, balance: st === 'active' ? (await agentBal(a)).toString() : '0', seqno: seq };
});

route('POST', /^\/kit\/pay$/, async b => {
  const a = agentOf(b.agentId); if (!a) throw new HttpError(404, 'unknown agent');
  if (a.status === 'revoked') throw new HttpError(403, 'This agent was revoked by its owner.');
  if (a.frozen) throw new HttpError(403, 'This agent is frozen by its owner. Do not retry.');
  if (a.status !== 'active') throw new HttpError(409, 'Agent wallet not created yet. Approve it on your glasses.');
  const amount = toNanoStr(String(b.amount));
  const purpose = String(b.purpose ?? '').slice(0, 140);
  const pendingSpend = db.requests.filter(r => r.agentId === a.id && r.status === 'approved' && r.kind === 'pay').reduce((s, r) => s + BigInt(r.amount!), 0n);
  const bufferLeft = (await agentBal(a)) - pendingSpend - 20_000_000n;
  const v = evaluate({ to: String(b.to), amount, purpose, contacts: db.contacts, spentToday: spentToday(a.id), limits: DEFAULT_LIMITS, bufferLeft });
  const r: Req = { id: id(), agentId: a.id, kind: 'pay', to: String(b.to), amount: amount.toString(), purpose, flags: v.flags, status: v.auto ? 'approved' : 'pending', auto: v.auto, createdAt: Date.now(), decidedAt: v.auto ? Date.now() : undefined };
  db.requests.push(r);
  log(v.auto
    ? `Auto-approved ${gram(amount)} → ${v.contact!.name} (${a.name})`
    : `${a.name} asks ${gram(amount)} GRAM${v.flags.length ? ' !! ' + v.flags.map(f => f.text).join(', ') : ''}`, v.flags.length ? 'warn' : 'info', { agentId: a.id, requestId: v.auto ? undefined : r.id });
  save();
  return r;
});

route('GET', /^\/kit\/requests\/(\w+)$/, async (_b, [rid]) => {
  const r = db.requests.find(x => x.id === rid); if (!r) throw new HttpError(404, 'unknown request');
  return r;
});

route('POST', /^\/kit\/requests\/(\w+)\/result$/, async (b, [rid]) => {
  const r = db.requests.find(x => x.id === rid); if (!r) throw new HttpError(404, 'unknown request');
  soon();
  r.status = b.ok ? 'paid' : 'failed'; r.payTx = b.tx; r.note = b.note;
  const a = agentOf(r.agentId)!;
  cache.delete(`bal:${a.address}`);
  log(b.ok ? `${a.name} paid ${gram(BigInt(r.amount!))} → ${r.to!.slice(-6)}` : `${a.name} payment failed: ${b.note}`, b.ok ? 'info' : 'warn');
  save(); return r;
});

route('POST', /^\/chain\/send$/, async b => ({ hash: await chain.sendBoc(String(b.boc)) }));
route('GET', /^\/chain\/wallet\/([\w-]+)$/, async (_b, [addr]) => {
  const st = await chain.state(addr);
  return { state: st, seqno: st === 'active' ? await chain.seqno(addr) : 0, balance: (await chain.balance(addr)).toString() };
});

// Lens (the glasses side)
route('POST', /^\/lens\/hello$/, async b => {
  const vault = fmtUser(Address.parse(String(b.vault)));
  if (db.vault !== vault) { db.vault = vault; log(`Vault ready: ${vault.slice(0, 6)}…${vault.slice(-4)}`); save(); }
  return { ok: true, buffer: BUFFER.toString(), pairCode: db.telegramChat ? null : db.pairCode };
});

route('GET', /^\/lens\/state$/, async () => {
  const vaultBal = db.vault ? await cached('vault', 10_000, () => chain.balance(db.vault!)) : 0n;
  let atRisk = 0n;
  for (const a of db.agents.filter(a => a.status === 'active')) atRisk += await agentBal(a);
  const pending = db.requests.filter(r => r.status === 'pending').sort((x, y) => x.createdAt - y.createdAt);
  const alarmAgent = db.agents.find(a => a.status === 'active' && (a.alarm || a.frozen));
  const alarm = alarmAgent ? { ...alarmAgent, alarm: alarmAgent.alarm ?? 'Frozen from Telegram. Its buffer is still in its wallet.' } : undefined;
  return {
    vault: db.vault, vaultBalance: gram(vaultBal), atRisk: gram(atRisk),
    agents: db.agents.map(a => ({ id: a.id, name: a.name, status: a.frozen && a.status === 'active' ? 'frozen' : a.status })),
    alarm: alarm ? { agentId: alarm.id, agent: alarm.name, text: alarm.alarm, agentAddress: alarm.address } : null,
    pending: pending[0] ? cardFor(pending[0]) : null, pendingCount: pending.length,
    ticker: db.events.slice(0, 3).map(e => e.text),
    telegram: db.telegramChat ? 'linked' : db.pairCode ?? null,
  };
});

route('POST', /^\/lens\/decide$/, async b => {
  const r = db.requests.find(x => x.id === b.requestId);
  if (!r || r.status !== 'pending') throw new HttpError(409, 'Already decided.');
  const a = agentOf(r.agentId)!;
  if (b.action === 'reject') {
    r.status = 'rejected'; r.decidedAt = Date.now();
    log(`Rejected ${a.name}: ${r.kind === 'create' ? 'new wallet' : gram(BigInt(r.amount!)) + ' GRAM'}`, 'warn');
    if (r.kind === 'create') db.agents = db.agents.filter(x => x.id !== a.id);
    save(); return r;
  }
  if (!b.boc) throw new HttpError(400, 'missing signed vault transaction');
  r.fundTx = await chain.sendBoc(String(b.boc));
  r.status = 'approved'; r.decidedAt = Date.now();
  cache.delete('vault'); cache.delete(`bal:${a.address}`); cache.delete(`st:${a.address}`);
  if (b.action === 'trust' && r.to && !db.contacts.some(c => c.address === r.to)) {
    db.contacts.push({ address: r.to, name: String(b.name ?? `contact ${r.to.slice(-4)}`), trusted: true, autoLimit: r.amount! });
  }
  soon(); setTimeout(() => void watchdog(), 12000);
  log(r.kind === 'create' ? `Created wallet for ${a.name} (${gram(BUFFER)} buffer)` : `Funded ${a.name} ${gram(BigInt(r.amount!))} GRAM`);
  save(); return r;
});

route('POST', /^\/lens\/kill$/, async b => {
  const a = agentOf(b.agentId); if (!a) throw new HttpError(404, 'unknown agent');
  await chain.sendBoc(String(b.boc));
  a.status = 'revoked'; a.alarm = undefined;
  for (const r of db.requests) if (r.agentId === a.id && r.status === 'pending') { r.status = 'rejected'; r.note = 'agent revoked'; }
  log(`KILLED ${a.name}: key revoked, funds swept to vault`, 'alarm');
  save(); return { ok: true };
});

route('POST', /^\/lens\/dismiss$/, async b => {
  const a = agentOf(b.agentId); if (a) { a.alarm = undefined; a.frozen = false; log(`Alarm on ${a.name} dismissed`); save(); }
  return { ok: true };
});

// --- watchdog: every outgoing transfer must match something you or your rules approved ---
let watching = false;
async function watchdog() {
  if (watching) return; watching = true;
  try { await watchOnce(); } finally { watching = false; }
}
const soon = () => setTimeout(() => void watchdog(), 4000);
async function watchOnce() {
  for (const a of db.agents) {
    if (a.status === 'revoked') continue;
    try {
      if (a.status === 'awaiting_create') {
        const approved = db.requests.find(r => r.agentId === a.id && r.kind === 'create' && r.status === 'approved');
        if (approved && (await chain.state(a.address)) === 'active') { a.status = 'active'; log(`${a.name} wallet is live`); save(); }
        continue;
      }
      const txs = await chain.outgoing(a.address);
      const since = db.seenLt[a.address];
      // First look covers everything since the agent was created, so nothing slips by across restarts.
      const fresh = txs.filter(t => since ? BigInt(t.lt) > BigInt(since) : t.now * 1000 >= a.createdAt - 60_000);
      if (txs[0]) db.seenLt[a.address] = txs[0].lt;
      for (const t of fresh.reverse()) {
        if (t.to === fmtUser(Address.parse(db.vault!))) continue; // sweep back to vault
        const match = db.requests.find(r => r.agentId === a.id && r.kind === 'pay' && ['approved', 'paid'].includes(r.status)
          && !(r as any).matched && BigInt(r.amount!) === t.amount && Address.parse(r.to!).equals(Address.parse(t.to)));
        if (match) { (match as any).matched = t.hash; continue; }
        a.alarm = `${gram(t.amount)} GRAM left to ${t.to.slice(2, 6)}…${t.to.slice(-4)} with no approval`;
        log(`ALARM ${a.name}: ${a.alarm}`, 'alarm', { agentId: a.id });
      }
      save();
    } catch (e) { console.error('watchdog', a.name, (e as Error).message); }
  }
}
setInterval(watchdog, Number(process.env.WATCH_MS ?? 15000));

// --- http plumbing ---
createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const send = (code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x)); };
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
  const path = (req.url ?? '/').split('?')[0];
  for (const [m, p, h] of routes) {
    const match = req.method === m && path.match(p);
    if (!match) continue;
    let raw = ''; for await (const c of req) raw += c;
    try { return send(200, await h(raw ? JSON.parse(raw) : {}, match.slice(1))); }
    catch (e: any) { return send(e instanceof HttpError ? e.code : 500, { error: e.message }); }
  }
  send(404, { error: 'not found' });
}).listen(PORT, () => console.log(`reins server on :${PORT}`));

startTelegram({
  reject(requestId) {
    const r = db.requests.find(x => x.id === requestId);
    if (!r || r.status !== 'pending') return 'Already decided.';
    r.status = 'rejected'; r.decidedAt = Date.now(); r.note = 'rejected from Telegram';
    if (r.kind === 'create') db.agents = db.agents.filter(x => x.id !== r.agentId);
    log(`Rejected from Telegram: ${agentOf(r.agentId)?.name ?? 'agent'}`, 'warn'); save(); return 'Rejected.';
  },
  freeze(agentId, on) {
    const a = agentOf(agentId); if (!a) return 'Unknown agent.';
    a.frozen = on;
    if (on) for (const r of db.requests) if (r.agentId === a.id && r.status === 'pending') { r.status = 'rejected'; r.note = 'agent frozen'; }
    log(on ? `FROZEN ${a.name} from Telegram: all its requests refused` : `Unfroze ${a.name}`, on ? 'alarm' : 'info'); save();
    return on ? `${a.name} is frozen. It can only lose its small buffer now; kill it from your glasses to pull that back.` : `${a.name} unfrozen.`;
  },
  status() {
    const live = db.agents.filter(a => a.status === 'active');
    const pend = db.requests.filter(r => r.status === 'pending').length;
    return `Vault ${db.vault ?? 'not set'}\nAgents: ${live.map(a => a.name + (a.frozen ? ' (frozen)' : '')).join(', ') || 'none'}\nWaiting for you: ${pend}`;
  },
  agents: () => db.agents.filter(a => a.status === 'active').map(a => ({ id: a.id, name: a.name, frozen: !!a.frozen })),
});
