# Security model

Reins handles money, so here is exactly who can do what, and what happens when each part is compromised.

## The three keys

| Key | Where it lives | What it can do |
|---|---|---|
| **Vault key** (24 words) | Your phone, in the Even app's storage | Owns every agent wallet: fund, revoke, sweep. The only key that can move your main balance. |
| **Agent operator key** | The machine the agent runs on (`~/.reins/agent-<name>.json`, mode 600) | Spend what is in *that agent's* wallet. Nothing else. |
| **Device token** | Your phone, after login | Read your Reins state, approve and reject requests *as relays*. It can't sign anything. |

The server holds none of the first two. It stores state (requests, rules, payees, events) and relays transactions that were signed on your phone or by an agent.

## How each side proves who it is

- **Your phone** logs in by signing `reins-login · vault address · time` with the vault key. The server checks that the public key really derives your vault address and that the signature is fresh (5 minutes). It then hands out a random token and keeps only its SHA-256 hash.
- **Agents** sign every single request (method, path, time, hash of the body) with their operator key. The server checks it against the key it registered for that agent. A stolen agent id is useless without the key.
- **A new agent** needs your link code (shown on the phone page, rotatable) *and* your approval on the glasses before it gets a wallet. A new key that reuses the name of an agent you already run is flagged STOP.
- **Telegram** is linked by a one-time code shown in your Reins. The bot can reject requests and pause agents. It cannot approve or move money.

## If something is compromised

| What leaks | What the attacker can do | What stops it |
|---|---|---|
| An agent's operator key | Spend that agent's wallet balance, which is kept to a small buffer (0.3 GRAM by default) plus whatever you approved and it hasn't spent yet | The watchdog sees a transfer you never approved and raises ALARM on your glasses and in Telegram. Kill revokes the key on chain and sweeps the rest back in one transaction. |
| The Reins server | Show you misleading requests, hide requests, refuse to relay | It can't move funds: every vault transaction is built and signed on your phone, from the request details you see. Agents can't get more than you sign for. |
| Your link code | Ask for a wallet | You still have to approve it on the glasses. Make a new code from the phone page. |
| Your phone | Everything, as with any wallet | Your 24 words. Keep them offline. |

## What the rules check, in code

No model decides whether money moves. `server/src/policy.ts` flags:

- **NEW**: a payee your agents have never paid
- **LOOKALIKE**: an address sharing the visible start or end with a payee you know (address poisoning)
- **MISMATCH**: the amount written in the agent's reason differs from the amount requested (prompt injection)
- **OVER_LIMIT / DAILY_CAP**: a single payment or the day's total above the agent's limits
- **BAD_ADDRESS**, **NAME_TAKEN**

Only a trusted payee, under its own limit, inside the agent's daily budget, with no flags, is paid without asking you. Voice can't approve a flagged request.

## Limits we know about

- Testnet only for now.
- The server is trusted for availability and for showing you requests honestly. A future version will show the agent's own signed request on the lens, so the server can't alter it unseen.
- Agent keys are plain files on the agent's machine. Use a separate user account or a secrets manager if the machine is shared.

Found a problem? Open an issue, or contact [@0xMiiracle](https://github.com/miracle352) privately for anything exploitable.
