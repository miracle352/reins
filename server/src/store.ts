// State, one record per vault (one per user). Kept in Postgres when DATABASE_URL is set, else in .reins/tenants/.
// Request handlers run inside withTenant(), and `db` points at that user's record, so route code stays simple.
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import type { Contact, Flag } from './policy.ts';

export type Agent = {
  id: string; name: string; operatorPub: string; address: string; index: string;
  status: 'awaiting_create' | 'active' | 'revoked'; createdAt: number; alarm?: string; frozen?: boolean;
  /** Daily budget in nanoGRAM; `boost` adds to it for one UTC day ("give trip-bot 2 more"). */
  daily?: string; boost?: { day: string; amount: string };
  alarmInfo?: { amount: string; to: string };
};
export type Req = {
  id: string; agentId: string; kind: 'create' | 'pay';
  to?: string; amount?: string; purpose: string; flags: Flag[];
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'failed';
  auto: boolean; createdAt: number; decidedAt?: number; fundTx?: string; payTx?: string; note?: string; matched?: string;
};
export type Event = { t: number; text: string; level: 'info' | 'warn' | 'alarm'; requestId?: string; agentId?: string };
export type DB = {
  vault?: string; agents: Agent[]; requests: Req[]; contacts: Contact[];
  events: Event[]; seenLt: Record<string, string>; telegramChat?: number; pairCode?: string;
  /** sha256 of each device token that may act as this vault's lens. */
  lensTokens?: string[];
  /** Code an agent needs to ask this vault for a wallet. Rotatable. */
  linkCode?: string;
  createdAt?: number;
};

const DIR = process.env.REINS_DATA ?? '.reins/tenants';
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: process.env.DATABASE_URL.includes('localhost') ? undefined : { rejectUnauthorized: false } }) : null;

export const tenants = new Map<string, DB>();
const als = new AsyncLocalStorage<DB>();

/** The current user's state. Only valid inside withTenant(). */
export const db: DB = new Proxy({} as DB, {
  get(_t, k) { const t = als.getStore(); if (!t) throw new Error(`no tenant for db.${String(k)}`); return (t as any)[k]; },
  set(_t, k, v) { const t = als.getStore(); if (!t) throw new Error('no tenant'); (t as any)[k] = v; return true; },
});
export const withTenant = <T>(t: DB, fn: () => T) => als.run(t, fn);
export const currentTenant = () => als.getStore();

const code = (n: number) => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(randomBytes(n), b => a[b % a.length]).join(''); };
export const newLinkCode = () => `${code(4)}-${code(4)}`;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');

export function tenantFor(vault: string): DB {
  let t = tenants.get(vault);
  if (!t) {
    t = { vault, agents: [], requests: [], events: [], seenLt: {}, contacts: [], lensTokens: [], linkCode: newLinkCode(), createdAt: Date.now() };
    // Demo address book for the demo vault only. Everyone else builds theirs by approving "always trust".
    if (vault === process.env.REINS_DEMO_VAULT) t.contacts = JSON.parse(process.env.REINS_CONTACTS ?? '[]');
    tenants.set(vault, t); markDirty(t);
  }
  t.linkCode ??= newLinkCode(); t.lensTokens ??= [];
  return t;
}

// ---------- persistence ----------
const dirty = new Set<DB>();
let timer: NodeJS.Timeout | undefined;
function markDirty(t: DB) {
  dirty.add(t); clearTimeout(timer);
  timer = setTimeout(() => void flush(), 100);
}
export function save() { const t = als.getStore(); if (t) markDirty(t); }

let flushing: Promise<void> = Promise.resolve();
export function flush() {
  flushing = flushing.then(async () => {
    const list = [...dirty]; dirty.clear();
    for (const t of list) {
      if (!t.vault) continue;
      const json = JSON.stringify(t);
      try {
        if (pool) await pool.query('insert into reins_tenants (vault, data, updated_at) values ($1, $2, now()) on conflict (vault) do update set data = $2, updated_at = now()', [t.vault, json]);
        else { mkdirSync(DIR, { recursive: true }); const f = join(DIR, `${t.vault}.json`); writeFileSync(f + '.tmp', json); renameSync(f + '.tmp', f); }
      } catch (e) { console.error('save failed', (e as Error).message); dirty.add(t); }
    }
  });
  return flushing;
}

export async function loadAll() {
  if (pool) {
    await pool.query('create table if not exists reins_tenants (vault text primary key, data jsonb not null, updated_at timestamptz not null default now())');
    const r = await pool.query('select data from reins_tenants');
    for (const row of r.rows) tenants.set(row.data.vault, row.data);
  } else if (existsSync(DIR)) {
    for (const f of readdirSync(DIR).filter(f => f.endsWith('.json'))) { const t = JSON.parse(readFileSync(join(DIR, f), 'utf8')); tenants.set(t.vault, t); }
  }
  // One-time move from the single-user file of earlier versions.
  const old = '.reins/db.json';
  if (existsSync(old)) {
    const t = JSON.parse(readFileSync(old, 'utf8')) as DB;
    if (t.vault && !tenants.has(t.vault)) { t.lensTokens = []; tenants.set(t.vault, t); markDirty(t); }
    renameSync(old, old + '.migrated');
  }
  console.log(`store: ${tenants.size} vault(s) from ${pool ? 'Postgres' : DIR}`);
}

// ---------- events ----------
const listeners: ((e: Event, t: DB) => void)[] = [];
export const onEvent = (fn: (e: Event, t: DB) => void) => listeners.push(fn);
export function log(text: string, level: Event['level'] = 'info', meta: { requestId?: string; agentId?: string } = {}) {
  const t = als.getStore(); if (!t) { console.log(`[${level}] ${text}`); return; }
  const e: Event = { t: Date.now(), text, level, ...meta };
  t.events.unshift(e); t.events.length = Math.min(t.events.length, 200);
  markDirty(t); listeners.forEach(fn => { try { fn(e, t); } catch {} });
  console.log(`[${t.vault?.slice(-4)}] [${level}] ${text}`);
}

export const id = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);

/** Finds which vault an agent or request belongs to (ids are unique across vaults). */
export function tenantOfAgent(agentId: string) { for (const t of tenants.values()) if (t.agents.some(a => a.id === agentId)) return t; }
export function tenantOfRequest(reqId: string) { for (const t of tenants.values()) if (t.requests.some(r => r.id === reqId)) return t; }
export function tenantOfToken(token: string) { const h = hashToken(token); for (const t of tenants.values()) if (t.lensTokens?.includes(h)) return t; }
export function tenantOfLink(link: string) { const c = link.trim().toUpperCase(); for (const t of tenants.values()) if (t.linkCode === c) return t; }
export function tenantOfChat(chat: number) { for (const t of tenants.values()) if (t.telegramChat === chat) return t; }
export function tenantOfPairCode(c: string) { for (const t of tenants.values()) if (!t.telegramChat && t.pairCode === c) return t; }
