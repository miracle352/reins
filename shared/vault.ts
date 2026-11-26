// Vault-side transactions. Runs wherever the vault key lives (the glasses app, or the dev CLI).
import { Address, beginCell, external, internal, SendMode, storeMessage, toNano } from '@ton/core';
import { agentAddress, deployBody, revokeBody, sweepBody, vaultWallet } from './ton.ts';

export type VaultKeys = { publicKey: Buffer; secretKey: Buffer };
const GAS = toNano('0.02');

function signed(keys: VaultKeys, seqno: number, messages: ReturnType<typeof internal>[]) {
  const w = vaultWallet(keys.publicKey);
  const body = w.createTransfer({ seqno, secretKey: keys.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS, messages });
  const ext = external({ to: w.address, init: seqno === 0 ? w.init : undefined, body });
  return beginCell().store(storeMessage(ext)).endCell().toBoc().toString('base64');
}

/** Create the agent's wallet and drip its starting buffer in one message. */
export function createAgentTx(keys: VaultKeys, seqno: number, operatorPub: string, buffer: bigint) {
  const owner = vaultWallet(keys.publicKey).address;
  const { address, init } = agentAddress(owner, BigInt('0x' + operatorPub));
  return signed(keys, seqno, [internal({ to: address, value: buffer + GAS, bounce: true, init, body: deployBody(owner, BigInt('0x' + operatorPub)) })]);
}

/** Send exactly what was approved (plus fees) to the agent. Nothing more sits at risk. */
export function fundTx(keys: VaultKeys, seqno: number, agent: string, amount: bigint) {
  return signed(keys, seqno, [internal({ to: Address.parse(agent), value: amount + GAS, bounce: true })]);
}

/** Kill switch: revoke the operator key, then sweep everything back to the vault, in one vault transaction. */
export function killTx(keys: VaultKeys, seqno: number, agent: string) {
  const vault = vaultWallet(keys.publicKey).address;
  const to = Address.parse(agent);
  return signed(keys, seqno, [
    internal({ to, value: GAS, bounce: true, body: revokeBody() }),
    internal({ to, value: GAS, bounce: true, body: sweepBody(vault) }),
  ]);
}
