// Telegram companion: alerts, Reject and Pause. It never holds a vault key, so it cannot move money.
// One bot serves every user; each user links their chat with a code shown in their own Reins.
// With PUBLIC_URL set it uses a webhook (so a tap wakes a sleeping server); otherwise long polling.
import { randomInt, createHash } from 'node:crypto';
import { db, save, onEvent, withTenant, tenants, tenantOfChat, tenantOfPairCode, type Event, type DB } from './store.ts';

type Actions = {
  reject(requestId: string): string;
  freeze(agentId: string, on: boolean): string;
  status(): string;
  agents(): { id: string; name: string; frozen: boolean }[];
};

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '');
// Secret part of the webhook path, derived from the bot token so it never needs its own setting.
const HOOK = TOKEN ? createHash('sha256').update('reins-hook:' + TOKEN).digest('hex').slice(0, 32) : '';

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
  return j.result;
}

type Btn = { text: string; data: string };
const sendTo = (chat: number, text: string, buttons?: Btn[][]) =>
  tg('sendMessage', { chat_id: chat, text, reply_markup: buttons ? { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.text, callback_data: b.data }))) } : undefined })
    .catch(e => console.error(e.message));

let actions: Actions;
export let botName = process.env.TELEGRAM_BOT_NAME ?? '';

/** Pair code for this vault's Telegram link (made on demand). */
export function pairCodeFor(t: DB) {
  if (!t.telegramChat && !t.pairCode) t.pairCode = String(randomInt(100000, 999999));
  return t.telegramChat ? null : t.pairCode;
}

export function startTelegram(a: Actions) {
  actions = a;
  if (!TOKEN) { console.log('telegram: off (no TELEGRAM_BOT_TOKEN)'); return; }
  void tg('getMe', {}).then(me => { botName = me.username; }).catch(() => {});

  onEvent((e: Event, t: DB) => {
    if (!t.telegramChat) return;
    if (e.level === 'info' && !e.requestId) return; // keep the chat quiet: only things that need you
    const icon = e.level === 'alarm' ? '🚨' : e.level === 'warn' ? '⚠️' : '🔔';
    const rows: Btn[][] = [];
    if (e.requestId) rows.push([{ text: '✕ Reject', data: `rej:${e.requestId}` }]);
    if (e.agentId && e.level !== 'info') rows.push([{ text: '⏸ Pause agent', data: `frz:${e.agentId}` }]);
    const tail = e.requestId ? '\n\nApprove on your glasses (money moves only from there).' : '';
    void sendTo(t.telegramChat, `${icon} ${e.text}${tail}`, rows.length ? rows : undefined);
  });

  if (PUBLIC_URL) {
    void tg('setWebhook', { url: `${PUBLIC_URL}/tg/${HOOK}`, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
      .then(() => console.log('telegram: on (webhook)')).catch(e => console.error(e.message));
    return;
  }
  void tg('deleteWebhook', {}).catch(() => {});
  let offset = 0;
  void (async () => {
    for (;;) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) { offset = u.update_id + 1; await onUpdate(u); }
      } catch (e) { console.error((e as Error).message); await new Promise(r => setTimeout(r, 5000)); }
    }
  })();
  console.log('telegram: on (polling)');
}

export async function telegramWebhook(secret: string, raw: string) {
  if (!TOKEN || secret !== HOOK) return;
  await onUpdate(JSON.parse(raw));
}

async function onUpdate(u: any) {
  if (u.message?.text) await onMessage(u.message.chat.id, u.message.text.trim());
  if (u.callback_query) await onButton(u.callback_query);
}

async function onMessage(chat: number, text: string) {
  const [cmd, arg] = text.split(/\s+/);
  const mine = tenantOfChat(chat);
  if (cmd === '/pair' || (cmd === '/start' && arg)) {
    if (mine) return void sendTo(chat, 'This chat is already linked to a Reins vault.');
    const t = tenantOfPairCode(String(arg ?? ''));
    if (!t) return void sendTo(chat, 'That code did not match. Open Reins on your phone: the code is under Telegram.');
    withTenant(t, () => { db.telegramChat = chat; db.pairCode = undefined; save(); });
    return void sendTo(chat, 'Linked. You will get alerts here, and can Reject requests or Pause an agent. Money only moves from your glasses.');
  }
  if (!mine) return void sendTo(chat, 'Hi. This is the Telegram side of Reins. Open Reins on your phone and send me the code shown under Telegram, like:\n/pair 123456');
  withTenant(mine, () => {
    if (cmd === '/status' || cmd === '/start') return void sendTo(chat, actions.status());
    if (cmd === '/pause') {
      const list = actions.agents();
      if (!list.length) return void sendTo(chat, 'No live agents.');
      return void sendTo(chat, 'Pause which agent?', list.map(a => [{ text: `${a.frozen ? 'Resume' : '⏸ Pause'} ${a.name}`, data: `${a.frozen ? 'unf' : 'frz'}:${a.id}` }]));
    }
    if (cmd === '/unlink') { db.telegramChat = undefined; save(); return void sendTo(chat, 'Unlinked. No more alerts here.'); }
    sendTo(chat, 'Commands: /status, /pause, /unlink');
  });
}

async function onButton(q: any) {
  const chat = q.message?.chat?.id;
  const t = chat ? tenantOfChat(chat) : undefined;
  const [kind, id] = String(q.data).split(':');
  const answer = !t ? 'This chat is not linked.' : withTenant(t, () =>
    kind === 'rej' ? actions.reject(id) : kind === 'frz' ? actions.freeze(id, true) : kind === 'unf' ? actions.freeze(id, false) : 'Unknown action.');
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: answer.slice(0, 190) }).catch(() => {});
  // Change the alert itself, so the chat shows what happened and the buttons can't be pressed twice.
  const m = q.message;
  if (m?.text) await tg('editMessageText', { chat_id: m.chat.id, message_id: m.message_id, text: `${m.text}\n\n→ ${answer}` }).catch(() => sendTo(chat, answer));
  else if (chat) await sendTo(chat, answer);
}

export const telegramTenants = () => [...tenants.values()].filter(t => t.telegramChat).length;
