// toncenter access with one shared queue: the free tier is ~1 rps, so every call goes through here.
import { Address, Cell } from '@ton/core';

const BASE = process.env.TONCENTER_URL ?? 'https://testnet.toncenter.com';
const KEY = process.env.TONCENTER_KEY || undefined;
const GAP_MS = KEY ? 120 : 1100;

let tail: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    for (let i = 0; ; i++) {
      try { const v = await fn(); await sleep(GAP_MS); return v; }
      catch (e: any) {
        await sleep(GAP_MS * (i + 1));
        if (!/429|rate/i.test(String(e?.message)) || i >= 6) throw e;
      }
    }
  });
  tail = run.catch(() => undefined);
  return run;
}

async function get(path: string) {
  return queued(async () => {
    const r = await fetch(BASE + path, { headers: KEY ? { 'X-API-Key': KEY } : {} });
    const j: any = await r.json();
    if (r.status === 429 || j?.code === 429) throw new Error('429');
    if (!r.ok && !j) throw new Error(`toncenter ${r.status}`);
    return j;
  });
}

export async function balance(addr: string): Promise<bigint> {
  const j = await get(`/api/v2/getAddressBalance?address=${addr}`);
  return BigInt(j.result ?? 0);
}

export async function state(addr: string): Promise<'active' | 'uninit' | 'nonexist' | 'frozen'> {
  const j = await get(`/api/v3/addressInformation?address=${addr}&use_v2=false`);
  return j.status ?? 'nonexist';
}

async function runGet(addr: string, method: string): Promise<bigint> {
  return queued(async () => {
    const r = await fetch(BASE + '/api/v3/runGetMethod', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(KEY ? { 'X-API-Key': KEY } : {}) },
      body: JSON.stringify({ address: addr, method, stack: [] }),
    });
    if (r.status === 429) throw new Error('429');
    const j: any = await r.json();
    if (j.exit_code !== 0 || !j.stack?.[0]) throw new Error(`get ${method} failed (exit ${j.exit_code})`);
    return BigInt(j.stack[0].value);
  });
}

export const seqno = async (addr: string) => {
  if ((await state(addr)) !== 'active') return 0;
  return Number(await runGet(addr, 'seqno'));
};
export const operatorKey = (addr: string) => runGet(addr, 'get_public_key');

export async function sendBoc(boc: string) {
  return queued(async () => {
    const r = await fetch(BASE + '/api/v2/sendBoc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(KEY ? { 'X-API-Key': KEY } : {}) },
      body: JSON.stringify({ boc }),
    });
    const j: any = await r.json();
    if (r.status === 429) throw new Error('429');
    if (!j.ok) throw new Error(`sendBoc rejected: ${j.error ?? r.status}`);
    return Cell.fromBase64(boc).hash().toString('hex');
  });
}

export type OutTransfer = { lt: string; now: number; to: string; amount: bigint; hash: string };

/** Outgoing value transfers from an address, newest first. Uses v2 (liteserver) — the v3 indexer lags on testnet. */
export async function outgoing(addr: string, limit = 10): Promise<OutTransfer[]> {
  const j = await get(`/api/v2/getTransactions?address=${addr}&limit=${limit}`);
  if (!j.ok) throw new Error(`getTransactions: ${j.error ?? 'failed'}`);
  const res: OutTransfer[] = [];
  for (const t of j.result ?? []) {
    for (const m of t.out_msgs ?? []) {
      if (!m.destination) continue;
      res.push({ lt: t.transaction_id.lt, now: t.utime, to: Address.parse(m.destination).toString({ testOnly: true, bounceable: false }), amount: BigInt(m.value ?? 0), hash: t.transaction_id.hash });
    }
  }
  return res;
}
