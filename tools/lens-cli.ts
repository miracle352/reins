// Dev stand-in for the glasses: same calls the lens app makes, driven from a terminal.
// Usage: tsx tools/lens-cli.ts <hello|state|fund|trust|reject|kill> [name]
import { readFileSync } from 'node:fs';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { vaultWallet, fmtUser } from '../shared/ton.ts';
import { createAgentTx, fundTx, killTx } from '../shared/vault.ts';
import { signLogin } from '../shared/auth.ts';

const S = process.env.REINS_SERVER ?? 'http://localhost:8787';
const mnemonic: string[] = JSON.parse(readFileSync(process.env.VAULT_FILE ?? '../reins-spike/state.json', 'utf8')).vaultMnemonic;
const keys = await mnemonicToPrivateKey(mnemonic);
const vault = fmtUser(vaultWallet(keys.publicKey).address);
let token = '';
const call = async (m: string, p: string, b?: unknown) => {
  if (!token && p !== '/lens/login') {
    const { ts, sig } = signLogin(keys.secretKey, vault);
    token = (await call('POST', '/lens/login', { pub: keys.publicKey.toString('hex'), ts, sig })).token;
  }
  const r = await fetch(S + p, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
};

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'hello') console.log(await call('POST', '/lens/hello'));
const st = await call('GET', '/lens/state');
if (cmd === 'state' || cmd === 'hello') console.log(JSON.stringify(st, null, 2));
const card = st.pending;
const seqno = async () => (await call('GET', `/chain/wallet/${vault}`)).seqno;

if (cmd === 'reject') console.log(await call('POST', '/lens/decide', { requestId: card.id, action: 'reject' }));
if (cmd === 'fund' || cmd === 'trust') {
  const boc = card.kind === 'create'
    ? createAgentTx(keys, await seqno(), card.operatorPub, BigInt(card.amountNano))
    : fundTx(keys, await seqno(), card.agentAddress, BigInt(card.amountNano));
  console.log(await call('POST', '/lens/decide', { requestId: card.id, action: cmd, boc, name: arg }));
}
if (cmd === 'kill') {
  const agent = st.alarm ?? st.agents.find((a: any) => a.status === 'active');
  const full = await call('GET', `/kit/agents/${agent.agentId ?? agent.id}`);
  console.log(await call('POST', '/lens/kill', { agentId: full.id, boc: killTx(keys, await seqno(), full.address) }));
}
