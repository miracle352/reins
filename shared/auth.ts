// Request signing. Agents sign every call with their operator key; the lens proves it holds the vault key once,
// then uses a device token. The server never sees either private key.
import { sha256_sync, sign, signVerify } from '@ton/crypto';

const enc = (s: string) => Buffer.from(s, 'utf8');
const MAX_SKEW = 5 * 60_000;

export const agentMessage = (method: string, path: string, ts: number, body: string) =>
  enc(`reins-agent\n${method} ${path}\n${ts}\n${sha256_sync(enc(body)).toString('hex')}`);

/** Value for the x-reins-sig header. */
export function signAgent(secretKey: Buffer, method: string, path: string, body: string, ts = Date.now()) {
  return `${ts}.${sign(agentMessage(method, path, ts, body), secretKey).toString('hex')}`;
}

export function verifyAgent(pubHex: string, header: string | undefined, method: string, path: string, body: string) {
  if (!header) return false;
  const [tsS, sig] = header.split('.');
  const ts = Number(tsS);
  if (!ts || Math.abs(Date.now() - ts) > MAX_SKEW || !/^[0-9a-f]{128}$/.test(sig ?? '')) return false;
  return signVerify(agentMessage(method, path, ts, body), Buffer.from(sig, 'hex'), Buffer.from(pubHex, 'hex'));
}

export const loginMessage = (vault: string, ts: number) => enc(`reins-login\n${vault}\n${ts}`);
export const signLogin = (secretKey: Buffer, vault: string, ts = Date.now()) => ({ ts, sig: sign(loginMessage(vault, ts), secretKey).toString('hex') });
export function verifyLogin(pub: Buffer, vault: string, ts: number, sig: string) {
  if (!ts || Math.abs(Date.now() - ts) > MAX_SKEW || !/^[0-9a-f]{128}$/.test(sig)) return false;
  return signVerify(loginMessage(vault, ts), Buffer.from(sig, 'hex'), pub);
}
