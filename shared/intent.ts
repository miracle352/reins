// Turns a short spoken phrase into a command. Plain code: the speech model only transcribes.
export type Intent =
  | { kind: 'approve' } | { kind: 'reject' } | { kind: 'trust' } | { kind: 'kill'; agent?: string }
  | { kind: 'why' } | { kind: 'yes' } | { kind: 'no' }
  | { kind: 'give'; agent?: string; amount: number }
  | { kind: 'pause'; agent?: string } | { kind: 'resume'; agent?: string }
  | { kind: 'status' } | { kind: 'unknown'; text: string };

const NUM: Record<string, number> = {
  zero: 0, half: 0.5, one: 1, a: 1, an: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50,
};

function amountIn(words: string[]): number | undefined {
  const t = words.join(' ');
  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  // "point five", "one point five"
  const pi = words.indexOf('point');
  if (pi >= 0 && NUM[words[pi + 1]] !== undefined) return (NUM[words[pi - 1]] ?? 0) + NUM[words[pi + 1]] / 10;
  if (t.includes('half')) return 0.5;
  for (const w of words) if (NUM[w] !== undefined && w !== 'a' && w !== 'an' && w !== 'to' && w !== 'for') return NUM[w];
  return undefined;
}

function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const skeleton = (w: string) => w.replace(/[aeiouyh]/g, '').replace(/(.)\1+/g, '$1');

/** "trip", "trip bot", "tripod", even a mis-heard "turbah" for "tour-bot": matched forgivingly. */
export function matchAgent(words: string[], agents: string[]): string | undefined {
  let best: { name: string; score: number } | undefined;
  for (const name of agents) {
    const head = name.toLowerCase().split(/[-_ ]/)[0];
    const full = skeleton(name.toLowerCase().replace(/[^a-z]/g, ''));
    const joined = words.map((w, i) => w + (words[i + 1] ?? ''));
    for (const j of joined) {
      // Sound-alike: same consonant skeleton at the start ("trb" ~ "trbt").
      const sk = skeleton(j);
      let common = 0; while (common < Math.min(sk.length, full.length) && sk[common] === full[common]) common++;
      if (common >= 3 && (!best || 2 < best.score)) best = { name, score: 2 };
    }
    for (const w of words) {
      if (w.length < 3) continue;
      const exact = w === head || w === name.toLowerCase().replace(/[-_]/g, '');
      const prefix = head.length >= 3 && (w.startsWith(head) || head.startsWith(w));
      const score = exact ? 0 : prefix ? 1 : editDistance(w, head);
      if (score <= Math.max(1, Math.floor(head.length / 3)) && (!best || score < best.score)) best = { name, score };
    }
  }
  return best?.name;
}

export function parseIntent(raw: string, agents: string[] = []): Intent {
  const text = raw.toLowerCase().replace(/(\d)\.(\d)/g, '$1qqq$2').replace(/[^a-z0-9 ]+/g, ' ').replace(/qqq/g, '.').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);
  const has = (...ws: string[]) => ws.some(w => words.includes(w));
  // With a single agent there is nobody else to mean.
  const agent = matchAgent(words, agents) ?? (agents.length === 1 ? agents[0] : undefined);

  if (has('give', 'top', 'add', 'raise', 'send') && (has('more') || amountIn(words) !== undefined) && agent) {
    return { kind: 'give', agent, amount: amountIn(words) ?? 1 };
  }
  if (has('kill', 'terminate', 'revoke')) return { kind: 'kill', agent };
  if (has('pause', 'freeze', 'hold')) return { kind: 'pause', agent };
  if (has('resume', 'unpause', 'unfreeze')) return { kind: 'resume', agent };
  if (has('why', 'explain', 'reason')) return { kind: 'why' };
  if (has('trust')) return { kind: 'trust' };
  if (has('reject', 'deny', 'decline', 'refuse')) return { kind: 'reject' };
  if (has('approve', 'approved', 'fund', 'pay', 'accept')) return { kind: 'approve' };
  if (has('status', 'today', 'spent', 'summary')) return { kind: 'status' };
  if (has('yes', 'yeah', 'yep', 'confirm', 'sure', 'okay', 'ok')) return { kind: 'yes' };
  if (has('no', 'nope', 'cancel', 'stop')) return { kind: 'no' };
  return { kind: 'unknown', text: raw.trim() };
}
