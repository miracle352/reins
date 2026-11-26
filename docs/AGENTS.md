# Give your agent a Reins wallet

Reins ships an MCP server, `kit/src/mcp.ts`. Any agent that speaks MCP gets three tools:

| Tool | What it does |
|---|---|
| `reins_connect` | Asks you, on your glasses, to create a wallet for this agent. Waits for your answer. |
| `reins_wallet` | The agent's wallet address and its (deliberately small) buffer. |
| `reins_pay` | Asks to pay someone. Trusted payees under their limit go through; everything else waits for you on the lens. |

The agent never sees a key. The operator key lives in `~/.reins/agent-<name>.json` on the machine running the MCP server, and the wallet only ever holds what you approved.

Each agent needs its own `REINS_AGENT_NAME`; that name is what you see on the lens. The first time, it also needs your **link code** (`REINS_LINK`), from the phone page under "Connect an agent". After your approval the agent keeps its own key and no longer needs the code.

**Timeouts.** `reins_pay` and `reins_connect` wait for you to decide (up to 5 and 10 minutes). Raise your agent's MCP tool timeout as shown below, or it will give up before you look up.

Replace `/path/to/reins` with your clone. Agents talk to the hosted server (`https://reins-jhyz.onrender.com`) unless you set `REINS_SERVER` to your own.

## Claude Code

```bash
claude mcp add reins \
  -e REINS_AGENT_NAME=claude \
  -e REINS_LINK=ABCD-2345 \
  -- npx tsx /path/to/reins/kit/src/mcp.ts

# let a payment wait for you (milliseconds)
export MCP_TOOL_TIMEOUT=600000
claude "Pay the Alfama Hotel deposit of 0.4 GRAM to 0QDKb9AkUSCDRhUkbJdsRs5RsI0uLuQF45gSL4jTG6hMpt8S"
```

## Hermes Agent (Nous Research)

`~/.hermes/config.yaml`:

```yaml
mcp_servers:
  reins:
    command: "npx"
    args: ["tsx", "/path/to/reins/kit/src/mcp.ts"]
    env:
      REINS_AGENT_NAME: "hermes"
      REINS_LINK: "ABCD-2345"
    timeout: 600
```

Then `/reload-mcp` in a running chat, or start `hermes chat`. Hermes also lives in Telegram, so this is the closest match to TON's "agents in Telegram" picture: your Hermes asks, your glasses answer.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.reins]
command = "npx"
args = ["tsx", "/path/to/reins/kit/src/mcp.ts"]
tool_timeout_sec = 600

[mcp_servers.reins.env]
REINS_AGENT_NAME = "codex"
REINS_LINK = "ABCD-2345"
```

## Your own agent (no MCP)

```ts
import { ReinsAgent } from './kit/src/lib.ts';

const agent = await ReinsAgent.open('my-agent');      // REINS_LINK in the environment the first time
await agent.connect();                                   // asks your glasses for a wallet
const r = await agent.pay(to, '0.4', 'Hotel deposit, 0.4 GRAM');
if (!r.ok) console.log(r.status, r.reason);              // rejected / revoked / timeout
```

## Try it without any agent installed

`demo/mcp-agent.ts` is a small agent that reaches its wallet only through MCP, driven by a free OpenRouter model:

```bash
OPENROUTER_API_KEY=... REINS_LINK=ABCD-2345 REINS_AGENT_NAME=mcp-agent npx tsx demo/mcp-agent.ts "Pay the alfama-hotel invoice."
```

## What we learned running real models against it

- Models do follow instructions hidden in documents. A free model asked to pay a hotel deposit read a hidden comment and asked for 2 GRAM while writing "0.4" in the purpose. Reins compares the two in code.
- Models are good at saying what they're doing and bad at checking addresses. It paid "the address the invoice said changed this month" without hesitation.
- Models take a low balance as a hard limit. Our first version showed the 0.3 GRAM buffer and the model decided it could not ask for more. The tool text now says approved payments are funded by you.
