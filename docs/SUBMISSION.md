# DoraHacks submission text (draft)

**Name:** Reins

**One-liner:** Your AI agents spend. You approve, refuse or kill them from your Even G2, in one tap.

**Tracks:** Crypto & DeFi (main) · AI Assistants & Work · Best Telegram integration

## Problem
TON's new Agentic Wallets let Telegram AI agents hold and spend GRAM on their own. TON's docs say it plainly: there are no spending limits and no approval flow, and an agent "can spend the entire wallet balance before the owner reacts". The "confirm with the user" step in TON's agent toolkit is a guideline the agent can skip, and a prompt-injected agent will.

## Who it's for
Anyone who runs an AI agent that pays for things: API credits, bookings, shopping, bills. Today that's developers and power users on Telegram and TON. Tomorrow it's everyone with an assistant.

## How it works
- Each agent wallet stays nearly empty. When the agent needs money, it asks; the request appears on your G2. Swipe, tap, and exactly that amount moves from your vault. Reject is always the default.
- Trusted payees under their limit are paid automatically from a small buffer, so you only see what matters.
- Plain-code checks flag new payees, lookalike (poisoned) addresses, amounts that don't match what the agent said, and limit breaches.
- A watchdog matches every outgoing transfer with an approval. Anything else lights up an alarm on the lens, and one tap revokes the agent's key on chain and sweeps its funds back.
- A Telegram bot (bot token only, never your account) alerts you and lets you reject or freeze an agent when the glasses app is closed. It cannot move money.
- Works with any agent: an MCP server gives Claude Code, Codex or any MCP client a wallet that answers to your glasses.

## Read and write
Read: one card, the amount, who gets it, what the agent said, and what's wrong with it.
Write: swipe and tap to Reject / Fund once / Fund & trust / Kill. One tap on an alarm kills the agent.

## Safety
Testnet only. Your vault key never leaves your phone; the server only relays signed transactions. No AI decides whether money moves. The agent never sees a key it could leak beyond its tiny buffer.

## Feature requests (APIs we were missing)
1. Secure key storage in Even Hub.
2. Background alerts for safety-critical apps.
3. A way to prove a lens frame came from a given app.
4. Scoped Telegram permissions for Even Hub apps instead of full user sessions.
5. List events that always include the selected index (it is dropped when 0).
