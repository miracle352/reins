# DoraHacks submission kit

Paste each block into the matching field. Deadline: Sun 29 Nov, 20:59 (UTC+1). Submit early; you can edit until then.

## Before you open the form

1. Make the repo public: GitHub → miracle352/reins → Settings → Danger zone → Change visibility → Public.
2. Upload `reins-the-errand.mp4` to YouTube (Unlisted is fine). Title: `Reins: your agents spend, you hold the reins (Even G2 × TON)`. Copy the link.
3. Have these files ready: `reins-logo.png` (logo), `reins-cover.png` (cover).

## BUIDL name

Reins

## One-liner / vision (short field)

AI agents get small TON wallets of their own. Anything beyond their rules waits for one look at your Even G2.

## Track

AI Assistants & Work

## Links

- GitHub: https://github.com/miracle352/reins
- Demo video: (your YouTube link)
- Website: https://reins-jhyz.onrender.com
- Try it: https://reins-jhyz.onrender.com/try
- Telegram bot: https://t.me/reins_m_bot

## Tags

AI Agents, TON, Wallet, Telegram, Smart Glasses, Security, MCP

## Description (long field, Markdown)

**Reins lets AI agents spend money without you handing them your wallet.**

Agents are starting to pay for things: API credits, bookings, invoices. Since April, TON's Agentic Wallets let an agent hold money itself. The standard has no spending limit and no approval step, and an agent that reads a poisoned document will happily follow it. So today you either over-fund your agent and hope, or you babysit a dashboard.

Reins gives each agent a real TON agentic wallet that stays almost empty, and a rein back to your vault. Payees you trust, under their limit, get paid on their own. Everything else lands on your Even G2 as one word:

- **SAFE**: a payee you know, and the amount matches what the agent said.
- **CHECK**: someone new, or over budget.
- **STOP**: an address imitating one you trust, an amount that doesn't match the agent's own reason, or a new key using the name of an agent you already run.
- **ALARM**: money left an agent's wallet with no approval at all. One tap kills it: the key is revoked on chain and what's left comes back to your vault.

No model decides whether money moves. The checks are plain code.

### What we proved on TON testnet

- A free model on OpenRouter, sent to pay a hotel deposit, read an invoice with a hidden instruction and asked for 2 GRAM while calling it "the 0.4 GRAM deposit". Reins flagged STOP and nothing moved.
- A lookalike of a trusted payee's address was stopped. On the lens, every address is drawn as a ring from its hash: same last letters, different ring.
- We signed a transfer with a stolen agent key, going around Reins entirely. The watchdog raised ALARM; one tap revoked the key on chain and swept the wallet. The stolen key's next transaction was rejected by the network.

### Built to be used

- **Hosted for anyone**: one server, one private record per vault. Your phone proves it holds the vault key before it can read anything; agents sign every request with their own key; a new agent needs your link code and a tap on the glasses. The vault key never leaves your phone, and the phone derives each agent's wallet address itself before signing, so even a compromised server can't redirect money.
- **Any agent**: an MCP server with three tools (connect, wallet, pay) for Claude Code, Hermes, Codex or your own code.
- **Telegram**: warnings arrive as cards with Reject and Pause. The bot can't approve or move money.
- **Voice**: "approve", "why", "give trip-bot one more". A flagged request can't be approved by voice.
- **Phone page**: each agent hangs from your vault on a rein that pulls tighter as it spends.

### Try it

- Phone page in your browser: https://reins-jhyz.onrender.com/app/
- Every glasses screen, in Even's official simulator: `npx @evenrealities/evenhub-simulator "https://reins-jhyz.onrender.com/glasses/?tour"`
- The full flow on testnet, and the Even Hub beta for G2 owners: https://reins-jhyz.onrender.com/try

### What we'd ask Even for

1. Secure key storage for Even Hub apps (`setLocalStorage` is plain text).
2. Alerts that reach the glasses when an app isn't in front.
3. List events that always carry the selected index (it's dropped when 0).
4. A way for an app to prove a lens frame came from it, so users can tell a real approval screen from a fake one.
5. Document the 2×2-block rule for icons in `evenhub update`.

### Next

Mainnet once more people have tried the rules, per-payee daily limits, and showing the agent's own signed request on the lens so the server can't alter what you see.

## Team

Miracle (GitHub: miracle352). Solo.

## If the form asks "Is this an AI agent?"

It's a control layer for AI agents: agents are the users that spend, you are the one that approves.
