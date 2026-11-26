# DoraHacks submission

**Name:** Reins

**One-liner:** AI agents get their own small TON wallets. Anything beyond their rules waits for one look at your Even G2.

**Tracks:** AI Assistants & Work (main), Crypto & DeFi, Best Telegram integration

**Links**
- Live: https://reins-jhyz.onrender.com
- Code: https://github.com/miracle352/reins
- Even Hub: `io.github.miracle352.reins` (beta build 0.1.0; ask for a tester invite)
- Telegram bot: @reins_m_bot

## The problem

People are starting to let agents pay for things: API credits, bookings, groceries, invoices. In April, TON shipped Agentic Wallets so agents can hold money themselves. The standard has no spending limits and no approval step, and TON's own FAQ says an agent can spend the whole balance before the owner reacts. The agent toolkit asks agents to confirm with the user first, but that's a prompt. An agent that read a poisoned invoice skips it.

So you either over-fund the agent and hope, or you sit in a dashboard all day. Neither works for something meant to run while you live your life.

## What Reins does

Each agent gets a real TON agentic wallet that stays almost empty. When it needs to pay someone you already trust, under that payee's limit, it just pays. Everything else shows up on your glasses with a one-word verdict:

- **SAFE**: a payee you know, and the amount matches what the agent said. One tap, or say "approve".
- **CHECK**: something new or over budget.
- **STOP**: a lookalike of an address you trust (address poisoning), an amount that doesn't match the agent's own reason (prompt injection), or a new key using the name of an agent you already run.
- **ALARM**: money left an agent wallet with no approval at all, meaning its key was stolen. One tap kills it: the key is revoked on chain and what's left comes back to your vault, in one transaction.

None of those checks are done by a model. They're plain code, so a clever prompt can't talk its way past them.

On the lens, addresses are drawn as ring patterns made from the address's hash. An attacker can make an address that starts and ends like yours, but the pattern comes out different, and STOP shows the two side by side.

## Why the glasses

The moment this is for is when you're away from a screen: walking, at dinner, in a meeting. The agent keeps working and the decision takes two seconds. Voice works too ("approve", "why", "give trip-bot one more", "pause shop-bot"), but a flagged request can only be approved with a tap.

## What we tested, on TON testnet

- An agent driven by a free OpenRouter model, sent to pay a hotel deposit, read an invoice with a hidden instruction and asked for 2 GRAM while writing "0.4" in its reason. Reins flagged STOP and the payment was refused.
- The same agent paid "the new address" an invoice gave it. That address was a lookalike of a payee we trusted, and Reins stopped it.
- We signed transfers directly with a stolen agent key, going around Reins entirely. The watchdog raised ALARM, and one tap on the lens revoked the key and swept the wallet.
- After each kill, the wallet's public key reads 0 on chain and the stolen key's next payment is rejected by the network.

## Built to be used, not just demoed

- One hosted server for everyone. Your phone proves it holds your vault key before it can see anything, agents sign every request with their own key, and a new agent needs your link code plus a tap on the glasses. Your vault key never leaves your phone.
- Before signing, the phone works out the agent's wallet address itself. If the server's request doesn't match, nothing is signed.
- Works with any agent that speaks MCP: Claude Code, Hermes, Codex, or your own code through a small TypeScript kit.
- Telegram alerts come with Reject and Pause buttons. The bot can't move money.
- The phone page shows each agent on a rein from your vault. A rein pulls tighter as its agent spends, a payment runs down it as it happens, and a killed agent's rein snaps.

## What we'd ask Even for

1. Secure key storage for Even Hub apps. `setLocalStorage` is plain text, and a wallet app needs better.
2. Alerts that can reach the glasses when the app isn't in front. Safety apps need to interrupt.
3. List events should always include the selected index. Today it's dropped when it's 0, so we put the safe choice first on purpose.
4. A way for an app to prove a lens frame came from it, so a user can tell a real approval screen from a fake one.
5. The icon rules in `evenhub update`: icons must be built from 2×2 blocks, but the error message doesn't say so. We found it by reading the CLI.

## What's next

Mainnet once the rules have had more people try them, per-payee daily limits, and showing the agent's own signed request on the lens, so the server can't alter what you see.
