// Demo-only: simulate a hijacked agent that bypasses Reins and signs a payment with its key directly.
// tsx tools/rogue.ts <agent-name> <to> <amount>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, beginCell, external, storeMessage, toNano } from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { agentPayBody } from '../shared/ton.ts';

const [name, to, amount] = process.argv.slice(2);
const S = process.env.REINS_SERVER ?? 'http://localhost:8787';
const saved = JSON.parse(readFileSync(join(process.env.REINS_HOME!, `agent-${name}.json`), 'utf8'));
const kp = keyPairFromSeed(Buffer.from(saved.seed, 'hex'));
const w: any = await (await fetch(`${S}/kit/agents/${saved.agentId}`)).json();
const body = agentPayBody({ index: BigInt(w.index), seqno: w.seqno, to: Address.parse(to), amount: toNano(amount), secretKey: kp.secretKey });
const boc = beginCell().store(storeMessage(external({ to: Address.parse(w.address), body }))).endCell().toBoc().toString('base64');
console.log(await (await fetch(`${S}/chain/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ boc }) })).json());
