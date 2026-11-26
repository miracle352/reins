// Dev: act as an agent. tsx tools/agent-cli.ts <name> connect | pay <to> <amount> <purpose...>
import { ReinsAgent } from '../kit/src/lib.ts';

const [name, cmd, to, amount, ...purpose] = process.argv.slice(2);
const agent = await ReinsAgent.open(name);
if (cmd === 'connect') console.log(await agent.connect());
if (cmd === 'pay') console.log(await agent.pay(to, amount, purpose.join(' ')));
if (cmd === 'wallet') console.log(await agent.wallet());
