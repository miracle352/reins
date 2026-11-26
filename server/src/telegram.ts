// Telegram companion: alerts, Reject and Pause. It never holds a vault key, so it cannot move money.
// One bot serves every user; each user links their chat with a code shown in their own Reins.
// With PUBLIC_URL set it uses a webhook (so a tap wakes a sleeping server); otherwise long polling.
import { randomInt, createHash } from 'node:crypto';
import { db, save, onEvent, withTenant, tenants, tenantOfChat, tenantOfPairCode, type Event, type DB } from './store.ts';

type Btn = { text: string; data?: string; url?: string };
type Card = { html: string; buttons?: Btn[][] };
type Done = { answer: string; card?: Card; keepCard?: boolean };
type Actions = {
  card(e: Event): Card | null;
  reject(requestId: string): Done;
  freeze(agentId: string, on: boolean): Done;
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

const keyboard = (buttons?: Btn[][]) => buttons ? { inline_keyboard: buttons.map(row => row.map(b => b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })) } : undefined;
const sendTo = (chat: number, html: string, buttons?: Btn[][]) =>
  tg('sendMessage', { chat_id: chat, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard(buttons) })
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
    const card = withTenant(t, () => actions.card(e));
    if (card) return void sendTo(t.telegramChat, card.html, card.buttons);
    if (e.level === 'info') return; // keep the chat quiet: only things that need you
    void sendTo(t.telegramChat, `${e.level === 'alarm' ? '🚨' : '⚠️'} ${e.text.replace(/[&<>]/g, '')}`);
  });

  // How the bot introduces itself in Telegram.
  void tg('setMyCommands', { commands: [
    { command: 'status', description: 'Your agents and what is waiting' },
    { command: 'pause', description: 'Pause an agent' },
    { command: 'unlink', description: 'Stop alerts in this chat' },
  ] }).catch(() => {});
  void tg('setMyShortDescription', { short_description: 'Alerts from Reins: your AI agents ask, your glasses answer.' }).catch(() => {});
  void tg('setMyDescription', { description: 'Reins gives your AI agents small TON wallets and puts every payment beyond their rules on your Even G2 glasses. This bot warns you here, and lets you reject a request or pause an agent. Money only moves after a yes on your glasses.' }).catch(() => {});

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
    if (mine) return void sendTo(chat, 'This chat is already linked to a Reins vault. Send /status to see your agents.');
    const t = tenantOfPairCode(String(arg ?? ''));
    if (!t) return void sendTo(chat, 'That code didn\'t match. Open Reins on your phone: the code is under <b>Telegram</b>.');
    withTenant(t, () => { db.telegramChat = chat; db.pairCode = undefined; save(); });
    return void sendTo(chat, ['✅ <b>Linked to your Reins vault</b>', '',
      'From now on you\'ll get a card here when an agent:',
      '•  asks for something your rules don\'t cover',
      '•  pays someone without your approval',
      '•  asks for a wallet', '',
      'You can <b>reject</b> a request or <b>pause</b> an agent from here. Approving, and killing an agent, only happen on your glasses.'].join('\n'));
  }
  if (!mine) return void sendTo(chat, ['👋 <b>This is the Telegram side of Reins.</b>', '',
    'Reins gives your AI agents small TON wallets and puts anything beyond their rules on your Even G2 glasses. Here you get the warnings.', '',
    'To link this chat, open Reins on your phone and tap <b>Link Telegram</b>, or send the code shown there:', '<code>/pair 123456</code>'].join('\n'),
    [[{ text: 'What is Reins?', url: (PUBLIC_URL ?? 'https://reins-jhyz.onrender.com') + '/' }]]);
  withTenant(mine, () => {
    if (cmd === '/status' || cmd === '/start') return void sendTo(chat, actions.status());
    if (cmd === '/pause') {
      const list = actions.agents();
      if (!list.length) return void sendTo(chat, 'No live agents.');
      return void sendTo(chat, 'Pause which agent?', list.map(a => [{ text: `${a.frozen ? 'Resume' : '⏸ Pause'} ${a.name}`, data: `${a.frozen ? 'unf' : 'frz'}:${a.id}` }]));
    }
    if (cmd === '/unlink') { db.telegramChat = undefined; save(); return void sendTo(chat, 'Unlinked. No more alerts here. Link again any time from the Reins phone page.'); }
    sendTo(chat, '<b>/status</b>  your agents and what is waiting\n<b>/pause</b>  pause an agent\n<b>/unlink</b>  stop alerts in this chat');
  });
}

async function onButton(q: any) {
  const chat = q.message?.chat?.id;
  const t = chat ? tenantOfChat(chat) : undefined;
  const [kind, id] = String(q.data).split(':');
  const done: Done = !t ? { answer: 'This chat is not linked.' } : withTenant(t, () =>
    kind === 'rej' ? actions.reject(id) : kind === 'frz' ? actions.freeze(id, true) : kind === 'unf' ? actions.freeze(id, false) : { answer: 'Unknown action.' });
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: done.answer.slice(0, 190) }).catch(() => {});
  const m = q.message;
  if (done.card && !done.keepCard && m) {
    // Rewrite the card itself with the outcome, so the chat reads as a record and buttons can't be pressed twice.
    await tg('editMessageText', { chat_id: m.chat.id, message_id: m.message_id, text: done.card.html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => sendTo(chat, done.card!.html));
  } else {
    if (m) await tg('editMessageReplyMarkup', { chat_id: m.chat.id, message_id: m.message_id }).catch(() => {});
    if (chat) await sendTo(chat, done.card?.html ?? done.answer);
  }
}

export const telegramTenants = () => [...tenants.values()].filter(t => t.telegramChat).length;
