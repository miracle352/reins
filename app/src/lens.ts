// The lens: 576x288, 16 shades of green. One decision per screen, the number big, the safe choice first.
import * as A from './art.ts';

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
  | 'dismiss' | 'cancel' | 'yesKill' | 'yesGive' | 'why' | `agent:${string}`;
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
// Layout: two 288x144 tiles across the top carry the meaning; the native list below carries the choices.
const LIST = 150;
const left = (key: string, draw: () => Promise<Uint8Array>): Img => ({ x: 0, y: 0, w: A.W, h: A.H, key, draw });
const right = (key: string, draw: () => Promise<Uint8Array>): Img => ({ x: 288, y: 0, w: A.W, h: A.H, key, draw });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentences = (flags: Flag[]) => [...flags].sort((a, b) => +STOPS.includes(b.code) - +STOPS.includes(a.code)).slice(0, 2).map(f => cap(f.text) + '.').join(' ');

// ---------- home ----------
export function home(s: State): Page {
  const agents = live(s);
  const working = agents.filter(a => a.status === 'active').length;
  const paused = agents.length - working;
  const empty = num(s.vaultBalance) < 0.05 && !agents.length;
  const word = empty ? 'TOP UP' : !agents.length ? 'NO AGENTS' : paused ? `${paused} PAUSED` : 'ALL CLEAR';
  const sub = empty ? 'Add GRAM to your vault from your phone' : !agents.length ? 'Connect one from your phone' : `${working} working · ${s.atRisk} GRAM out`;
  const budget = agents.reduce((t, a) => t + num(a.daily), 0);
  const items: string[] = [], actions: Action[] = [];
  for (const a of agents) {
    items.push(`${a.status === 'frozen' ? '○' : '●'} ${a.name}   ${a.status === 'frozen' ? 'paused' : `${a.spentToday} of ${a.daily} today`}`);
    actions.push(`agent:${a.id}`);
  }
  items.push('≈ Speak a command', '… What happened today'); actions.push('voice', 'activity');
  return {
    texts: [],
    images: [left(`home:${word}:${sub}`, () => A.statusTile(word, sub)),
             right(`gauge:${s.spentToday}:${budget}:${s.vaultBalance}`, () => A.gaugeTile(num(s.spentToday), budget, 'Spent today', `Vault ${s.vaultBalance} GRAM`))],
    items, actions, listTop: LIST,
  };
}

// ---------- one agent ----------
export function agentPage(a: AgentRow): Page {
  const paused = a.status === 'frozen';
  const status = paused ? 'PAUSED' : `${a.balance} GRAM in its wallet${a.waiting ? ` · ${a.waiting} waiting` : ''}`;
  const foot = a.last ? `Last ${a.last.amount} → ${a.last.to}, ${ago(a.last.at)}` : 'No payments yet';
  return {
    texts: [],
    images: [left(`agent:${a.name}:${status}`, () => A.agentTile(a.name, status, a.address)),
             right(`agauge:${a.spentToday}:${a.daily}:${foot}`, () => A.gaugeTile(num(a.spentToday), num(a.daily), 'Today', foot))],
    items: ['← Back', '≈ Speak a command', '+ Give 0.5 more today', paused ? '▶ Resume' : '○ Pause', `■ Kill ${a.name}`],
    actions: ['back', 'voice', 'give', paused ? 'resume' : 'pause', 'kill'],
    listTop: LIST,
  };
}

// ---------- a request ----------
export const isClean = (c: Card) => c.flags.length === 0;
const STOPS = ['LOOKALIKE', 'MISMATCH', 'BAD_ADDRESS', 'NAME_TAKEN'];

export function card(c: Card, waiting: number): Page {
  const more = waiting > 1 ? ` · ${waiting - 1} more` : '';
  if (c.kind === 'create') {
    const clash = c.flags.length > 0;
    const reason = clash ? `${cap(c.flags[0].text)}. Same name, different key.` : 'Anything beyond its rules comes back to you here.';
    const verdict: A.Verdict = clash ? 'STOP' : 'NEW AGENT';
    return {
      texts: [],
      images: [left(`camt:${c.agent}:${c.amount}${more}`, () => A.amountTile(`${c.agent} wants a wallet${more}`, c.amount, 'GRAM', 'its starting buffer')),
               right(`cv:${verdict}:${c.agentAddress}`, () => A.verdictTile(verdict, reason, [{ address: c.agentAddress, tag: 'its wallet' }]))],
      ...(clash
        ? { items: ['× Reject', `▶ Create anyway  ${c.amount}`], actions: ['reject', 'approve'] as Action[] }
        : { items: [`▶ Create wallet  ${c.amount}`, '× Reject'], actions: ['approve', 'reject'] as Action[] }),
      listTop: LIST,
    };
  }
  const who = c.toName ?? short(c.to!);
  const clean = isClean(c);
  const twin = c.flags.some(f => f.code === 'LOOKALIKE') ? c.twin : undefined;
  const verdict: A.Verdict = clean ? 'SAFE' : c.flags.some(f => STOPS.includes(f.code)) ? 'STOP' : 'CHECK';
  const reason = clean ? 'Known payee. The amount matches what it said.' : sentences(c.flags);
  const prints = twin ? [{ address: c.to!, tag: 'asked' }, { address: twin.address, tag: twin.name }]
                      : [{ address: c.to!, tag: c.toName ? 'known' : 'new' }];
  const kicker = `${c.agent} asks${more} · say "${clean ? 'approve' : 'why'}"`;
  const images = [left(`pamt:${kicker}:${c.amount}:${who}`, () => A.amountTile(kicker, c.amount, 'GRAM', `→ ${who}`)),
                  right(`pv:${verdict}:${reason}:${c.to}:${twin?.address}`, () => A.verdictTile(verdict, reason, prints))];
  if (clean) {
    // Smart default: a clean request to a known payee is one tap away.
    return { texts: [], images, items: [`▶ Approve ${c.amount}`, '× Reject', '★ Approve & always trust', `■ Kill ${c.agent}`], actions: ['approve', 'reject', 'trust', 'kill'], listTop: LIST };
  }
  // Flagged: Reject is item 0. The SDK drops zero values, so an ambiguous tap lands on Reject.
  const items = ['× Reject', `▶ Pay once anyway  ${c.amount}`, '? Why']; const actions: Action[] = ['reject', 'approve', 'why'];
  if (!c.flags.some(f => STOPS.includes(f.code))) { items.push('★ Pay & trust payee'); actions.push('trust'); }
  items.push(`■ Kill ${c.agent}`); actions.push('kill');
  return { texts: [], images, items, actions, listTop: LIST };
}

const WHY: Record<string, string> = {
  NEW: 'Your agents have never paid this address.',
  LOOKALIKE: 'It copies the visible start or end of a payee you know. Compare the two patterns: they differ. That is address poisoning.',
  MISMATCH: 'The agent wrote one amount in its reason and asked for another. Typical of a hijacked or confused agent.',
  OVER_LIMIT: 'It is more than a single payment is allowed to be.',
  DAILY_CAP: 'It would take this agent over its budget for today.',
  BAD_ADDRESS: 'That is not a valid TON address.',
  NAME_TAKEN: 'A different key is using the name of an agent you already run. If you did not reinstall it, reject.',
};
export function why(c: Card): Page {
  const body = c.flags.length
    ? c.flags.slice(0, 3).map(f => `! ${f.text}\n   ${WHY[f.code] ?? ''}`).join('\n')
    : 'Nothing looks off: a payee you know, and the amount\nmatches what the agent said.';
  return { texts: [full(body, 234)], items: ['← Back to the request'], actions: ['back'], listTop: 236 };
}

// ---------- alarm, confirms, activity, notes ----------
export function alarm(a: NonNullable<State['alarm']>, atRisk: string): Page {
  const items = [`■ Kill ${a.agent} now`, '× Dismiss'];
  const actions: Action[] = ['kill', 'dismiss'];
  const kicker = `${a.agent} · say "kill it"`;
  const reason = a.amount ? `Left with no approval. ${atRisk} GRAM still at risk.` : `${a.text} ${atRisk} GRAM at risk.`;
  return {
    texts: [],
    images: [left(`alamt:${kicker}:${a.amount}:${a.to}`, () => a.amount && a.to ? A.amountTile(kicker, a.amount, 'GRAM', `→ ${short(a.to)}`) : A.statusTile('PAUSED', a.agent)),
             right(`alv:${reason}:${a.to}`, () => A.verdictTile('ALARM', reason, a.to ? [{ address: a.to, tag: 'went to' }] : []))],
    items, actions, listTop: LIST,
  };
}

export const confirmKill = (agent: string, balance: string): Page => ({
  texts: [],
  images: [left(`kamt:${agent}:${balance}`, () => A.amountTile(`kill ${agent}? · say yes or no`, balance, 'GRAM', 'comes back to your vault')),
           right('kill?', () => A.headlineTile('KILL?', 'Its key is revoked on chain.\nIt can never spend again.'))],
  items: ['× Cancel', '■ Yes, kill it'], actions: ['cancel', 'yesKill'], listTop: LIST,
});
export const confirmGive = (a: AgentRow, amount: number): Page => {
  const after = +(num(a.daily) + amount).toFixed(3);
  return {
    texts: [],
    images: [left(`gamt:${a.name}:${amount}`, () => A.amountTile(`give ${a.name} · say yes or no`, String(amount), 'GRAM', 'from your vault, now')),
             right(`give?:${after}`, () => A.headlineTile('GIVE?', `Today's budget becomes\n${after} GRAM`))],
    items: ['× Cancel', `▶ Yes, send ${amount}`], actions: ['cancel', 'yesGive'], listTop: LIST,
  };
};
export const activity = (s: State): Page => ({
  texts: [full(s.ticker.map(t => `· ${fit(t, 62)}`).join('\n') || 'Nothing yet today.', 234)],
  items: ['← Back'], actions: ['back'], listTop: 236,
});

// A transparent strip that takes input on screens without a list (double-tap to exit still works).
const catcher: Txt = { x: 0, y: 238, w: 576, h: 50, content: ' ' };

/** A result: one word, one line. Kill and alarm results are solid. */
export const result = (headline: string, detail: string): Page => ({
  texts: [catcher],
  images: [{ x: 144, y: 60, w: A.W, h: A.H, key: `res:${headline}:${detail}`, draw: () => A.headlineTile(headline, detail, headline === 'KILLED') }],
});
export const note = (text: string): Page => ({ texts: [full(text)] });
/** Big centered word for the moments before there is anything to show. */
export const hello = (word: string, detail: string): Page => ({
  texts: [catcher],
  images: [{ x: 144, y: 60, w: A.W, h: A.H, key: `hello:${word}:${detail}`, draw: () => A.headlineTile(word, detail) }],
});
export const listening = (hint: string, level: number): Page => ({
  texts: [{ x: 0, y: 0, w: 576, h: 40, content: '≈ Listening' },
          { x: 0, y: 44, w: 576, h: 40, content: bar(String(level), '1', 20) },
          { x: 0, y: 100, w: 576, h: 180, content: hint }],
});
export const splashPage = (_tagline: string): Page => ({
  texts: [catcher],
  images: [{ x: 144, y: 72, w: A.W, h: A.H, key: 'wordmark', draw: () => A.wordmark() }],
});
