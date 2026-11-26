// What goes on the 576x288 lens. One thing at a time, a few words, a safe default first.
export type Flag = { code: string; text: string };
export type Card = {
  id: string; kind: 'create' | 'pay'; agent: string; purpose: string; flags: Flag[];
  amount: string; amountNano: string; to?: string; toName?: string; agentAddress: string; operatorPub: string;
};
export type AgentRow = {
  id: string; name: string; address: string; status: string; balance: string;
  spentToday: string; daily: string; waiting: number; last: { amount: string; to: string; at: number } | null;
};
export type State = {
  vault: string | null; vaultBalance: string; atRisk: string; spentToday: string;
  agents: AgentRow[];
  alarm: { agentId: string; agent: string; text: string; agentAddress: string } | null;
  pending: Card | null; pendingCount: number; ticker: string[]; telegram: string | null;
};
export type Page = { body: string; items: string[] };

/** The 4 chars after the fixed "0Q" tag and the last 4: exactly what the lookalike rule compares. */
export const short = (a: string) => `${a.slice(2, 6)}…${a.slice(-4)}`;
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
const live = (s: State) => s.agents.filter(a => a.status === 'active' || a.status === 'frozen');
const fit = (s: string, n = 46) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---------- home ----------
export function home(s: State): Page {
  const agents = live(s);
  const working = agents.filter(a => a.status === 'active').length;
  const body = [
    `REINS · ${working} agent${working === 1 ? '' : 's'} working          vault ${s.vaultBalance}`,
    `Today ${s.spentToday} spent · ${s.atRisk} at risk`,
  ].join('\n');
  const items = agents.map(a => fit(`${a.status === 'frozen' ? '||' : '>'} ${a.name}  ${a.spentToday}/${a.daily} today${a.last ? ` · ${a.last.to}` : ''}`, 60));
  items.push('mic  Speak a command', '…  Activity');
  return { body, items };
}
export const homeTarget = (s: State, index: number) => {
  const agents = live(s);
  if (index < agents.length) return { agent: agents[index] };
  return index === agents.length ? { voice: true } : { activity: true };
};

// ---------- one agent ----------
export function agentPage(a: AgentRow): Page {
  const lines = [
    `${a.name} · ${a.status === 'frozen' ? 'PAUSED' : 'working'}`,
    `Wallet ${a.balance} GRAM · today ${a.spentToday} of ${a.daily}`,
    a.last ? `Last: ${a.last.amount} → ${a.last.to}, ${ago(a.last.at)}` : 'No payments yet',
  ];
  if (a.waiting) lines.push(`${a.waiting} request${a.waiting > 1 ? 's' : ''} waiting for you`);
  return { body: lines.join('\n'), items: ['<  Back', 'mic  Speak a command', '+  Give 0.5 more today', a.status === 'frozen' ? '>  Resume' : '|| Pause', `#  Kill ${a.name}`] };
}

// ---------- a request ----------
export const isClean = (c: Card) => c.kind === 'create' || c.flags.length === 0;

export function card(c: Card, waiting: number): Page {
  const head = `${c.agent} asks${waiting > 1 ? ` · ${waiting - 1} more waiting` : ''}`;
  if (c.kind === 'create') {
    return {
      body: [head, '', `A new wallet with a ${c.amount} GRAM buffer.`, 'Anything beyond its rules comes back here.', '', 'Say "approve" or "reject"'].join('\n'),
      items: [`+  Create wallet (${c.amount})`, 'x  Reject'],
    };
  }
  const who = c.toName ?? short(c.to!);
  const lines = [head, `${c.amount} GRAM → ${who}`, `"${fit(c.purpose, 48)}"`];
  if (isClean(c)) {
    lines.push('OK known payee · matches what it said', 'Say "approve" or "reject"');
    // Smart default: a clean request to a known payee is one tap away.
    return { body: lines.join('\n'), items: [`+  Approve ${c.amount}`, 'x  Reject', '+  Approve & always trust', `#  Kill ${c.agent}`] };
  }
  lines.push(...c.flags.slice(0, 2).map(f => `!! ${f.text}`), 'Flagged: tap to approve · say "why"');
  // Flagged: Reject is item 0. The SDK drops zero values, so an ambiguous tap lands on Reject.
  const items = ['x  Reject', `+  Fund once (${c.amount})`];
  if (!c.flags.some(f => f.code === 'LOOKALIKE' || f.code === 'MISMATCH')) items.push('+  Fund & trust payee');
  items.push(`#  Kill ${c.agent}`);
  return { body: lines.join('\n'), items };
}

const WHY: Record<string, string> = {
  NEW: 'Your agents have never paid this address.',
  LOOKALIKE: 'The address copies the visible start or end of a payee you know. That is how address poisoning works.',
  MISMATCH: 'The agent wrote one amount in its reason and asked for another. That is typical of a hijacked or confused agent.',
  OVER_LIMIT: 'It is more than one payment is allowed to be.',
  DAILY_CAP: 'It would take this agent over its budget for today.',
  BAD_ADDRESS: 'That is not a valid TON address.',
};
export function why(c: Card): Page {
  const body = c.flags.length
    ? c.flags.slice(0, 3).map(f => `!! ${f.text}\n${WHY[f.code] ?? ''}`).join('\n')
    : 'Nothing looks off: a payee you know, and the amount matches what the agent said.';
  return { body, items: ['<  Back to the request'] };
}

// ---------- alarm, confirm, activity ----------
export const alarm = (a: NonNullable<State['alarm']>, atRisk: string): Page => ({
  body: [`!! ALARM: ${a.agent}`, '', a.text, '', `Still at risk: ${atRisk} GRAM`, 'Kill revokes its key and pulls the rest back.'].join('\n'),
  items: [`#  Kill ${a.agent} now`, 'x  Dismiss'],
});
export const confirmKill = (agent: string): Page => ({
  body: [`Kill ${agent}?`, '', 'Its key is revoked on chain and every', 'GRAM it holds goes back to your vault.', 'It cannot spend again.  Say "yes" or tap.'].join('\n'),
  items: ['x  Cancel', '#  Yes, kill it'],
});
export const confirmGive = (a: AgentRow, amount: number): Page => ({
  body: [`Give ${a.name} ${amount} GRAM now?`, '', `It goes from your vault to its wallet,`, `and today's budget becomes ${(Number(a.daily) + amount).toFixed(2).replace(/\.?0+$/, '')} GRAM.`, '', 'Say "yes" or tap.'].join('\n'),
  items: ['x  Cancel', `+  Yes, send ${amount}`],
});
export const activity = (s: State): Page => ({ body: s.ticker.map(t => `· ${fit(t, 64)}`).join('\n') || 'Nothing yet.', items: ['<  Back'] });
export const listening = (hint: string) => `mic  Listening…\n\n${hint}`;
