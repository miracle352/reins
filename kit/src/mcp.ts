#!/usr/bin/env -S npx tsx
// reins-mcp: give any MCP agent (Claude Code, Codex, Hermes…) a TON wallet that answers to your glasses.
// The agent never sees the key. It can only ask; the owner's rules and the lens decide.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ReinsAgent } from './lib.ts';

const NAME = process.env.REINS_AGENT_NAME ?? 'mcp-agent';
const agent = await ReinsAgent.open(NAME);
const server = new McpServer({ name: 'reins', version: '0.1.0' });

server.registerTool('reins_wallet', {
  title: 'Wallet status',
  description: 'Shows this agent\'s TON wallet: address, balance and whether the owner has approved it. Call reins_connect first if it does not exist yet.',
  inputSchema: {},
}, async () => {
  if (!agent.agentId) return text('No wallet yet. Call reins_connect to ask the owner for one.');
  const w = await agent.wallet();
  return text([
    `Wallet ${w.address} (${w.status})`,
    `Buffer: ${Number(BigInt(w.balance)) / 1e9} GRAM (testnet).`,
    'This wallet is kept nearly empty on purpose. A low balance does NOT limit what you can pay:',
    'call reins_pay with the full amount and your owner funds each payment they approve.',
  ].join('\n'));
});

server.registerTool('reins_connect', {
  title: 'Ask the owner for a wallet',
  description: 'Asks the owner (on their Even G2 glasses) to create a TON wallet for this agent. Waits up to 10 minutes for them to approve.',
  inputSchema: {},
}, async () => {
  try { const w = await agent.connect(); return text(`Owner approved. Wallet ${w.address} is live.`); }
  catch (e) { return text(`Not approved: ${(e as Error).message}`, true); }
});

server.registerTool('reins_pay', {
  title: 'Pay in GRAM (needs owner approval unless pre-trusted)',
  description: [
    'Sends GRAM on TON testnet. The owner sees the request on their glasses and approves or rejects it;',
    'payments to payees they trust, under their limit, go through on their own.',
    'Your wallet balance does not need to cover the amount: approved payments are funded by the owner.',
    'Say exactly what the payment is for and include the amount in the purpose, e.g. "Hotel deposit, 0.4 GRAM".',
    'If rejected, do not retry the same payment: tell the user.',
  ].join(' '),
  inputSchema: {
    to: z.string().describe('Recipient TON address'),
    amount: z.string().describe('Amount in GRAM, e.g. "0.4"'),
    purpose: z.string().max(140).describe('What this pays for, including the amount'),
  },
}, async ({ to, amount, purpose }) => {
  const r = await agent.pay(to, amount, purpose);
  if (r.ok) return text(`Paid ${amount} GRAM to ${to}${r.auto ? ' (pre-approved by owner rules)' : ' (owner approved)'}. tx ${r.tx}`);
  return text(`Payment not made (${r.status}): ${r.reason}`, r.status !== 'rejected');
});

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });
await server.connect(new StdioServerTransport());
