// Telegram companion: alerts, Reject and Freeze. It never holds the vault key, so it cannot move money.
// Uses a bot token only (no user account session). Long polling, no dependencies.
import { randomInt } from 'node:crypto';
import { db, save, onEvent, type Event } from './store.ts';

type Actions = {
  reject(requestId: string): string;
  freeze(agentId: string, on: boolean): string;
  status(): string;
  agents(): { id: string; name: string; frozen: boolean }[];
};

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j: any = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
  return j.result;
}

const send = (text: string, buttons?: { text: string; data: string }[][]) => db.telegramChat
  ? tg('sendMessage', { chat_id: db.telegramChat, text, reply_markup: buttons ? { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.text, callback_data: b.data }))) } : undefined }).catch(e => console.error(e.message))
  : Promise.resolve();

export function startTelegram(actions: Actions) {
  if (!TOKEN) { console.log('telegram: off (no TELEGRAM_BOT_TOKEN)'); return; }
  if (!db.telegramChat && !db.pairCode) { db.pairCode = String(randomInt(100000, 999999)); save(); }
  if (!db.telegramChat) console.log(`telegram: send "/pair ${db.pairCode}" to your bot to link it`);

  onEvent((e: Event) => {
    if (e.level === 'info' && !e.requestId) return; // keep the chat quiet: only things that need you
    const icon = e.level === 'alarm' ? '🚨' : e.level === 'warn' ? '⚠️' : '🔔';
    const rows: { text: string; data: string }[][] = [];
    if (e.requestId) rows.push([{ text: '✕ Reject', data: `rej:${e.requestId}` }]);
    if (e.agentId && e.level !== 'info') rows.push([{ text: '❄ Freeze agent', data: `frz:${e.agentId}` }]);
    const tail = e.requestId ? '\n\nApprove on your glasses (money moves only from there).' : '';
    void send(`${icon} ${e.text}${tail}`, rows.length ? rows : undefined);
  });

  let offset = 0;
  const loop = async () => {
    for (;;) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message?.text) await onMessage(u.message.chat.id, u.message.text.trim());
          if (u.callback_query) await onButton(u.callback_query);
        }
      } catch (e) { console.error((e as Error).message); await new Promise(r => setTimeout(r, 5000)); }
    }
  };

  async function onMessage(chat: number, text: string) {
    const [cmd, arg] = text.split(/\s+/);
    if (cmd === '/pair') {
      if (db.telegramChat) return void tg('sendMessage', { chat_id: chat, text: 'This Reins is already linked to a chat.' });
      if (arg !== db.pairCode) return void tg('sendMessage', { chat_id: chat, text: 'Wrong code. It is shown on your glasses and on the Reins phone page.' });
      db.telegramChat = chat; db.pairCode = undefined; save();
      return void send('Linked. You will get alerts here, and can Reject requests or Freeze an agent. Money only moves from your glasses.');
    }
    if (chat !== db.telegramChat) return void tg('sendMessage', { chat_id: chat, text: 'Send /pair <code> first.' });
    if (cmd === '/status' || cmd === '/start') return void send(actions.status());
    if (cmd === '/freeze') {
      const list = actions.agents();
      if (!list.length) return void send('No live agents.');
      return void send('Freeze which agent?', list.map(a => [{ text: `${a.frozen ? 'Unfreeze' : '❄ Freeze'} ${a.name}`, data: `${a.frozen ? 'unf' : 'frz'}:${a.id}` }]));
    }
    return void send('Commands: /status, /freeze');
  }

  async function onButton(q: any) {
    if (q.message?.chat?.id !== db.telegramChat) return;
    const [kind, id] = String(q.data).split(':');
    const answer = kind === 'rej' ? actions.reject(id) : kind === 'frz' ? actions.freeze(id, true) : kind === 'unf' ? actions.freeze(id, false) : 'Unknown action.';
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: answer.slice(0, 190) }).catch(() => {});
    await send(answer);
  }

  void loop();
  console.log('telegram: on');
}
