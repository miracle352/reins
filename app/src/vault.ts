// The vault key lives on the user's phone (Even app storage). It never goes to the server.
import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto';
import { vaultWallet, fmtUser } from '../../shared/ton.ts';
import type { VaultKeys } from '../../shared/vault.ts';

type Storage = { get(k: string): Promise<string>; set(k: string, v: string): Promise<boolean> };
const KEY = 'reins.vault.words';

export type Vault = { keys: VaultKeys; address: string; words: string[] };

async function fromWords(words: string[]): Promise<Vault> {
  const keys = await mnemonicToPrivateKey(words);
  return { keys, words, address: fmtUser(vaultWallet(keys.publicKey).address) };
}

export async function loadVault(store: Storage): Promise<Vault | null> {
  let raw = await store.get(KEY).catch(() => '');
  const dev = import.meta.env.VITE_DEV_VAULT_WORDS as string | undefined; // local testing only, never shipped
  if (!raw && dev) { raw = dev; await store.set(KEY, dev); }
  if (!raw) return null;
  return fromWords(raw.trim().split(/\s+/));
}

export async function createVault(store: Storage): Promise<Vault> {
  const words = await mnemonicNew();
  await store.set(KEY, words.join(' '));
  return fromWords(words);
}

export async function importVault(store: Storage, text: string): Promise<Vault> {
  const words = text.trim().toLowerCase().split(/\s+/);
  if (!(await mnemonicValidate(words))) throw new Error('Those 24 words are not a valid TON key.');
  await store.set(KEY, words.join(' '));
  return fromWords(words);
}
