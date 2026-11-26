// Things text can't do on G2: big type and address fingerprints.
// Drawn on a canvas and sent as PNG; the SDK converts to the 16-shade display.
import { Address } from '@ton/core';

const cache = new Map<string, Promise<Uint8Array>>();
const png = (c: HTMLCanvasElement) => new Promise<Uint8Array>((res, rej) =>
  c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('toBlob failed'))), 'image/png'));

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  return { c, g };
}

/** Big, glanceable type. Shrinks to fit the box. */
export function bigText(text: string, w: number, h: number, opts: { weight?: number; align?: 'left' | 'center'; sub?: string } = {}) {
  const key = `t:${text}:${w}x${h}:${opts.weight}:${opts.align}:${opts.sub}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const { c, g } = canvas(w, h);
    const subH = opts.sub ? Math.round(h * 0.28) : 0;
    let size = Math.round((h - subH) * 0.92);
    const font = (s: number) => `${opts.weight ?? 700} ${s}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    g.font = font(size);
    while (g.measureText(text).width > w - 4 && size > 10) { size -= 2; g.font = font(size); }
    g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
    const x = opts.align === 'center' ? (w - g.measureText(text).width) / 2 : 2;
    g.fillText(text, x, h - subH - Math.round(size * 0.18));
    if (opts.sub) {
      g.font = font(Math.round(subH * 0.8)).replace(/^\d+/, '500');
      g.fillStyle = '#9a9a9a';
      g.fillText(opts.sub, x, h - 4);
    }
    return png(c);
  })());
  return cache.get(key)!;
}

/**
 * A fingerprint for an address: a 5x5 mirrored pattern in three shades, from the address hash.
 * Lookalike addresses copy the text people glance at; they cannot copy this.
 */
export function fingerprint(address: string, size = 72) {
  const key = `f:${address}:${size}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const hash = Address.parse(address).hash; // 32 bytes
    const { c, g } = canvas(size, size);
    const pad = 4, cell = Math.floor((size - pad * 2) / 5), off = Math.floor((size - cell * 5) / 2);
    g.strokeStyle = '#555'; g.lineWidth = 2; g.strokeRect(1, 1, size - 2, size - 2);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
      const v = hash[row * 3 + col] & 0x0f;
      const shade = v < 6 ? null : v < 11 ? '#7a7a7a' : '#ffffff';
      if (!shade) continue;
      g.fillStyle = shade;
      for (const cx of new Set([col, 4 - col])) g.fillRect(off + cx * cell + 1, off + row * cell + 1, cell - 2, cell - 2);
    }
    return png(c);
  })());
  return cache.get(key)!;
}

/** Splash mark: the wordmark plus a small rein line. */
export const splash = () => bigText('REINS', 288, 96, { align: 'center', sub: 'you hold the reins' });
