// 10절 31번: 같은 고정 픽스처를 Node와 브라우저에서 같은 공용 모듈로 계산해 비교한다.
import cfgJson from '../../config/buffett.json';
import rulesJson from '../../config/news_rules.json';
import { assembleM1 } from '../../packages/core/src/buffett/assemble';
import { decide, type Config } from '../../packages/core/src/buffett/engine';
import { normalizeCompanyFacts } from '../../packages/core/src/sec/facts';
import { summarize, currentDrawdown, backtest, type Bar } from '../../packages/core/src/mdd/mdd';
import { buildCards, type Rules } from '../../packages/core/src/news/news';
import { m5Status } from '../../packages/core/src/m5/position';

function bars(): Bar[] {
  const out: Bar[] = []; let v = 50; const d0 = Date.UTC(2014, 0, 2);
  for (let i = 0, n = 0; n < 3000; i++) {
    const d = new Date(d0 + i * 864e5); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    v = v * (1 + 0.0003 + 0.02 * Math.sin(n * 0.07) * Math.cos(n * 0.011)); out.push({ d: d.toISOString().slice(0, 10), c: v }); n++;
  }
  return out;
}
function facts() {
  const fy = (f: (i: number) => number, inst = false) => ({ units: { USD: Array.from({ length: 10 }, (_, i) => ({ ...(inst ? {} : { start: `${2016 + i}-01-01` }), end: `${2016 + i}-12-31`, val: f(i), form: '10-K', fp: 'FY', filed: `${2017 + i}-02-15` })) } });
  const g = (i: number) => 1.07 ** i;
  return { facts: { 'us-gaap': {
    Revenues: fy((i) => 1e9 * g(i)), CostOfRevenue: fy((i) => 4.5e8 * g(i)), OperatingIncomeLoss: fy((i) => 2.4e8 * g(i)), NetIncomeLoss: fy((i) => 1.7e8 * g(i)),
    DepreciationDepletionAndAmortization: fy((i) => 4e7 * g(i)), PaymentsToAcquirePropertyPlantAndEquipment: fy((i) => 5.5e7 * g(i)), StockholdersEquity: fy((i) => 1.1e9 * g(i), true),
    Liabilities: fy((i) => 7e8 * g(i), true), LongTermDebt: fy(() => 2e8, true), CashAndCashEquivalentsAtCarryingValue: fy((i) => 2.5e8 * g(i), true), InterestExpense: fy(() => 1.2e7),
    IncomeTaxExpenseBenefit: fy((i) => 4.5e7 * g(i)), IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: fy((i) => 2.2e8 * g(i)),
    WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: fy(() => 1e8).units.USD } },
  } } };
}
export function run() {
  const cfg = cfgJson as unknown as Config;
  const b = bars();
  const m1 = assembleM1({ ticker: 'PAR', name: 'Parity', sic: '7372', years: normalizeCompanyFacts(facts() as any).재무_10년, bars: b, dgs10: { value: 4.1, date: '2026-11-20' }, priceGrade: 'C' }, cfg);
  const dec = decide(m1.inp, m1.calc, cfg, { G1: { 상태: '통과', 근거: '', 등급: 'A' }, G3: { 상태: '통과', 근거: '', 등급: 'A', 원인: '해당없음' }, G6: { 상태: '조건부', 근거: '', 등급: 'A' } });
  const now = new Date('2026-11-23T00:00:00Z');
  const cards = buildCards([{ id: 'a', title: 'Fed cuts rates', summary: null, source: 'Fed', domain: 'x', grade: 'A', url: 'https://x', published: '2026-11-22T00:00:00Z', kind: 'official', market: 'US' }], rulesJson as unknown as Rules, [], [], {}, now);
  return {
    calc: m1.calc, quant: m1.quant, 결정: { 줄: dec.결정표_줄, 요구: dec['요구안전마진%'], 매수검토가격: dec.주당_매수검토가격, 조건부: dec.조건부_개수 },
    mdd: summarize(b, 'US'), dd: currentDrawdown(b, '3y'), bt: backtest(b, { 진입낙폭: -20, 청산: { 종류: '전고점회복' }, 수수료bp: 25, 세율: 22 }),
    news: cards.map((c) => ({ lv: ['참고', '보통', '높음', '긴급'].indexOf(c.중요도) })), m5: m5Status({ 총자산: 1000, 매수내역: [{ 일자: 'x', 가격: 3.3, 수량: 100 }], 현재가: 4.4, 전고점: 70 }),
  };
}
