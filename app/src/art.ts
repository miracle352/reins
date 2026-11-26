// Everything the G2 text font can't do: big condensed numbers, three levels of brightness, verdict blocks,
// and address prints. Drawn on a canvas, sent as PNG; the glasses show 16 shades of green.
import { Address } from '@ton/core';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';

export const W = 288, H = 144; // the largest image the glasses take

// Three brightness levels. On a see-through display, dim means "background information".
const P = '#ffffff', S = '#767676', T = '#3a3a3a';
const FACE = '"Barlow Condensed", "Arial Narrow", sans-serif';

const fontsReady = Promise.all(['500', '700', '800'].map(w => document.fonts.load(`${w} 40px "Barlow Condensed"`))).catch(() => {});

const cache = new Map<string, Promise<Uint8Array>>();
const png = (c: HTMLCanvasElement) => new Promise<Uint8Array>((res, rej) =>
  c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('toBlob failed'))), 'image/png'));

type G = CanvasRenderingContext2D;
function memo(key: string, w: number, h: number, draw: (g: G) => void) {
  if (!cache.has(key)) cache.set(key, (async () => {
    await fontsReady;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.textBaseline = 'alphabetic';
    draw(g);
    return png(c);
  })());
  return cache.get(key)!;
}

const font = (g: G, size: number, weight = 700) => { g.font = `${weight} ${size}px ${FACE}`; };
/** Largest size up to `max` at which `text` fits `width`. */
function fit(g: G, text: string, width: number, max: number, weight = 700) {
  let s = max; font(g, s, weight);
  while (g.measureText(text).width > width && s > 8) { s -= 1; font(g, s, weight); }
  return s;
}
function label(g: G, text: string, x: number, y: number, color = S, size = 15, weight = 500, spacing = 1.2) {
  font(g, size, weight); g.fillStyle = color;
  g.letterSpacing = `${spacing}px`;
  g.fillText(text.toUpperCase(), x, y);
  g.letterSpacing = '0px';
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---------- address print ----------
/**
 * A ring code for an address: three rings of arcs and a notch, from the address hash.
 * A lookalike address copies the characters people glance at. It can't copy this.
 */
function drawPrint(g: G, address: string, cx: number, cy: number, r: number, color = P) {
  let hash: Buffer;
  try { hash = Address.parse(address).hash; } catch { return; }
  const bits = (i: number) => (hash[(i >> 3) % 32] >> (i & 7)) & 1;
  const rings = [{ n: 5, rr: r * 0.44 }, { n: 7, rr: r * 0.67 }, { n: 9, rr: r * 0.89 }];
  const width = r * 0.2;
  let k = 0;
  g.lineCap = 'butt';
  rings.forEach(({ n, rr }, ri) => {
    const step = (Math.PI * 2) / n, gap = Math.min(step * 0.22, 0.34);
    const rot = (hash[31 - ri] / 255) * step;
    for (let i = 0; i < n; i++) {
      const on = bits(k++);
      g.strokeStyle = on ? color : T; g.lineWidth = on ? width : Math.max(1, width * 0.25);
      g.beginPath(); g.arc(cx, cy, rr, rot + i * step + gap / 2, rot + (i + 1) * step - gap / 2); g.stroke();
    }
  });
  g.fillStyle = color; g.beginPath(); g.arc(cx, cy, r * 0.16, 0, Math.PI * 2); g.fill();
}
export const print = (address: string, size = 64) => memo(`p:${address}:${size}`, size, size, g => drawPrint(g, address, size / 2, size / 2, size / 2 - 2));

// ---------- tiles ----------
/** The amount, as large as the tile allows, with who asks above and where it goes below. */
export const amountTile = (kicker: string, amount: string, unit: string, foot: string) =>
  memo(`amt:${kicker}:${amount}:${unit}:${foot}`, W, H, g => {
    label(g, kicker, 2, 18);
    const s = fit(g, amount, W - 70, 92, 700);
    g.fillStyle = P; g.fillText(amount, 0, 104);
    const aw = g.measureText(amount).width;
    font(g, Math.round(s * 0.3), 600); g.fillStyle = S; g.fillText(unit, aw + 6, 104);
    font(g, 21, 500); g.fillStyle = P; g.fillText(clip(foot, 30), 2, 136);
  });

export type Verdict = 'SAFE' | 'STOP' | 'CHECK' | 'NEW AGENT' | 'ALARM';

/**
 * The verdict, readable in a glance. STOP and ALARM are a solid block: the only solid shapes Reins ever draws.
 * `prints`: one address, or [asked, known] for a lookalike (drawn side by side with ≠ between).
 */
export const verdictTile = (verdict: Verdict, reason: string, prints: { address: string; tag: string }[]) =>
  memo(`v:${verdict}:${reason}:${prints.map(p => p.address + p.tag).join(',')}`, W, H, g => {
    const solid = verdict === 'STOP' || verdict === 'ALARM';
    if (prints.length === 2) {
      // Lookalike: the block says STOP and why; below, the address it asked for next to the one it imitates.
      g.fillStyle = P; g.fillRect(0, 0, W, 54);
      g.fillStyle = '#000'; font(g, 52, 800); g.fillText(verdict, 10, 47);
      const vw = g.measureText(verdict).width;
      wrap(g, reason, vw + 24, 22, W - vw - 30, 19, 18, '#000', 2);
      const pr = 30, cy = 54 + 10 + pr, x1 = 72, x2 = W - 72;
      drawPrint(g, prints[0].address, x1, cy, pr);
      drawPrint(g, prints[1].address, x2, cy, pr, S);
      font(g, 44, 500); g.fillStyle = P; g.fillText('≠', W / 2 - g.measureText('≠').width / 2, cy + 15);
      centerLabel(g, prints[0].tag, x1, H - 1, P);
      centerLabel(g, prints[1].tag, x2, H - 1, S);
      return;
    }
    const pr = 34;
    const textW = prints.length ? W - pr * 2 - 18 : W - 8;
    if (solid) {
      g.fillStyle = P; g.fillRect(0, 0, textW, 54);
      g.fillStyle = '#000'; fit(g, verdict, textW - 20, 52, 800); g.fillText(verdict, 10, 47);
    } else {
      g.fillStyle = P; fit(g, verdict, textW - 4, 56, 800); g.fillText(verdict, 0, 48);
    }
    wrap(g, reason, 2, 80, textW, 21, 19, solid ? P : S, 3);
    if (prints[0]) {
      const cx = W - pr - 2;
      drawPrint(g, prints[0].address, cx, 6 + pr, pr);
      centerLabel(g, prints[0].tag, cx, pr * 2 + 28, S);
    }
  });

function centerLabel(g: G, text: string, cx: number, y: number, color: string) {
  font(g, 14, 600); g.letterSpacing = '1.2px'; g.fillStyle = color;
  const t = clip(text, 14).toUpperCase(); g.fillText(t, cx - g.measureText(t).width / 2, y);
  g.letterSpacing = '0px';
}

function wrap(g: G, text: string, x: number, y: number, w: number, lh: number, size: number, color: string, max: number) {
  font(g, size, 500); g.fillStyle = color;
  const words = text.split(/\s+/); let cur = '', n = 0;
  for (const word of words) {
    const t = cur ? cur + ' ' + word : word;
    if (g.measureText(t).width > w && cur) { g.fillText(cur, x, y + n * lh); n++; cur = word; if (n >= max) return; }
    else cur = t;
  }
  if (cur && n < max) g.fillText(cur, x, y + n * lh);
}

/** Home, left: one word for how things are, one line of numbers. */
export const statusTile = (word: string, sub: string, solid = false) =>
  memo(`st:${word}:${sub}:${solid}`, W, H, g => {
    label(g, 'Reins', 2, 18, T, 15, 700, 3);
    if (solid) { g.fillStyle = P; g.fillRect(0, 30, W, 70); g.fillStyle = '#000'; fit(g, word, W - 24, 64, 800); g.fillText(word, 10, 90); }
    else { g.fillStyle = P; fit(g, word, W - 8, 72, 800); g.fillText(word, 0, 92); }
    font(g, 20, 500); g.fillStyle = S; g.fillText(clip(sub, 34), 2, 128);
  });

/** Home, right: spent today against the day's budgets, as a gauge you read without reading. */
export const gaugeTile = (spent: number, budget: number, kicker: string, foot: string) =>
  memo(`g:${spent}:${budget}:${kicker}:${foot}`, W, H, g => {
    label(g, kicker, 14, 18);
    const v = fmt(spent);
    g.fillStyle = P; fit(g, v, 150, 64, 700); g.fillText(v, 12, 82);
    const vw = g.measureText(v).width;
    font(g, 22, 600); g.fillStyle = S; g.fillText(`/ ${fmt(budget)}`, 18 + vw, 82);
    // 24 ticks; lit up to the share spent
    const n = 24, x0 = 14, x1 = W - 6, lit = budget > 0 ? Math.round(Math.min(1, spent / budget) * n) : 0;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) / n) * i;
      g.fillStyle = i < lit ? P : T; g.fillRect(Math.round(x), 96, Math.round((x1 - x0) / n) - 3, i < lit ? 14 : 6);
    }
    font(g, 17, 500); g.fillStyle = S; g.fillText(clip(foot, 36), 14, 136);
  });

/** One agent, left: its name large and what it is doing. */
export const agentTile = (name: string, status: string, address: string) =>
  memo(`ag:${name}:${status}:${address}`, W, H, g => {
    label(g, 'Agent', 2, 18);
    g.fillStyle = P; fit(g, name, W - 84, 60, 700); g.fillText(name, 0, 76);
    font(g, 21, 500); g.fillStyle = status === 'PAUSED' ? P : S; g.fillText(status, 2, 108);
    drawPrint(g, address, W - 36, 44, 32, S);
    label(g, 'its wallet', W - 70, 98, T, 12);
  });

/** Centered headline with a line of detail: results, splash. */
export const headlineTile = (word: string, detail: string, solid = false) =>
  memo(`h:${word}:${detail}:${solid}`, W, H, g => {
    const s = fit(g, word, W - 24, 78, 800);
    const ww = g.measureText(word).width;
    if (solid) { g.fillStyle = P; g.fillRect((W - ww) / 2 - 12, 10, ww + 24, s * 0.86 + 6); g.fillStyle = '#000'; }
    else g.fillStyle = P;
    g.fillText(word, (W - ww) / 2, 10 + s * 0.78);
    font(g, 18, 500); g.fillStyle = S;
    detail.split('\n').slice(0, 2).forEach((l, i) => { const t = clip(l, 40); g.fillText(t, (W - g.measureText(t).width) / 2, 112 + i * 22); });
  });

/** The wordmark: five letters and the rein, a line held at one end. */
export const wordmark = () => memo('wordmark', W, H, g => {
  g.fillStyle = P; font(g, 84, 800); g.letterSpacing = '6px';
  const t = 'REINS'; const tw = g.measureText(t).width; g.fillText(t, (W - tw) / 2, 86); g.letterSpacing = '0px';
  g.strokeStyle = S; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 108); g.bezierCurveTo(110, 136, 180, 92, 254, 112); g.stroke();
  g.fillStyle = P; g.beginPath(); g.arc(254, 112, 4, 0, Math.PI * 2); g.fill();
});

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : String(+n.toFixed(3)));
