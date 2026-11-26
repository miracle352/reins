// Prints a fresh testnet wallet address (demo recipients).
import { keyPairFromSeed } from '@ton/crypto';
import { randomBytes } from 'node:crypto';
import { vaultWallet, fmtUser } from '../shared/ton.ts';
console.log(fmtUser(vaultWallet(keyPairFromSeed(randomBytes(32)).publicKey).address));
