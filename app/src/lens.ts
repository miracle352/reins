// The lens: 576x288, 16 shades of green. One decision per screen, the number big, the safe choice first.
import { bigText, fingerprint } from './art.ts';

export type Flag = { code: string; text: string };
export type Card = {
  id: string; kind: 'create' | 'pay'; agent: string; purpose: string; flags: Flag[];
  amount: string; amountNano: string; to?: string; toName?: string; agentAddress: string; operatorPub: string;
  twin?: { name: string; address: string };
};
export type AgentRow = {
  id: string; name: string; address: string; status: string; balance: string;
  spentToday: string; daily: string; waiting: number; last: { amount: string; to: string; at: number } | null;
};
export type State = {
  vault: string | null; vaultBalance: string; atRisk: string; spentToday: string;
  agents: AgentRow[];
  alarm: { agentId: string; agent: string; text: string; agentAddress: string; amount?: string; to?: string } | null;
  pending: Card | null; pendingCount: number; ticker: string[]; telegram: string | null;
};

export type Action =
  | 'approve' | 'trust' | 'reject' | 'kill' | 'back' | 'voice' | 'activity' | 'give' | 'pause' | 'resume'
  | 'dismiss' | 'cancel' | 'yesKill' | 'yesGive' | `agent:${string}`;
export type Txt = { x: number; y: number; w: number; h: number; content: string };
export type Img = { x: number; y: number; w: number; h: number; key: string; draw: () => Promise<Uint8Array> };
export type Page = { texts: Txt[]; images?: Img[]; items?: string[]; actions?: Action[]; listTop?: number };

/** The 4 chars after the fixed "0Q" tag and the last 4: exactly what the lookalike rule compares. */
export const short = (a: string) => `${a.slice(2, 6)}…${a.slice(-4)}`;
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
const live = (s: State) => s.agents.filter(a => a.status === 'active' || a.status === 'frozen');
const fit = (s: string, n = 46) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const num = (s: string) => Number(s);

/** A 10-step budget bar: thick for spent, thin for what is left. */
export function bar(spent: string, total: string, n = 10) {
  const f = Math.max(0, Math.min(n, Math.round((num(spent) / Math.max(num(total), 1e-9)) * n)));
  return '━'.repeat(f) + '─'.repeat(n - f);
}

const full = (content: string, h = 288): Txt => ({ x: 0, y: 0, w: 576, h, content });
const bigAmount = (amount: string, sub?: string): Img => ({ x: 0, y: 34, w: 288, h: 64, key: `amt:${amount}:${sub}`, draw: () => bigText(`${amount} GRAM`, 288, 64, { sub }) });
const glyph = (address: string, x: number): Img => ({ x, y: 4, w: 72, h: 72, key: `fp:${address}`, draw: () => fingerprint(address, 72) });

// ---------- home ----------
export function home(s: State): Page {
  const agents = live(s);
  const working = agents.filter(a => a.status === 'active').length;
  const head = [
    `${working ? '●' : '○'} ${working} agent${working === 1 ? '' : 's'} working   ·   ${s.atRisk} GRAM at risk`,
    `Today ${s.spentToday} spent   ·   vault ${s.vaultBalance}`,
  ].join('\n');
  const items: string[] = [], actions: Action[] = [];
  for (const a of agents) {
    items.push(a.status === 'frozen'
      ? `○ ${a.name}   paused   ${a.spentToday}/${a.daily}`
      : `● ${a.name}   ${bar(a.spentToday, a.daily)}   ${a.spentToday}/${a.daily}`);
    actions.push(`agent:${a.id}`);
  }
  items.push('≈ Speak a command', '… Activity'); actions.push('voice', 'activity');
  return { texts: [full(head, 70)], items, actions, listTop: 72 };
}

// ---------- one agent ----------
export function agentPage(a: AgentRow): Page {
  const paused = a.status === 'frozen';
  const body = [
    `Wallet ${a.balance} GRAM`,
    `Today ${bar(a.spentToday, a.daily, 12)} ${a.spentToday} of ${a.daily}`,
    a.last ? `Last ${a.last.amount} → ${a.last.to}, ${ago(a.last.at)}` : 'No payments yet',
  ].join('\n');
  return {
    texts: [{ x: 0, y: 0, w: 420, h: 36, content: `${paused ? '○' : '●'} ${a.name} · ${paused ? 'PAUSED' : 'working'}${a.waiting ? ` · ${a.waiting} waiting` : ''}` },
            { x: 0, y: 38, w: 496, h: 110, content: body }],
    images: [glyph(a.address, 500)],
    items: ['← Back', '≈ Speak a command', '+ Give 0.5 more today', paused ? '▶ Resume' : '○ Pause', `■ Kill ${a.name}`],
    actions: ['back', 'voice', 'give', paused ? 'resume' : 'pause', 'kill'],
    listTop: 150,
  };
}

// ---------- a request ----------
export const isClean = (c: Card) => c.kind === 'create' || c.flags.length === 0;

export function card(c: Card, waiting: number): Page {
  const more = waiting > 1 ? ` · ${waiting - 1} more waiting` : '';
  if (c.kind === 'create') {
    return {
      texts: [{ x: 0, y: 0, w: 420, h: 34, content: `${c.agent} wants a wallet${more}` },
              { x: 0, y: 98, w: 576, h: 84, content: 'Its starting buffer. Anything beyond its rules\ncomes back to you here.\n≈ say "approve" or "reject"' },
              { x: 470, y: 72, w: 106, h: 34, content: 'its wallet' }],
      images: [bigAmount(c.amount), glyph(c.agentAddress, 500)],
      items: [`▶ Create wallet  ${c.amount}`, '× Reject'], actions: ['approve', 'reject'], listTop: 182,
    };
  }
  const who = c.toName ?? short(c.to!);
  const clean = isClean(c);
  const twin = c.flags.some(f => f.code === 'LOOKALIKE') ? c.twin : undefined;
  const images: Img[] = [bigAmount(c.amount)];
  let label: string;
  if (twin) { images.push(glyph(c.to!, 420), glyph(twin.address, 500)); label = ' this  ≠  known'; }
  else { images.push(glyph(c.to!, 500)); label = clean ? ' known' : ' new'; }
  const lines = [`→ ${who}   "${fit(c.purpose, 36)}"`];
  if (clean) lines.push('● known payee · matches what it said');
  else lines.push(c.flags.slice(0, 2).map(f => `! ${f.text}`).join('   '));
  const hint = clean ? '≈ say "approve"' : '≈ tap to approve · say "why"';
  const texts: Txt[] = [{ x: 0, y: 0, w: 416, h: 34, content: `${c.agent} asks${more}   ${hint}` },
                        { x: 0, y: 100, w: 576, h: 62, content: lines.join('\n') },
                        { x: twin ? 418 : 470, y: 72, w: twin ? 158 : 106, h: 34, content: label }];
  if (clean) {
    // Smart default: a clean request to a known payee is one tap away.
    return { texts, images, items: [`▶ Approve ${c.amount}`, '× Reject', '★ Approve & always trust', `■ Kill ${c.agent}`], actions: ['approve', 'reject', 'trust', 'kill'], listTop: 166 };
  }
  // Flagged: Reject is item 0. The SDK drops zero values, so an ambiguous tap lands on Reject.
  const items = ['× Reject', `▶ Fund once  ${c.amount}`]; const actions: Action[] = ['reject', 'approve'];
  if (!c.flags.some(f => f.code === 'LOOKALIKE' || f.code === 'MISMATCH')) { items.push('★ Fund & trust payee'); actions.push('trust'); }
  items.push(`■ Kill ${c.agent}`); actions.push('kill');
  return { texts, images, items, actions, listTop: 166 };
}

const WHY: Record<string, string> = {
  NEW: 'Your agents have never paid this address.',
  LOOKALIKE: 'It copies the visible start or end of a payee you know. Compare the two patterns: they differ. That is address poisoning.',
  MISMATCH: 'The agent wrote one amount in its reason and asked for another. Typical of a hijacked or confused agent.',
  OVER_LIMIT: 'It is more than a single payment is allowed to be.',
  DAILY_CAP: 'It would take this agent over its budget for today.',
  BAD_ADDRESS: 'That is not a valid TON address.',
};
export function why(c: Card): Page {
  const body = c.flags.length
    ? c.flags.slice(0, 3).map(f => `! ${f.text}\n   ${WHY[f.code] ?? ''}`).join('\n')
    : 'Nothing looks off: a payee you know, and the amount\nmatches what the agent said.';
  return { texts: [full(body, 234)], items: ['← Back to the request'], actions: ['back'], listTop: 236 };
}

// ---------- alarm, confirms, activity, notes ----------
export function alarm(a: NonNullable<State['alarm']>, atRisk: string): Page {
  const images: Img[] = [];
  const texts: Txt[] = [{ x: 0, y: 0, w: 416, h: 34, content: `■ ALARM · ${a.agent}` }];
  if (a.amount && a.to) {
    images.push({ x: 0, y: 34, w: 288, h: 64, key: `alarm:${a.amount}`, draw: () => bigText(`${a.amount} GRAM`, 288, 64, { sub: 'left with no approval' }) }, glyph(a.to, 500));
    texts.push({ x: 470, y: 72, w: 106, h: 34, content: short(a.to) },
               { x: 0, y: 98, w: 576, h: 84, content: `Still at risk: ${atRisk} GRAM\nKill revokes its key and pulls the rest back.\n≈ say "kill it"` });
  } else {
    texts.push({ x: 0, y: 40, w: 576, h: 138, content: `${a.text}\n\nStill at risk: ${atRisk} GRAM\n≈ say "kill it"` });
  }
  return { texts, images, items: [`■ Kill ${a.agent} now`, '× Dismiss'], actions: ['kill', 'dismiss'], listTop: 182 };
}

export const confirmKill = (agent: string, balance: string): Page => ({
  texts: [{ x: 0, y: 0, w: 576, h: 34, content: `Kill ${agent}?` },
          { x: 0, y: 98, w: 576, h: 84, content: 'Its key is revoked on chain. It can never spend again.\n≈ say "yes" or "no"' }],
  images: [{ x: 0, y: 34, w: 288, h: 64, key: `kill:${balance}`, draw: () => bigText(`${balance} GRAM`, 288, 64, { sub: 'comes back to your vault' }) }],
  items: ['× Cancel', '■ Yes, kill it'], actions: ['cancel', 'yesKill'], listTop: 182,
});
export const confirmGive = (a: AgentRow, amount: number): Page => ({
  texts: [{ x: 0, y: 0, w: 576, h: 34, content: `Give ${a.name}` },
          { x: 0, y: 98, w: 576, h: 84, content: `From your vault to its wallet, now.\nToday's budget becomes ${+(num(a.daily) + amount).toFixed(3)} GRAM.\n≈ say "yes" or "no"` }],
  images: [bigAmount(String(amount))],
  items: ['× Cancel', `▶ Yes, send ${amount}`], actions: ['cancel', 'yesGive'], listTop: 182,
});
export const activity = (s: State): Page => ({
  texts: [full(s.ticker.map(t => `· ${fit(t, 62)}`).join('\n') || 'Nothing yet.', 234)],
  items: ['← Back'], actions: ['back'], listTop: 236,
});

/** The firmware cannot center text, so estimate the width (~8.7 px per character in the G2 font) and offset the box. */
const centered = (content: string, y: number, h: number): Txt => {
  const longest = Math.max(...content.split('\n').map(l => l.length));
  const w = Math.min(576, Math.ceil(longest * 8.7) + 12);
  return { x: Math.max(0, Math.floor((576 - w) / 2)), y, w: 576 - Math.max(0, Math.floor((576 - w) / 2)), h, content };
};

/** A result: big headline, one line of detail. */
export const result = (headline: string, detail: string): Page => ({
  texts: [centered(detail, 150, 120)],
  images: [{ x: 144, y: 40, w: 288, h: 96, key: `res:${headline}`, draw: () => bigText(headline, 288, 96, { align: 'center' }) }],
});
export const note = (text: string): Page => ({ texts: [full(text)] });
export const listening = (hint: string, level: number): Page => ({
  texts: [{ x: 0, y: 0, w: 576, h: 40, content: '≈ Listening' },
          { x: 0, y: 44, w: 576, h: 40, content: bar(String(level), '1', 20) },
          { x: 0, y: 100, w: 576, h: 180, content: hint }],
});
export const splashPage = (tagline: string): Page => ({
  texts: [centered(tagline, 170, 40)],
  images: [{ x: 144, y: 60, w: 288, h: 96, key: 'splash', draw: () => bigText('REINS', 288, 96, { align: 'center' }) }],
});
