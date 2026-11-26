// Telegram bot: filled in later. No-op without TELEGRAM_BOT_TOKEN.
export function startTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN) console.log('telegram: off (no TELEGRAM_BOT_TOKEN)');
}
