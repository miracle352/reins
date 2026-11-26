// Demo-only: mint a testnet address whose visible tail matches a target, the way address poisoners do.
// tsx tools/lookalike.ts <target-address> [workers]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { keyPairFromSeed } from '@ton/crypto';
import { randomBytes } from 'node:crypto';
import { WalletContractV5R1 } from '@ton/ton';
import { fmtUser } from '../shared/ton.ts';

if (isMainThread) {
  const target = fmtUser((await import('@ton/core')).Address.parse(process.argv[2]));
  const n = Number(process.argv[3] ?? 4);
  const tail = target.slice(-4);
  console.log('looking for *', tail, 'like', target);
  const t0 = Date.now(); let total = 0;
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: { tail }, execArgv: ['--import', 'tsx'] });
    w.on('message', m => {
      if (m.count) { total += m.count; if (i === 0) console.log(`${total} tried, ${Math.round(total / ((Date.now() - t0) / 1000))}/s`); return; }
      console.log(JSON.stringify(m)); process.exit(0);
    });
  }
} else {
  const { tail } = workerData as { tail: string };
  // One key, vary the wallet's 32-bit context id: each try is just a cell hash.
  const seed = randomBytes(32);
  const kp = keyPairFromSeed(seed);
  let c = 0;
  for (let context = randomBytes(4).readUInt32LE(0) & 0x3fffffff; ; context = (context + 1) & 0x7fffffff) {
    const w = WalletContractV5R1.create({ publicKey: kp.publicKey, walletId: { networkGlobalId: -3, context } });
    const addr = fmtUser(w.address);
    if (addr.endsWith(tail)) { parentPort!.postMessage({ address: addr, seed: seed.toString('hex'), context }); break; }
    if (++c % 20000 === 0) parentPort!.postMessage({ count: 20000 });
  }
}
