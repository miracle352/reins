// An LLM agent that reaches its wallet ONLY through MCP, the way Claude Code, Hermes or Codex would.
// It starts reins-mcp as a child process, lists its tools, and lets a free OpenRouter model drive.
//   OPENROUTER_API_KEY=... tsx demo/mcp-agent.ts "Pay the weather-api invoice."
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error('Set OPENROUTER_API_KEY');
const MODELS = (process.env.OPENROUTER_MODELS ?? 'nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3.5-super-vl:free').split(',');
const scenario = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));
const task = process.argv.slice(2).join(' ') || scenario.task;
const say = (s: string) => console.log(`\x1b[36m[agent]\x1b[0m ${s}`);

// 1. Connect to Reins over MCP. The agent process never sees a key.
const mcp = new Client({ name: 'reins-demo-agent', version: '1.0.0' });
await mcp.connect(new StdioClientTransport({
  command: 'npx', args: ['tsx', new URL('../kit/src/mcp.ts', import.meta.url).pathname],
  env: { ...process.env as Record<string, string>, REINS_AGENT_NAME: process.env.REINS_AGENT_NAME ?? 'mcp-agent' },
}));
const { tools } = await mcp.listTools();
say(`connected to Reins over MCP: ${tools.map(t => t.name).join(', ')}`);

// 2. Local, read-only helper tools for the scenario (merchants and invoices).
const local = {
  list_merchants: { description: 'Known merchants and their TON addresses', parameters: { type: 'object', properties: {} }, run: async () => JSON.stringify(scenario.merchants) },
  read_invoice: { description: 'Read an invoice by name', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, run: async (a: any) => scenario.invoices[a.name] ?? `No invoice ${a.name}. Have: ${Object.keys(scenario.invoices).join(', ')}` },
} as const;

const schema = [
  ...tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
  ...Object.entries(local).map(([name, t]) => ({ type: 'function', function: { name, description: t.description, parameters: t.parameters } })),
];

async function chat(messages: any[]) {
  for (const model of MODELS) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'x-title': 'Reins MCP demo' },
      body: JSON.stringify({ model, messages, tools: schema, tool_choice: 'auto', temperature: 0 }),
    });
    const j: any = await r.json();
    if (r.ok && j.choices?.[0]) return j.choices[0].message;
    console.error(`model ${model}: ${j.error?.message ?? r.status}`);
  }
  throw new Error('No model answered');
}

// 3. The agent loop.
const messages: any[] = [
  { role: 'system', content: 'You are an assistant with a small TON wallet provided by the reins tools. If you have no wallet yet, call reins_connect first. Pay what the user asks with reins_pay, and always put the amount in the purpose.' },
  { role: 'user', content: task },
];
for (let step = 0; step < 12; step++) {
  const m = await chat(messages);
  messages.push(m);
  if (!m.tool_calls?.length) { say(m.content ?? '(done)'); break; }
  for (const call of m.tool_calls) {
    const args = JSON.parse(call.function.arguments || '{}');
    say(`→ ${call.function.name} ${JSON.stringify(args)}`);
    let out: string;
    if (call.function.name in local) out = await (local as any)[call.function.name].run(args);
    else {
      const res: any = await mcp.callTool({ name: call.function.name, arguments: args }, undefined, { timeout: 10 * 60_000 });
      out = res.content?.map((c: any) => c.text).join('\n') ?? '';
    }
    say(`← ${out.split('\n')[0].slice(0, 140)}`);
    messages.push({ role: 'tool', tool_call_id: call.id, content: out });
  }
}
await mcp.close();
