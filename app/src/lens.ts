// What goes on the 576x288 lens. One thing at a time, a few words, safe default first.
export type Flag = { code: string; text: string };
export type Card = {
  id: string; kind: 'create' | 'pay'; agent: string; purpose: string; flags: Flag[];
  amount: string; amountNano: string; to?: string; toName?: string; agentAddress: string; operatorPub: string;
};
export type State = {
  vault: string | null; vaultBalance: string; atRisk: string;
  agents: { id: string; name: string; status: string }[];
  alarm: { agentId: string; agent: string; text: string; agentAddress: string } | null;
  pending: Card | null; pendingCount: number; ticker: string[]; telegram: string | null;
};

// Show the 4 chars after the fixed "0Q" tag and the last 4: the exact parts the lookalike rule compares.
export const short = (a: string) => `${a.slice(2, 6)}…${a.slice(-4)}`;

export function idleText(s: State) {
  const live = s.agents.filter(a => a.status === 'active').length;
  const lines = [
    `REINS                              vault ${s.vaultBalance}`,
    `At risk: ${s.atRisk} GRAM · ${live} agent${live === 1 ? '' : 's'} live`,
    '',
    ...(s.ticker.length ? s.ticker.map(t => `· ${t}`) : ['· Waiting for your agents']),
  ];
  if (s.telegram && s.telegram !== 'linked') lines.push('', `Telegram: send /pair ${s.telegram} to your Reins bot`);
  return lines.join('\n');
}

export function cardText(c: Card, waiting: number) {
  const head = `${c.agent} asks${waiting > 1 ? ` · ${waiting - 1} more waiting` : ''}`;
  if (c.kind === 'create') {
    return [head, '', `A new wallet with a ${c.amount} GRAM buffer.`, 'It can spend the buffer under your rules.', 'Anything else comes back here first.'].join('\n');
  }
  const who = c.toName ?? short(c.to!);
  const lines = [head, '', `${c.amount} GRAM → ${who}`, `"${c.purpose.slice(0, 60)}"`];
  if (c.flags.length) lines.push(...c.flags.slice(0, 3).map(f => `!! ${f.text}`));
  else lines.push('OK known payee, matches what it said');
  return lines.join('\n');
}

/** Reject is item 0 on purpose: the SDK drops zero values, so an ambiguous tap lands on Reject. */
export function cardActions(c: Card) {
  if (c.kind === 'create') return ['x  Reject', `+  Create wallet (${c.amount} buffer)`];
  const items = ['x  Reject', `+  Fund once (${c.amount})`];
  if (!c.flags.some(f => f.code === 'LOOKALIKE' || f.code === 'MISMATCH')) items.push('+  Fund & trust payee');
  items.push(`#  Kill ${c.agent}`);
  return items;
}

export const alarmText = (a: NonNullable<State['alarm']>, atRisk: string) =>
  [`!! ALARM: ${a.agent}`, '', a.text, '', `Still at risk: ${atRisk} GRAM`, 'Kill revokes its key and pulls the rest back.'].join('\n');
export const alarmActions = (a: NonNullable<State['alarm']>) => [`#  Kill ${a.agent} now`, 'x  Dismiss'];

export const confirmKillText = (agent: string) =>
  [`Kill ${agent}?`, '', 'Its key is revoked on chain and every', 'GRAM it holds goes back to your vault.', 'It cannot spend again.'].join('\n');
export const confirmKillActions = () => ['x  Cancel', '#  Yes, kill it'];
