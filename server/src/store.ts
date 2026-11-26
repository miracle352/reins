// Tiny JSON-file store. One user per server for now (self-hosted).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Contact, Flag } from './policy.ts';

export type Agent = {
  id: string; name: string; operatorPub: string; address: string; index: string;
  status: 'awaiting_create' | 'active' | 'revoked'; createdAt: number; alarm?: string;
};
export type Req = {
  id: string; agentId: string; kind: 'create' | 'pay';
  to?: string; amount?: string; purpose: string; flags: Flag[];
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'failed';
  auto: boolean; createdAt: number; decidedAt?: number; fundTx?: string; payTx?: string; note?: string;
};
export type Event = { t: number; text: string; level: 'info' | 'warn' | 'alarm' };
export type DB = {
  vault?: string; agents: Agent[]; requests: Req[]; contacts: Contact[];
  events: Event[]; seenLt: Record<string, string>; telegramChat?: number; pairCode?: string;
};

const FILE = process.env.REINS_DB ?? '.reins/db.json';

const seed = (): DB => ({
  agents: [], requests: [], events: [], seenLt: {},
  // Demo address book. In the app you add contacts by approving "Fund & trust".
  contacts: JSON.parse(process.env.REINS_CONTACTS ?? '[]'),
});

export const db: DB = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : seed();

let timer: NodeJS.Timeout | undefined;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(db, null, 2)); }, 50);
}

const listeners: ((e: Event) => void)[] = [];
export const onEvent = (fn: (e: Event) => void) => listeners.push(fn);
export function log(text: string, level: Event['level'] = 'info') {
  const e = { t: Date.now(), text, level };
  db.events.unshift(e); db.events.length = Math.min(db.events.length, 200);
  save(); listeners.forEach(fn => { try { fn(e); } catch {} });
  console.log(`[${level}] ${text}`);
}

export const id = () => Math.random().toString(36).slice(2, 8);
