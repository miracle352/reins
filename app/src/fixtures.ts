// Dev only: every screen with made-up data, so each one can be checked (and captured) without staging it on chain.
import * as L from './lens.ts';

const WEATHER = '0QAXlriwVZZq_QoNvMB27iJvSH3Yi_JO6oYcqsIz1pHkHmcx';
const LOOKALIKE = '0QCmpo2RFUHtk-thGbS_E20mFe_Ilg3-9ZD5ctQLgDwHHmcx';
const HOTEL = '0QDKb9AkUSCDRhUkbJdsRs5RsI0uLuQF45gSL4jTG6hMpt8S';
const AGENT = 'kQA70ZbimUpMs_UEdb4OZawGris6h1w-6S8cYlg4RvHLdJJE';
const NEWADDR = 'kQCBtbVDOyIsKEB_XMAZ7i1WYfzBb3o6kddYUslH4hh6ftxJ';

const card = (o: Partial<L.Card>): L.Card => ({
  id: 'x', kind: 'pay', agent: 'trip-bot', purpose: 'Hotel deposit, 0.4 GRAM', flags: [], amount: '0.4', amountNano: '400000000',
  to: HOTEL, toName: 'Alfama Hotel', agentAddress: AGENT, operatorPub: '', ...o,
});
const agent = (o: Partial<L.AgentRow>): L.AgentRow => ({
  id: 'a1', name: 'trip-bot', address: AGENT, status: 'active', balance: '0.32', spentToday: '0.45', daily: '3', waiting: 0,
  last: { amount: '0.05', to: 'Weather API', at: Date.now() - 12 * 60_000 }, ...o,
});
const state = (o: Partial<L.State>): L.State => ({
  vault: HOTEL, vaultBalance: '4.82', atRisk: '0.64', spentToday: '1.23',
  agents: [agent({}), agent({ id: 'a2', name: 'shop-bot', spentToday: '0.78', daily: '2', address: NEWADDR })],
  alarm: null, pending: null, pendingCount: 0, ticker: [
    'Auto-approved 0.05 → Weather API (trip-bot)', 'trip-bot asks 0.4 GRAM', 'Funded trip-bot 0.4 GRAM',
    'shop-bot asks 2 GRAM !! said 0.4, asks 2', 'Rejected shop-bot: 2 GRAM',
  ], telegram: 'linked', ...o,
});

export const gallery: [string, L.Page][] = [
  ['splash', L.splashPage('')],
  ['home', L.home(state({}))],
  ['home-empty', L.home(state({ agents: [], spentToday: '0', atRisk: '0' }))],
  ['agent', L.agentPage(agent({}))],
  ['card-safe', L.card(card({}), 1)],
  ['card-new', L.card(card({ toName: undefined, to: NEWADDR, purpose: 'Museum tickets x2', amount: '0.12', flags: [{ code: 'NEW', text: 'never paid before' }] }), 1)],
  ['card-lookalike', L.card(card({ toName: undefined, to: LOOKALIKE, amount: '0.05', purpose: 'Weather API renewal', twin: { name: 'Weather API', address: WEATHER },
    flags: [{ code: 'NEW', text: 'never paid before' }, { code: 'LOOKALIKE', text: 'looks like Weather API' }] }), 2)],
  ['card-mismatch', L.card(card({ amount: '2', flags: [{ code: 'MISMATCH', text: 'said 0.4, asks 2' }, { code: 'OVER_LIMIT', text: 'over the 1 GRAM limit' }] }), 1)],
  ['card-create', L.card(card({ kind: 'create', agent: 'chef-bot', amount: '0.3', to: undefined, toName: undefined }), 1)],
  ['card-impostor', L.card(card({ kind: 'create', agent: 'trip-bot', amount: '0.3', to: undefined, toName: undefined, agentAddress: NEWADDR, flags: [{ code: 'NAME_TAKEN', text: 'trip-bot already has a wallet' }] }), 1)],
  ['why', L.why(card({ toName: undefined, to: LOOKALIKE, flags: [{ code: 'NEW', text: 'never paid before' }, { code: 'LOOKALIKE', text: 'looks like Weather API' }] }))],
  ['alarm', L.alarm({ agentId: 'a1', agent: 'trip-bot', text: '', agentAddress: AGENT, amount: '0.25', to: LOOKALIKE }, '0.32')],
  ['confirm-kill', L.confirmKill('trip-bot', '0.32')],
  ['confirm-give', L.confirmGive(agent({}), 0.5)],
  ['result-sent', L.result('SENT', 'trip-bot can pay Alfama Hotel 0.4 now.')],
  ['result-killed', L.result('KILLED', "trip-bot's key is revoked on chain.\n0.32 GRAM swept back to your vault.")],
  ['activity', L.activity(state({}))],
  ['listening', L.listening('Try "give trip-bot 1 more", "pause shop-bot"\nor "how much today"', 0.6)],
];
