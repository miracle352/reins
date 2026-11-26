// Message builders for TON's agentic wallet standard (the-ton-tech/agentic-wallet-contract).
// Written from the contract's message definitions; contract code BOC taken from @ton/mcp (MIT).
import { Address, beginCell, Cell, contractAddress, internal, SendMode, storeOutList, type StateInit } from '@ton/core';
import { WalletContractV5R1 } from '@ton/ton';
import { sign } from '@ton/crypto';
import { AGENT_CODE_HEX } from './agentic-wallet-code.ts';

export const COLLECTION = Address.parse('EQByQ19qvWxW7VibSbGEgZiYMqilHY5y1a_eeSL2VaXhfy07');
export const TESTNET_GLOBAL_ID = -3;
export const AGENT_CODE = Cell.fromBoc(Buffer.from(AGENT_CODE_HEX, 'hex'))[0];

const OP = {
  deploy: 0x0609e47b,
  changeOperator: 0xea4e36cf,
  extensionAction: 0xed84cbf0,
  externalSigned: 0xbf235204,
} as const;

export const toUint256 = (b: Uint8Array) => BigInt('0x' + Buffer.from(b).toString('hex'));
export const fmt = (a: Address) => a.toString({ testOnly: true, bounceable: true });
export const fmtUser = (a: Address) => a.toString({ testOnly: true, bounceable: false });

export function vaultWallet(publicKey: Buffer) {
  return WalletContractV5R1.create({ publicKey, walletId: { networkGlobalId: TESTNET_GLOBAL_ID } });
}

export function agentIndex(owner: Address, operatorPub: bigint): bigint {
  const seed = beginCell().storeAddress(owner).storeUint(operatorPub, 256).storeBit(true).endCell();
  return BigInt('0x' + seed.hash().toString('hex'));
}

export function agentStateInit(index: bigint): StateInit {
  const data = beginCell()
    .storeUint(index, 256).storeAddress(COLLECTION)
    .storeBit(true).storeUint(0, 32).storeDict(null).storeMaybeRef(null)
    .endCell();
  return { code: AGENT_CODE, data };
}

export function agentAddress(owner: Address, operatorPub: bigint) {
  const index = agentIndex(owner, operatorPub);
  return { index, address: contractAddress(0, agentStateInit(index)), init: agentStateInit(index) };
}

// ---- owner (vault) -> agent messages ----

export function deployBody(owner: Address, operatorPub: bigint, queryId = 0n) {
  const walletData = beginCell()
    .storeAddress(owner).storeMaybeRef(null)
    .storeUint(operatorPub, 256).storeUint(operatorPub, 256).storeBit(true)
    .endCell();
  return beginCell().storeUint(OP.deploy, 32).storeUint(queryId, 64).storeRef(walletData).storeUint(0, 256).endCell();
}

/** Kill switch: an operator key of 0 makes every future agent signature invalid. */
export function revokeBody(queryId = BigInt(Date.now())) {
  return beginCell().storeUint(OP.changeOperator, 32).storeUint(queryId, 64).storeUint(0n, 256).endCell();
}

/** Owner acts as an irremovable extension: send the whole balance back to `to`. */
export function sweepBody(to: Address, queryId = BigInt(Date.now())) {
  const out = beginCell().store(storeOutList([{
    type: 'sendMsg', mode: SendMode.CARRY_ALL_REMAINING_BALANCE,
    outMsg: internal({ to, value: 0n, bounce: false }),
  }])).endCell();
  return beginCell().storeUint(OP.extensionAction, 32).storeUint(queryId, 64).storeMaybeRef(out).storeBit(false).endCell();
}

// ---- agent (operator key) -> its own wallet ----

/** External message the agent signs to pay. Mode MUST include IGNORE_ERRORS or the wallet exits 137. */
export function agentPayBody(p: { index: bigint; seqno: number; to: Address; amount: bigint; secretKey: Buffer; validFor?: number; comment?: string }) {
  const outActions = beginCell().store(storeOutList([{
    type: 'sendMsg', mode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    outMsg: internal({ to: p.to, value: p.amount, bounce: false, body: p.comment }),
  }])).endCell();
  const unsigned = beginCell()
    .storeUint(OP.externalSigned, 32).storeUint(p.index, 256)
    .storeUint(Math.floor(Date.now() / 1000) + (p.validFor ?? 120), 32).storeUint(p.seqno, 32)
    .storeMaybeRef(outActions).storeMaybeRef(null)
    .endCell();
  return beginCell().storeSlice(unsigned.beginParse()).storeBuffer(sign(unsigned.hash(), p.secretKey)).endCell();
}

// ---- address safety (pure code, no AI) ----

/**
 * Address poisoning: attackers mint addresses that share the part wallets display ("0QCM…dN3se").
 * The first two characters are a fixed tag, so compare the 4 after them, or the last 4.
 * A random match on either is ~1 in 16 million, so any hit is deliberate.
 */
export function isLookalike(a: string, b: string) {
  const A = Address.parse(a), B = Address.parse(b);
  if (A.equals(B)) return false;
  const fa = fmtUser(A), fb = fmtUser(B);
  return fa.slice(2, 6) === fb.slice(2, 6) || fa.slice(-4) === fb.slice(-4);
}

export const sameAddress = (a: string, b: string) => Address.parse(a).equals(Address.parse(b));
