// Every check here is plain code. No model decides whether money moves.
import { Address } from '@ton/core';
import { isLookalike, sameAddress } from '../../shared/ton.ts';

export type Contact = { address: string; name: string; trusted: boolean; autoLimit: string /* nanoGRAM */ };
export type Flag =
  | { code: 'NEW'; text: string }
  | { code: 'LOOKALIKE'; text: string }
  | { code: 'MISMATCH'; text: string }
  | { code: 'OVER_LIMIT'; text: string }
  | { code: 'DAILY_CAP'; text: string }
  | { code: 'BAD_ADDRESS'; text: string }
  | { code: 'NAME_TAKEN'; text: string };

export type Limits = { perPayment: bigint; daily: bigint };
export const DEFAULT_LIMITS: Limits = { perPayment: 1_000_000_000n, daily: 3_000_000_000n };

const NANO = 1_000_000_000n;
export const gram = (n: bigint) => {
  const whole = n / NANO, frac = (n % NANO).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`; // never round: what you see is what gets signed
};
export const toNanoStr = (s: string) => {
  const [w, f = ''] = s.trim().split('.');
  return BigInt(w || '0') * NANO + BigInt((f + '000000000').slice(0, 9));
};

/** Amounts the agent itself wrote in its stated purpose ("pay the 4.2 GRAM invoice"). */
export function amountsInText(text: string): bigint[] {
  const out: bigint[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:gram|ton|💎)/gi)) out.push(toNanoStr(m[1]));
  return out;
}

export type Verdict = { auto: boolean; flags: Flag[]; contact?: Contact };

export function evaluate(p: {
  to: string; amount: bigint; purpose: string;
  contacts: Contact[]; spentToday: bigint; limits: Limits; bufferLeft: bigint;
}): Verdict {
  const flags: Flag[] = [];
  try { Address.parse(p.to); } catch { return { auto: false, flags: [{ code: 'BAD_ADDRESS', text: 'not a TON address' }] }; }

  const contact = p.contacts.find(c => sameAddress(c.address, p.to));
  if (!contact) {
    flags.push({ code: 'NEW', text: 'never paid before' });
    const twin = p.contacts.find(c => isLookalike(c.address, p.to));
    if (twin) flags.push({ code: 'LOOKALIKE', text: `looks like ${twin.name}` });
  }
  const stated = amountsInText(p.purpose);
  if (stated.length && !stated.includes(p.amount)) {
    flags.push({ code: 'MISMATCH', text: `said ${gram(stated[0])}, asks ${gram(p.amount)}` });
  }
  if (p.amount > p.limits.perPayment) flags.push({ code: 'OVER_LIMIT', text: `over ${gram(p.limits.perPayment)} limit` });
  if (p.spentToday + p.amount > p.limits.daily) flags.push({ code: 'DAILY_CAP', text: `daily cap ${gram(p.limits.daily)}` });

  const auto = !!contact?.trusted && flags.length === 0
    && p.amount <= BigInt(contact.autoLimit) && p.amount <= p.bufferLeft;
  return { auto, flags, contact };
}
