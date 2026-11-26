// Reins server: relays between agents (kit) and the glasses (lens), applies the rules, watches the chain.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Address } from '@ton/core';
import { agentAddress, fmt, fmtUser, isLookalike } from '../../shared/ton.ts';
import * as chain from './chain.ts';
import { db, save, log, id, type Agent, type Req, type DB, withTenant, tenants, tenantFor, loadAll, flush, newToken, hashToken, newLinkCode,
  tenantOfAgent, tenantOfToken, tenantOfLink, currentTenant } from './store.ts';
import { verifyAgent, verifyLogin } from '../../shared/auth.ts';
import { vaultWallet } from '../../shared/ton.ts';
import { evaluate, DEFAULT_LIMITS, gram, gram3, toNanoStr, type Flag } from './policy.ts';
import { startTelegram, telegramWebhook, pairCodeFor, botName } from './telegram.ts';
import { transcribe, warmVoice } from './voice.ts';
import { parseIntent } from '../../shared/intent.ts';

const PORT = Number(process.env.PORT ?? 8787);
const BUFFER = toNanoStr(process.env.REINS_BUFFER ?? '0.3');
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
const today = () => new Date().toISOString().slice(0, 10);
function limitsFor(a: Agent) {
  const base = BigInt(a.daily ?? DEFAULT_LIMITS.daily.toString());
  const boost = a.boost?.day === today() ? BigInt(a.boost.amount) : 0n;
  // A single payment above 1 GRAM is flagged unless you just gave the agent more than that.
  return { perPayment: boost > DEFAULT_LIMITS.perPayment ? boost : DEFAULT_LIMITS.perPayment, daily: base + boost };
}
function lastPayment(agentId: string) {
  const r = db.requests.filter(x => x.agentId === agentId && x.kind === 'pay' && x.status === 'paid').sort((x, y) => y.createdAt - x.createdAt)[0];
  if (!r) return null;
  const c = db.contacts.find(c => { try { return Address.parse(c.address).equals(Address.parse(r.to!)); } catch { return false; } });
  return { amount: gram(BigInt(r.amount!)), to: c?.name ?? `${r.to!.slice(2, 6)}…${r.to!.slice(-4)}`, at: r.createdAt };
}

function cardFor(r: Req) {
  const a = agentOf(r.agentId);
  const contact = r.to ? db.contacts.find(c => { try { return Address.parse(c.address).equals(Address.parse(r.to!)); } catch { return false; } }) : undefined;
  return {
    id: r.id, kind: r.kind, agent: a?.name, purpose: r.purpose, flags: r.flags,
    amount: r.kind === 'create' ? gram(BUFFER) : gram(BigInt(r.amount!)),
    amountNano: r.kind === 'create' ? BUFFER.toString() : r.amount,
    to: r.to, toName: contact?.name, agentAddress: a?.address, operatorPub: a?.operatorPub,
    twin: r.to && !contact ? (() => { const t = db.contacts.find(c => { try { return isLookalike(c.address, r.to!); } catch { return false; } }); return t ? { name: t.name, address: t.address } : undefined; })() : undefined,
  };
}

// --- routes ---
type H = (body: any, params: string[]) => Promise<any>;
/** open: anyone. lens: the vault owner's device. agent: a signed call from one agent. link: a new agent with a link code. */
type Scope = 'open' | 'lens' | 'agent' | 'link' | 'lens|agent';
const routes: [string, RegExp, Scope, H][] = [];
const route = (m: string, p: RegExp, scope: Scope, h: H) => routes.push([m, p, scope, h]);
/** The agent that signed the current call (set by authorize, never by the client). */
const caller = (b: any) => b[CALLER] as Agent;
const CALLER = Symbol('caller');
class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

// Kit (the agent side)
route('POST', /^\/kit\/agents$/, 'link', async b => {
  const pub = BigInt('0x' + String(b.operatorPub));
  const existing = db.agents.find(a => a.operatorPub === b.operatorPub);
  if (existing) return { agentId: existing.id, address: existing.address, status: existing.status };
  const { index, address } = agentAddress(Address.parse(db.vault!), pub);
  const agent: Agent = { id: id(), name: String(b.name ?? 'agent').slice(0, 20), operatorPub: b.operatorPub, address: fmt(address), index: index.toString(), status: 'awaiting_create', createdAt: Date.now() };
  // A second process using a live agent's name is either a lost key file or something posing as that agent.
  const twin = db.agents.find(a => a.status === 'active' && a.name.toLowerCase() === agent.name.toLowerCase());
  const flags: Flag[] = twin ? [{ code: 'NAME_TAKEN', text: `${twin.name} already has a wallet` }] : [];
  db.agents.push(agent);
  db.requests.push({ id: id(), agentId: agent.id, kind: 'create', purpose: `New agent wants a wallet`, flags, status: 'pending', auto: false, createdAt: Date.now() });
  log(flags.length ? `${agent.name} asked for a wallet !! ${flags[0].text}, different key` : `${agent.name} asked for a wallet`, flags.length ? 'warn' : 'info', { agentId: agent.id, requestId: db.requests[db.requests.length - 1].id }); save();
  return { agentId: agent.id, address: agent.address, status: agent.status };
});

route('GET', /^\/kit\/agents\/(\w+)$/, 'agent', async (_b, [aid]) => {
  const a = agentOf(aid); if (!a || a !== caller(_b)) throw new HttpError(404, 'unknown agent');
  const st = await cached(`st:${a.address}`, 6000, () => chain.state(a.address));
  const seq = st === 'active' ? await cached(`seq:${a.address}`, 3000, () => chain.seqno(a.address)) : 0;
  return { ...a, chainState: st, balance: st === 'active' ? (await agentBal(a)).toString() : '0', seqno: seq };
});

route('POST', /^\/kit\/pay$/, 'agent', async b => {
  const a = caller(b);
  if (a.status === 'revoked') throw new HttpError(403, 'This agent was revoked by its owner.');
  if (a.frozen) throw new HttpError(403, 'This agent is frozen by its owner. Do not retry.');
  if (a.status !== 'active') throw new HttpError(409, 'Agent wallet not created yet. Approve it on your glasses.');
  const amount = toNanoStr(String(b.amount));
  const purpose = String(b.purpose ?? '').slice(0, 140);
  const pendingSpend = db.requests.filter(r => r.agentId === a.id && r.status === 'approved' && r.kind === 'pay').reduce((s, r) => s + BigInt(r.amount!), 0n);
  const bufferLeft = (await agentBal(a)) - pendingSpend - 20_000_000n;
  const v = evaluate({ to: String(b.to), amount, purpose, contacts: db.contacts, spentToday: spentToday(a.id), limits: limitsFor(a), bufferLeft });
  const r: Req = { id: id(), agentId: a.id, kind: 'pay', to: String(b.to), amount: amount.toString(), purpose, flags: v.flags, status: v.auto ? 'approved' : 'pending', auto: v.auto, createdAt: Date.now(), decidedAt: v.auto ? Date.now() : undefined };
  db.requests.push(r);
  log(v.auto
    ? `Auto-approved ${gram(amount)} → ${v.contact!.name} (${a.name})`
    : `${a.name} asks ${gram(amount)} GRAM${v.flags.length ? ' !! ' + v.flags.map(f => f.text).join(', ') : ''}`, v.flags.length ? 'warn' : 'info', { agentId: a.id, requestId: v.auto ? undefined : r.id });
  save();
  return r;
});

route('GET', /^\/kit\/requests\/(\w+)$/, 'agent', async (_b, [rid]) => {
  const r = db.requests.find(x => x.id === rid && x.agentId === caller(_b).id); if (!r) throw new HttpError(404, 'unknown request');
  return r;
});

route('POST', /^\/kit\/requests\/(\w+)\/result$/, 'agent', async (b, [rid]) => {
  const r = db.requests.find(x => x.id === rid && x.agentId === caller(b).id); if (!r) throw new HttpError(404, 'unknown request');
  soon();
  r.status = b.ok ? 'paid' : 'failed'; r.payTx = b.tx; r.note = b.note;
  const a = agentOf(r.agentId)!;
  cache.delete(`bal:${a.address}`);
  const payee = db.contacts.find(c => { try { return Address.parse(c.address).equals(Address.parse(r.to!)); } catch { return false; } });
  log(b.ok ? `${a.name} paid ${gram(BigInt(r.amount!))} GRAM to ${payee?.name ?? `${r.to!.slice(2, 6)}…${r.to!.slice(-4)}`}` : `${a.name} payment failed: ${b.note}`, b.ok ? 'info' : 'warn');
  save(); return r;
});

route('POST', /^\/chain\/send$/, 'lens|agent', async b => ({ hash: await chain.sendBoc(String(b.boc)) }));
route('GET', /^\/chain\/wallet\/([\w-]+)$/, 'lens|agent', async (_b, [addr]) => {
  const st = await chain.state(addr);
  return { state: st, seqno: st === 'active' ? await chain.seqno(addr) : 0, balance: (await chain.balance(addr)).toString() };
});

// Lens (the glasses side)
// Login: the device proves it holds the vault key by signing a timestamp, and gets a token for later calls.
route('POST', /^\/lens\/login$/, 'open', async b => {
  const pub = Buffer.from(String(b.pub ?? ''), 'hex');
  if (pub.length !== 32) throw new HttpError(400, 'bad key');
  const vault = fmtUser(vaultWallet(pub).address);
  if (!verifyLogin(pub, vault, Number(b.ts), String(b.sig ?? ''))) throw new HttpError(401, 'Signature did not check out. Is your phone clock right?');
  const fresh = !tenants.has(vault);
  const t = tenantFor(vault);
  const token = newToken();
  t.lensTokens = [...(t.lensTokens ?? []).slice(-4), hashToken(token)]; // up to 5 devices
  withTenant(t, () => { if (fresh) log(`Vault ready: ${vault.slice(0, 6)}…${vault.slice(-4)}`); save(); });
  return { token, vault };
});

route('POST', /^\/lens\/hello$/, 'lens', async () => {
  const pairCode = pairCodeFor(currentTenant()!); save();
  return { ok: true, vault: db.vault, buffer: BUFFER.toString(), pairCode, link: db.linkCode };
});

route('POST', /^\/lens\/link$/, 'lens', async () => { db.linkCode = newLinkCode(); log('New agent link code: agents with the old one can no longer ask'); save(); return { link: db.linkCode }; });

route('GET', /^\/lens\/state$/, 'lens', async () => {
  const vaultBal = db.vault ? await cached('vault', 10_000, () => chain.balance(db.vault!)) : 0n;
  let atRisk = 0n;
  for (const a of db.agents.filter(a => a.status === 'active')) atRisk += await agentBal(a);
  const pending = db.requests.filter(r => r.status === 'pending').sort((x, y) => x.createdAt - y.createdAt);
  const alarm = db.agents.find(a => a.status === 'active' && a.alarm);
  return {
    vault: db.vault, vaultBalance: gram3(vaultBal), atRisk: gram3(atRisk),
    agents: await Promise.all(db.agents.filter(a => a.status !== 'revoked' || Date.now() - a.createdAt < DAY).map(async a => ({
      id: a.id, name: a.name, address: a.address,
      status: a.frozen && a.status === 'active' ? 'frozen' : a.status,
      balance: a.status === 'active' ? gram3(await agentBal(a)) : '0',
      spentToday: gram(spentToday(a.id)), daily: gram(limitsFor(a).daily),
      waiting: db.requests.filter(r => r.agentId === a.id && r.status === 'pending').length,
      last: lastPayment(a.id),
    }))),
    spentToday: gram(db.agents.reduce((s, a) => s + spentToday(a.id), 0n)),
    payees: db.contacts.map(c => ({ address: c.address, name: c.name, trusted: c.trusted, autoLimit: gram(BigInt(c.autoLimit)) })),
    alarm: alarm ? { agentId: alarm.id, agent: alarm.name, text: alarm.alarm, agentAddress: alarm.address, ...(alarm.alarmInfo ?? {}) } : null,
    pending: pending[0] ? cardFor(pending[0]) : null, pendingCount: pending.length,
    ticker: db.events.slice(0, 8).map(e => e.text),
    events: db.events.slice(0, 30).map(e => ({ t: e.t, text: e.text, level: e.level })),
    telegramBot: botName || null,
    telegram: db.telegramChat ? 'linked' : pairCodeFor(currentTenant()!),
    link: db.linkCode,
  };
});

route('POST', /^\/lens\/decide$/, 'lens', async b => {
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

route('POST', /^\/lens\/kill$/, 'lens', async b => {
  const a = agentOf(b.agentId); if (!a) throw new HttpError(404, 'unknown agent');
  await chain.sendBoc(String(b.boc));
  a.status = 'revoked'; a.alarm = undefined; a.alarmInfo = undefined;
  for (const r of db.requests) if (r.agentId === a.id && r.status === 'pending') { r.status = 'rejected'; r.note = 'agent revoked'; }
  log(`KILLED ${a.name}: key revoked, funds swept to vault`, 'alarm');
  save(); return { ok: true };
});

route('POST', /^\/lens\/dismiss$/, 'lens', async b => {
  const a = agentOf(b.agentId); if (a) { a.alarm = undefined; a.alarmInfo = undefined; log(`Alarm on ${a.name} dismissed${a.frozen ? ' (still paused)' : ''}`); save(); }
  return { ok: true };
});

route('POST', /^\/lens\/pause$/, 'lens', async b => {
  const a = agentOf(b.agentId); if (!a) throw new HttpError(404, 'unknown agent');
  a.frozen = !!b.on;
  if (a.frozen) for (const r of db.requests) if (r.agentId === a.id && r.status === 'pending') { r.status = 'rejected'; r.note = 'agent paused'; }
  log(a.frozen ? `Paused ${a.name}` : `Resumed ${a.name}`, 'info', { agentId: a.id }); save();
  return { ok: true };
});

route('POST', /^\/lens\/budget$/, 'lens', async b => {
  const a = agentOf(b.agentId); if (!a) throw new HttpError(404, 'unknown agent');
  const daily = toNanoStr(String(b.daily));
  if (daily <= 0n || daily > 1000_000_000_000n) throw new HttpError(400, 'Budget must be between 0 and 1000 GRAM.');
  a.daily = daily.toString();
  log(`${a.name}'s daily budget set to ${gram(daily)} GRAM`, 'info', { agentId: a.id }); save();
  return { ok: true };
});

route('POST', /^\/lens\/payee$/, 'lens', async b => {
  const c = db.contacts.find(x => { try { return Address.parse(x.address).equals(Address.parse(String(b.address))); } catch { return false; } });
  if (!c) throw new HttpError(404, 'unknown payee');
  if (b.remove) db.contacts = db.contacts.filter(x => x !== c);
  else {
    if (b.trusted !== undefined) c.trusted = !!b.trusted;
    if (b.autoLimit !== undefined) c.autoLimit = toNanoStr(String(b.autoLimit)).toString();
    if (b.name) c.name = String(b.name).trim().slice(0, 24) || c.name;
  }
  log(b.remove ? `Removed payee ${c.name}` : b.name ? `Payee renamed to ${c.name}` : `${c.name} is ${c.trusted ? 'trusted' : 'no longer trusted'}`); save();
  return { ok: true };
});

route('POST', /^\/lens\/give$/, 'lens', async b => {
  const a = agentOf(b.agentId); if (!a || a.status !== 'active') throw new HttpError(409, 'That agent is not live.');
  const amount = toNanoStr(String(b.amount));
  await chain.sendBoc(String(b.boc));
  const prev = a.boost?.day === today() ? BigInt(a.boost.amount) : 0n;
  a.boost = { day: today(), amount: (prev + amount).toString() };
  cache.delete(`bal:${a.address}`); cache.delete('vault');
  log(`Gave ${a.name} ${gram(amount)} GRAM (today's budget now ${gram(limitsFor(a).daily)})`, 'info', { agentId: a.id }); save();
  return { ok: true, daily: gram(limitsFor(a).daily) };
});

route('POST', /^\/lens\/voice$/, 'lens', async b => {
  const text = await transcribe(String(b.pcm ?? ''));
  const intent = parseIntent(text, db.agents.filter(a => a.status === 'active').map(a => a.name));
  if (text) log(`Heard: "${text}"`, 'info');
  return { text, intent };
});

// --- watchdog: every outgoing transfer must match something you or your rules approved ---
let watching = false;
async function watchdog() {
  if (watching) return; watching = true;
  try { for (const t of tenants.values()) await withTenant(t, watchOnce); } finally { watching = false; }
}
const soon = () => setTimeout(() => void watchdog(), 4000);
async function watchOnce() {
  if (!db.vault) return;
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
          && !r.matched && BigInt(r.amount!) === t.amount && Address.parse(r.to!).equals(Address.parse(t.to)));
        if (match) { match.matched = t.hash; continue; }
        a.alarm = `${gram(t.amount)} GRAM left to ${t.to.slice(2, 6)}…${t.to.slice(-4)} with no approval`;
        a.alarmInfo = { amount: gram(t.amount), to: t.to };
        log(`ALARM ${a.name}: ${a.alarm}`, 'alarm', { agentId: a.id });
      }
      save();
    } catch (e) { console.error('watchdog', a.name, (e as Error).message); }
  }
}
setInterval(watchdog, Number(process.env.WATCH_MS ?? 15000));

// --- http plumbing ---
const BODY_MAX = 2_000_000; // voice clips are the largest bodies
createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-reins-agent, x-reins-sig');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const send = (code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x)); };
  const path = (req.url ?? '/').split('?')[0];
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > BODY_MAX) return send(413, { error: 'too large' }); }
  if (path === '/health') return send(200, { ok: true, service: 'reins', vaults: tenants.size, uptime: Math.round(process.uptime()) });
  if (req.method === 'GET' && serveSite(path, res)) return;
  // Operator-only: move a vault's record between servers (e.g. self-hosted -> hosted). Off unless REINS_ADMIN_KEY is set.
  if (path === '/admin/import' && req.method === 'POST') {
    const key = process.env.REINS_ADMIN_KEY;
    if (!key || req.headers.authorization !== `Bearer ${key}`) return send(401, { error: 'no' });
    const t = JSON.parse(raw) as DB;
    if (!t.vault) return send(400, { error: 'no vault' });
    tenants.set(t.vault, t); withTenant(t, () => save()); await flush();
    return send(200, { ok: true, vault: t.vault, agents: t.agents.length });
  }
  if (path.startsWith('/tg/') && req.method === 'POST') { await telegramWebhook(path.slice(4), raw).catch(e => console.error('tg', e.message)); return send(200, {}); }
  for (const [m, p, scope, h] of routes) {
    const match = req.method === m && path.match(p);
    if (!match) continue;
    try {
      const body = raw ? JSON.parse(raw) : {};
      const tenant = authorize(scope, req, path, raw, body);
      const run = () => h(body, match.slice(1));
      return send(200, tenant ? await withTenant(tenant, run) : await run());
    } catch (e: any) { return send(e instanceof HttpError ? e.code : 500, { error: e.message }); }
  }
  send(404, { error: 'not found' });
}).listen(PORT, () => console.log(`reins server on :${PORT}`));

// The landing page (site/) is served from the same place as the API.
const SITE = new URL('../../site/', import.meta.url).pathname;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript' };
function serveSite(path: string, res: ServerResponse) {
  if (path === '/app') { res.writeHead(301, { location: '/app/' }).end(); return true; }
  const rel = path === '/' ? 'index.html' : path.endsWith('/') ? path.slice(1) + 'index.html' : path.slice(1);
  if (rel.includes('..') || !/^[\w./-]+$/.test(rel)) return false;
  const file = join(SITE, rel), type = TYPES[extname(file)];
  if (!type || !existsSync(file)) return false;
  res.writeHead(200, { 'content-type': type, 'cache-control': rel.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400' });
  res.end(readFileSync(file)); return true;
}

function authorize(scope: Scope, req: IncomingMessage, path: string, raw: string, body: any): DB | undefined {
  if (scope === 'open') return;
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (scope.includes('lens') && bearer) {
    const t = tenantOfToken(bearer); if (t) return t;
    if (scope === 'lens') throw new HttpError(401, 'This device is not logged in to that vault.');
  }
  const sig = req.headers['x-reins-sig'] as string | undefined;
  if (scope === 'link') {
    const t = tenantOfLink(String(body.link ?? ''));
    if (!t) throw new HttpError(403, 'Unknown link code. It is shown in Reins on your phone, under "Connect an agent".');
    if (!/^[0-9a-f]{64}$/.test(String(body.operatorPub)) || !verifyAgent(body.operatorPub, sig, req.method!, path, raw)) throw new HttpError(401, 'bad signature');
    return t;
  }
  if (scope.includes('agent')) {
    const aid = String(req.headers['x-reins-agent'] ?? '');
    const t = aid ? tenantOfAgent(aid) : undefined;
    const a = t?.agents.find(x => x.id === aid);
    if (!t || !a || !verifyAgent(a.operatorPub, sig, req.method!, path, raw)) throw new HttpError(401, 'Unknown agent or bad signature.');
    body[CALLER] = a;
    return t;
  }
  throw new HttpError(401, 'Not logged in.');
}

await loadAll();
setInterval(() => void flush(), 30_000);
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => void flush().then(() => process.exit(0)));

void warmVoice().then(how => console.log(`voice: ready (${how})`)).catch(e => console.error('voice: off', e.message));

startTelegram({
  reject(requestId) {
    const r = db.requests.find(x => x.id === requestId);
    if (!r || r.status !== 'pending') return 'Already decided.';
    r.status = 'rejected'; r.decidedAt = Date.now(); r.note = 'rejected from Telegram';
    const name = agentOf(r.agentId)?.name ?? 'agent';
    if (r.kind === 'create') db.agents = db.agents.filter(x => x.id !== r.agentId);
    log(`Rejected from Telegram: ${name}`, 'warn'); save();
    return r.kind === 'create' ? `Rejected. ${name} gets no wallet.` : `Rejected. ${name} was not paid.`;
  },
  freeze(agentId, on) {
    const a = agentOf(agentId); if (!a) return 'Unknown agent.';
    a.frozen = on;
    a.alarm = on ? 'Paused from Telegram. Kill it to pull its funds back.' : undefined;
    if (on) for (const r of db.requests) if (r.agentId === a.id && r.status === 'pending') { r.status = 'rejected'; r.note = 'agent frozen'; }
    log(on ? `PAUSED ${a.name} from Telegram: all its requests refused` : `Resumed ${a.name}`, on ? 'alarm' : 'info'); save();
    return on ? `${a.name} is paused. It can only lose what is already in its wallet; kill it from your glasses to pull that back.` : `${a.name} resumed.`;
  },
  status() {
    const live = db.agents.filter(a => a.status === 'active');
    const pend = db.requests.filter(r => r.status === 'pending').length;
    return `Vault ${db.vault ?? 'not set'}\nAgents: ${live.map(a => a.name + (a.frozen ? ' (frozen)' : '')).join(', ') || 'none'}\nWaiting for you: ${pend}`;
  },
  agents: () => db.agents.filter(a => a.status === 'active').map(a => ({ id: a.id, name: a.name, frozen: !!a.frozen })),
});
