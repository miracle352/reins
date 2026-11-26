// The phone page in a normal browser, with sample data and a scripted day, for people without G2.
// Same code as in the Even app (phone.ts); only the vault and the server are stand-ins.
import { mountPhone } from './phone.ts';

const HOTEL = '0QDKb9AkUSCDRhUkbJdsRs5RsI0uLuQF45gSL4jTG6hMpt8S';
const WEATHER = '0QAXlriwVZZq_QoNvMB27iJvSH3Yi_JO6oYcqsIz1pHkHmcx';
const LOOK = '0QAXlr2RFUHtk-thGbS_E20mFe_Ilg3-9ZD5ctQLgDwHHmcx';
const VAULT = '0QCMyK9EmZw_NNQxlxbX3AkfWpKKSGIrQ3xNMWbASybdN3se';
const WORDS = 'sample words shown only in this demo never use them for a real vault please create your own inside the even app today thanks friend'.split(' ');

type Ev = { t: number; text: string; level: 'info' | 'warn' | 'alarm' };
const min = (m: number) => Date.now() - m * 60_000;
const agent = (id: string, name: string, spent: number, daily: number, balance: number, address: string) =>
  ({ id, name, address, status: 'active', balance: String(balance), spentToday: String(spent), daily: String(daily), waiting: 0, last: null as null | { amount: string; to: string; at: number } });

function fresh() {
  return {
    vault: VAULT, vaultBalance: '4.82', atRisk: '0.96', spentToday: '0.75', telegram: 'linked', telegramBot: 'reins_m_bot', link: 'S8VM-ZZDE',
    agents: [
      agent('a1', 'trip-bot', 0.45, 3, 0.32, 'kQA70ZbimUpMs_UEdb4OZawGris6h1w-6S8cYlg4RvHLdJJE'),
      agent('a2', 'shop-bot', 1.1, 2, 0.32, 'kQCBtbVDOyIsKEB_XMAZ7i1WYfzBb3o6kddYUslH4hh6ftxJ'),
      agent('a3', 'chef-bot', 0.2, 3, 0.32, 'kQAN_8Sr5QMnMa41KFwDZc-dZHJiMPkA3fxb2DoEYFdQAsav'),
    ],
    alarm: null as any, pending: null as any, pendingCount: 0, ticker: [] as string[],
    payees: [
      { address: WEATHER, name: 'Weather API', trusted: true, autoLimit: '0.05' },
      { address: HOTEL, name: 'Alfama Hotel', trusted: false, autoLimit: '0.4' },
    ],
    events: [
      { t: min(48), text: 'Auto-approved 0.05 → Weather API (chef-bot)', level: 'info' },
      { t: min(95), text: 'trip-bot paid 0.4 GRAM to Alfama Hotel', level: 'info' },
      { t: min(96), text: 'Funded trip-bot 0.4 GRAM', level: 'info' },
      { t: min(130), text: 'shop-bot asks 2 GRAM !! said 0.4, asks 2', level: 'warn' },
      { t: min(131), text: 'Rejected shop-bot: 2 GRAM', level: 'warn' },
    ] as Ev[],
  };
}
let state = fresh();
const log = (text: string, level: Ev['level'] = 'info') => { state.events.unshift({ t: Date.now(), text, level }); state.events.length = Math.min(state.events.length, 30); };
const byId = (id: string) => state.agents.find(a => a.id === id)!;
const pay = (id: string, amount: number, to: string) => {
  const a = byId(id);
  a.spentToday = (+a.spentToday + amount).toFixed(2); a.last = { amount: String(amount), to, at: Date.now() };
  state.spentToday = (+state.spentToday + amount).toFixed(2);
  log(`${a.name} paid ${amount} GRAM to ${to}`);
};

// A day in under a minute: payments, a poisoned request, a stolen key, a kill.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (;;) {
    await sleep(3000); pay('a1', 0.05, 'Weather API');
    await sleep(3500); pay('a3', 0.3, 'Alfama Hotel');
    await sleep(3500);
    state.pending = { id: 'r1', kind: 'pay', agent: 'trip-bot', purpose: 'Weather API renewal', flags: [{ code: 'LOOKALIKE', text: 'looks like Weather API' }], amount: '0.05', amountNano: '50000000', to: LOOK, agentAddress: '', operatorPub: '' };
    state.pendingCount = 1; byId('a1').waiting = 1; log('trip-bot asks 0.05 GRAM !! looks like Weather API', 'warn');
    await sleep(6000);
    state.pending = null; state.pendingCount = 0; byId('a1').waiting = 0; log('Rejected trip-bot: 0.05 GRAM', 'warn');
    await sleep(3000); pay('a2', 0.6, 'a supplier');
    await sleep(3500);
    state.alarm = { agentId: 'a2', agent: 'shop-bot', text: '', agentAddress: '', amount: '0.25', to: 'kQCQ8F' }; log('ALARM shop-bot: 0.25 GRAM left with no approval', 'alarm');
    await sleep(5000);
    state.alarm = null; byId('a2').status = 'revoked'; byId('a2').balance = '0';
    state.vaultBalance = (+state.vaultBalance + 0.07).toFixed(2); log('KILLED shop-bot: key revoked, funds swept to vault', 'alarm');
    await sleep(9000);
    const ev = state.events; state = fresh(); state.events = ev; log('A new day: shop-bot reconnected with a new key');
  }
})();

mountPhone({
  getVault: () => ({ address: VAULT, words: WORDS, keys: {} as any }),
  getServer: () => 'demo (sample data)',
  getState: () => state as any,
  setServer: async () => {},
  create: async () => { throw new Error('demo'); },
  import: async () => { throw new Error('demo'); },
  async api(_m: string, path: string, b: any) {
    if (path === '/lens/budget') byId(b.agentId).daily = String(b.daily);
    if (path === '/lens/pause') { const a = byId(b.agentId); a.status = b.on ? 'frozen' : 'active'; log(`${b.on ? 'Paused' : 'Resumed'} ${a.name}`); }
    if (path === '/lens/payee') { const p = state.payees.find(x => x.address === b.address)!; if (b.trusted !== undefined) p.trusted = b.trusted; if (b.name) p.name = b.name; }
    if (path === '/lens/link') state.link = ['K7QF-29XA', 'M3TR-8HNV', 'P4WZ-6CJD'][Math.floor(Math.random() * 3)];
    return { ok: true };
  },
});
