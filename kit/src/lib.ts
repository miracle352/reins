// Reins agent kit: the only holder of the agent's operator key. Every payment goes through the owner's rules.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Address, beginCell, external, storeMessage } from '@ton/core';
import { keyPairFromSeed, getSecureRandomBytes } from '@ton/crypto';
import { agentPayBody } from '../../shared/ton.ts';
import { signAgent } from '../../shared/auth.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const DEFAULT_SERVER = 'https://reins-jhyz.onrender.com';
const GAS = 20_000_000n; // 0.02 GRAM kept for fees

export type PayResult =
  | { ok: true; status: 'paid'; tx: string; auto: boolean }
  | { ok: false; status: 'rejected' | 'failed' | 'timeout' | 'revoked'; reason: string };

export class ReinsAgent {
  private keys: { publicKey: Buffer; secretKey: Buffer };
  agentId?: string;
  address?: string;

  private constructor(readonly name: string, private server: string, private seed: Buffer, private file: string, private link?: string) {
    this.keys = keyPairFromSeed(seed);
  }

  /**
   * Loads (or creates) the operator key for this agent name from ~/.reins/.
   * `link` is the code from "Connect an agent" in the owner's Reins (REINS_LINK); only needed the first time.
   */
  static async open(name: string, server = process.env.REINS_SERVER ?? DEFAULT_SERVER, link = process.env.REINS_LINK) {
    const dir = process.env.REINS_HOME ?? join(homedir(), '.reins');
    const file = join(dir, `agent-${name}.json`);
    let saved: { seed: string; agentId?: string } | undefined;
    if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8'));
    if (!saved) { mkdirSync(dir, { recursive: true }); saved = { seed: (await getSecureRandomBytes(32)).toString('hex') }; writeFileSync(file, JSON.stringify(saved), { mode: 0o600 }); }
    const a = new ReinsAgent(name, server.replace(/\/$/, ''), Buffer.from(saved.seed, 'hex'), file, link);
    a.agentId = saved.agentId;
    return a;
  }

  private async call(method: string, path: string, body?: unknown, tries = 5): Promise<any> {
    let r: Response;
    try {
      // Every call is signed with the operator key, so nobody else can speak for this agent.
      const raw = body ? JSON.stringify(body) : '';
      r = await fetch(this.server + path, {
        method, body: raw || undefined,
        headers: {
          'content-type': 'application/json',
          'x-reins-sig': signAgent(this.keys.secretKey, method, path, raw),
          ...(this.agentId ? { 'x-reins-agent': this.agentId } : {}),
        },
      });
    } catch (e) {
      // Server restarting or network blip: retry reads and idempotent polls.
      if (tries <= 0) throw e;
      await sleep(2000); return this.call(method, path, body, tries - 1);
    }
    const j: any = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
    return j;
  }

  /** Asks the owner for a wallet. Returns once the owner approved it on their glasses and it is live. */
  async connect(timeoutMs = 10 * 60_000) {
    if (!this.agentId) {
      if (!this.link) throw new Error('First connection needs your link code: set REINS_LINK (Reins on your phone → Connect an agent).');
      const r = await this.call('POST', '/kit/agents', { name: this.name, operatorPub: this.keys.publicKey.toString('hex'), link: this.link });
      this.agentId = r.agentId; this.address = r.address;
      writeFileSync(this.file, JSON.stringify({ seed: this.seed.toString('hex'), agentId: r.agentId }), { mode: 0o600 });
    }
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      let a: any;
      try { a = await this.call('GET', `/kit/agents/${this.agentId}`); }
      catch (e: any) {
        if (e.status !== 401 && e.status !== 404) throw e;
        // The owner said no (or the server forgot us): start over next time.
        writeFileSync(this.file, JSON.stringify({ seed: this.seed.toString('hex') }), { mode: 0o600 });
        this.agentId = undefined;
        throw new Error('The owner rejected this wallet request.');
      }
      if (a.status === 'active') return a;
      if (a.status === 'revoked') throw new Error('This agent was revoked by its owner.');
      await sleep(3000);
    }
    throw new Error('Owner has not approved the wallet yet.');
  }

  async wallet() { return this.call('GET', `/kit/agents/${this.agentId}`); }

  /** Requests a payment. Waits for the owner's decision; pays only after the money is actually there. */
  async pay(to: string, amount: string, purpose: string, timeoutMs = 5 * 60_000): Promise<PayResult> {
    if (!this.agentId) await this.connect();
    let req: any;
    try { req = await this.call('POST', '/kit/pay', { to, amount, purpose }); }
    catch (e: any) { return { ok: false, status: e.status === 403 ? 'revoked' : 'failed', reason: e.message }; }

    const end = Date.now() + timeoutMs;
    while (req.status === 'pending' && Date.now() < end) { await sleep(2500); req = await this.call('GET', `/kit/requests/${req.id}`); }
    if (req.status === 'pending') return { ok: false, status: 'timeout', reason: 'Owner did not answer in time. Ask again later.' };
    if (req.status === 'rejected') return { ok: false, status: 'rejected', reason: req.note ?? 'Owner rejected this payment.' };

    // Approved: wait until the funds (or existing buffer) cover it, then sign with the operator key.
    const need = BigInt(req.amount) + GAS;
    let w = await this.wallet();
    while (BigInt(w.balance) < need && Date.now() < end) { await sleep(3000); w = await this.wallet(); }
    if (BigInt(w.balance) < need) return this.report(req.id, false, 'Funds did not arrive in time.');

    const body = agentPayBody({
      index: BigInt(w.index), seqno: w.seqno, to: Address.parse(to), amount: BigInt(req.amount),
      secretKey: this.keys.secretKey, comment: purpose.slice(0, 100),
    });
    const ext = beginCell().store(storeMessage(external({ to: Address.parse(w.address), body }))).endCell();
    try {
      const { hash } = await this.call('POST', '/chain/send', { boc: ext.toBoc().toString('base64') });
      // Confirm by seqno bump.
      for (let i = 0; i < 20; i++) { await sleep(3000); const now = await this.wallet(); if (now.seqno > w.seqno) return this.report(req.id, true, undefined, hash, req.auto); }
      return this.report(req.id, false, 'Not confirmed on chain.');
    } catch (e: any) {
      return this.report(req.id, false, /operator|signature|500/i.test(e.message) ? 'Wallet refused the signature (key revoked?)' : e.message);
    }
  }

  private async report(id: string, ok: boolean, note?: string, tx?: string, auto = false): Promise<PayResult> {
    await this.call('POST', `/kit/requests/${id}/result`, { ok, tx, note }).catch(() => {});
    return ok ? { ok: true, status: 'paid', tx: tx!, auto } : { ok: false, status: 'failed', reason: note ?? 'failed' };
  }
}
