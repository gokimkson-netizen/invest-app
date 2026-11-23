// SEC EDGAR companyfacts(XBRL) → 부록 A-3 재무_10년 정규화. 배치·브라우저(즉시 분석) 공용.
// 원본은 A급. 태그 선택 규칙은 docs/design.md '재무 태그 대응표'에 있다.
import type { FinYear } from '../buffett/engine';
import type { Bar } from '../mdd/mdd';

interface Fact { start?: string; end: string; val: number; accn?: string; fy?: number; fp?: string; form?: string; filed?: string; frame?: string }
export interface CompanyFacts { cik?: number; entityName?: string; facts: Record<string, Record<string, { units: Record<string, Fact[]> }>> }

const DUR_MIN = 350, DUR_MAX = 380;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '10-KT', '20-F', '20-F/A', '40-F']);

function series(cf: CompanyFacts, tag: string, ns = 'us-gaap', unit?: string): Fact[] {
  const t = cf.facts?.[ns]?.[tag];
  if (!t) return [];
  const units = unit ? [unit] : Object.keys(t.units);
  return units.flatMap((u) => t.units[u] ?? []);
}

/** 연간 값: 기간형(start 있음)은 약 1년 기간만, 시점형은 회계연도 말. 같은 기말은 가장 나중에 제출된 값(재작성 반영).
 *  태그는 우선순위 순서로 **연도별로 이어 붙인다**(예: ASC 606 이후 매출 태그가 바뀐 회사도 앞 연도 값을 잃지 않음). 앞 태그에 값이 있는 기말은 앞 태그 값. */
function annual(cf: CompanyFacts, tags: string[], kind: 'flow' | 'instant', ns = 'us-gaap', unit?: string): Map<string, { val: number; tag: string }> {
  const out = new Map<string, { val: number; tag: string }>();
  for (const tag of tags) {
    const m = new Map<string, { val: number; filed: string }>();
    for (const f of series(cf, tag, ns, unit)) {
      if (!f.form || !ANNUAL_FORMS.has(f.form)) continue;
      if (kind === 'flow') { if (!f.start || days(f.start, f.end) < DUR_MIN || days(f.start, f.end) > DUR_MAX) continue; }
      else if (f.start) continue;
      const prev = m.get(f.end);
      if (!prev || (f.filed ?? '') > prev.filed) m.set(f.end, { val: f.val, filed: f.filed ?? '' });
    }
    for (const [e, v] of m) if (!out.has(e)) out.set(e, { val: v.val, tag });
  }
  return out;
}

export const TAGS = {
  매출: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  매출원가: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  매출총이익: ['GrossProfit'],
  영업이익: ['OperatingIncomeLoss'],
  지배순이익: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  감가상각포함: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'],
  감가상각만: ['Depreciation'],
  무형자산상각비: ['AmortizationOfIntangibleAssets'],
  자본적지출: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  운전자본증감: ['IncreaseDecreaseInOperatingCapital'],
  지배자기자본: ['StockholdersEquity'],
  총부채: ['Liabilities'],
  자산총계: ['Assets'],
  장기부채: ['LongTermDebt'],
  장기부채비유동: ['LongTermDebtNoncurrent'],
  장기부채유동: ['LongTermDebtCurrent'],
  단기차입: ['ShortTermBorrowings', 'DebtCurrent'],
  장기부채리스포함: ['LongTermDebtAndCapitalLeaseObligations'],
  장기부채리스포함유동: ['LongTermDebtAndCapitalLeaseObligationsCurrent'],
  기업어음: ['CommercialPaper'],
  현금: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  단기투자: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
  이자비용: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
  이자수익: ['InvestmentIncomeInterest', 'InvestmentIncomeInterestAndDividend'],
  희석주식수: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  자사주수: ['TreasuryStockShares', 'TreasuryStockCommonShares'],
  우선주: ['PreferredStockValue'],
  배당금총액: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  자사주매입액: ['PaymentsForRepurchaseOfCommonStock'],
  유상증자액: ['ProceedsFromIssuanceOfCommonStock'],
  주식보상비용: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  법인세비용: ['IncomeTaxExpenseBenefit'],
  세전이익: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
} as const;

export interface NormalizeResult { 재무_10년: (FinYear & { 기말일: string })[]; 메모: string[]; 회사명?: string }

export function normalizeCompanyFacts(cf: CompanyFacts, maxYears = 10): NormalizeResult {
  const memo: string[] = [];
  const A = (k: keyof typeof TAGS, kind: 'flow' | 'instant') => annual(cf, [...TAGS[k]], kind);
  const rev = A('매출', 'flow'), cogs = A('매출원가', 'flow'), gp = A('매출총이익', 'flow'), oi = A('영업이익', 'flow'), ni = A('지배순이익', 'flow');
  const dna = A('감가상각포함', 'flow'), dep = A('감가상각만', 'flow'), amort = A('무형자산상각비', 'flow');
  const capex = A('자본적지출', 'flow'), wc = A('운전자본증감', 'flow'), eq = A('지배자기자본', 'instant'), liab = A('총부채', 'instant');
  const ltd = A('장기부채', 'instant'), ltdN = A('장기부채비유동', 'instant'), ltdC = A('장기부채유동', 'instant'), stb = A('단기차입', 'instant'), cp = A('기업어음', 'instant');
  const ltdL = A('장기부채리스포함', 'instant'), ltdLC = A('장기부채리스포함유동', 'instant');
  const cash = A('현금', 'instant'), sti = A('단기투자', 'instant'), ie = A('이자비용', 'flow'), ii = A('이자수익', 'flow');
  const dil = A('희석주식수', 'flow'), tre = A('자사주수', 'instant'), pref = A('우선주', 'instant');
  const div = A('배당금총액', 'flow'), rep = A('자사주매입액', 'flow'), iss = A('유상증자액', 'flow'), sbc = A('주식보상비용', 'flow');
  const tax = A('법인세비용', 'flow'), pti = A('세전이익', 'flow');
  const sharesDei = annual(cf, ['EntityCommonStockSharesOutstanding'], 'instant', 'dei');

  // 기준 기말일 = 순이익(또는 매출) 연간 값이 있는 기말
  const ends = [...new Set([...ni.keys(), ...rev.keys()])].sort().slice(-maxYears);
  const pick = (m: Map<string, { val: number }>, e: string) => m.get(e)?.val ?? null;
  let usedDnaIncl = false, debtAssumedZero = false;
  const years = ends.map((e) => {
    const d1 = pick(dna, e);
    const dOnly = pick(dep, e);
    let 감가 = d1, 무형 = 0;
    if (d1 !== null) usedDnaIncl = true; else { 감가 = dOnly; 무형 = pick(amort, e) ?? 0; }
    const longPart = pick(ltd, e) ?? (pick(ltdN, e) !== null || pick(ltdC, e) !== null ? (pick(ltdN, e) ?? 0) + (pick(ltdC, e) ?? 0) : null)
      ?? (pick(ltdL, e) !== null || pick(ltdLC, e) !== null ? (pick(ltdL, e) ?? 0) + (pick(ltdLC, e) ?? 0) : null);
    const debtParts = [longPart, pick(stb, e), pick(cp, e)];
    // 부채 태그가 하나도 없으면 0으로 추정하지 않고 null(데이터 없음)로 둔다(9절 추정값 채우기 금지)
    const 이자부 = debtParts.some((x) => x !== null) ? debtParts.reduce((a: number, b) => a + (b ?? 0), 0) : null;
    if (이자부 === null) debtAssumedZero = true;
    const 현금 = pick(cash, e) !== null ? (pick(cash, e) as number) + (pick(sti, e) ?? 0) : null;
    const 자본 = pick(eq, e);
    const 영업 = pick(oi, e);
    const fy: FinYear & { 기말일: string } = {
      연도: +e.slice(0, 4), 기말일: e,
      매출: pick(rev, e), 매출원가: pick(cogs, e), 매출총이익: pick(gp, e), 영업이익: 영업, 지배순이익: pick(ni, e), 일회성손익: null,
      감가상각비: 감가, 무형자산상각비: 무형, 자본적지출: pick(capex, e), 운전자본증감: pick(wc, e),
      지배자기자본: 자본, 투하자본: 자본 !== null && 이자부 !== null && 현금 !== null ? 자본 + 이자부 - 현금 : null,
      총부채: pick(liab, e), 이자부부채: 이자부, 현금성자산: 현금, 비영업자산: null,
      이자비용: pick(ie, e), 이자수익: pick(ii, e), EBITDA: 영업 !== null && 감가 !== null ? 영업 + 감가 + 무형 : null,
      보통주_유통주식수: pick(sharesDei, e), 희석주식수: pick(dil, e), 자사주수: pick(tre, e), 우선주_시가총액: pick(pref, e),
      배당금총액: pick(div, e), 자사주매입액: pick(rep, e), 자사주소각액: null, 유상증자액: pick(iss, e), 주식보상비용: pick(sbc, e),
      연말시가총액: null, PER: null, PBR: null, 법인세비용: pick(tax, e), 세전이익: pick(pti, e),
    };
    return fy;
  });
  const mixed = ([['매출', rev], ['영업이익', oi], ['지배순이익', ni]] as const).filter(([, m]) => new Set(ends.map((e) => m.get(e)?.tag).filter(Boolean)).size > 1).map(([k]) => k);
  if (mixed.length) memo.push(`${mixed.join('·')}: 연도에 따라 다른 XBRL 태그를 이어 붙였음(태그 변경 회사, 예: ASC 606)`);
  if (usedDnaIncl) memo.push('감가상각비 태그가 무형자산 상각을 포함하는 연도는 무형자산상각비=0으로 둠(이중 반영 방지)');
  if (debtAssumedZero) memo.push('이자부부채 태그가 없는 연도가 있음 — 0으로 추정하지 않고 데이터 없음으로 둠(해당 연도 투하자본·순부채 지표 산출 안 함)');
  memo.push('일회성손익·비영업자산·자사주소각액은 XBRL 구조화 항목이 없어 null');
  memo.push('투하자본 = 지배자기자본 + 이자부부채 − (현금 + 단기투자)');
  // 보통주 유통주식수(dei)는 표지 기준일 값이라 기말과 다를 수 있음 → 가장 가까운 값으로 보충
  const dei = [...sharesDei.entries()].sort();
  for (const y of years) if (y.보통주_유통주식수 === null && dei.length) {
    const near = dei.reduce((best, cur) => (Math.abs(days(cur[0], y.기말일)) < Math.abs(days(best[0], y.기말일)) ? cur : best));
    if (Math.abs(days(near[0], y.기말일)) <= 120) y.보통주_유통주식수 = near[1].val;
  }
  return { 재무_10년: years, 메모: memo, 회사명: cf.entityName };
}

/** 기말 시가총액·PER·PBR — 기말일(또는 직전 거래일) 종가 × 보통주 유통주식수 */
export function attachMarket(years: (FinYear & { 기말일: string })[], bars: Bar[]): void {
  for (const y of years) {
    let c: number | null = null;
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].d <= y.기말일) { if (Date.parse(y.기말일) - Date.parse(bars[i].d) <= 10 * 864e5) c = bars[i].c; break; }
    const sh = y.보통주_유통주식수 ?? y.희석주식수;
    if (c !== null && sh) {
      y.연말시가총액 = c * sh;
      y.PER = y.지배순이익 && y.지배순이익 > 0 ? y.연말시가총액 / y.지배순이익 : null;
      y.PBR = y.지배자기자본 && y.지배자기자본 > 0 ? y.연말시가총액 / y.지배자기자본 : null;
    }
  }
}

/** M2 실적: 최근 분기·연간 매출·영업이익·순이익과 전년 대비 증감 */
export interface Earnings { 항목: string; 기간: string; 값: number | null; 전년동기: number | null; '증감%': number | null }
export function latestEarnings(cf: CompanyFacts): Earnings[] {
  const out: Earnings[] = [];
  const items: [string, readonly string[]][] = [['매출', TAGS.매출], ['영업이익', TAGS.영업이익], ['순이익', TAGS.지배순이익]];
  for (const [name, tags] of items) {
    for (const tag of tags) {
      const fs = series(cf, tag).filter((f) => f.start && f.form && (f.form.startsWith('10-Q') || f.form.startsWith('10-K')));
      if (!fs.length) continue;
      const q = fs.filter((f) => { const d = days(f.start!, f.end); return d >= 80 && d <= 100; });
      const y = fs.filter((f) => { const d = days(f.start!, f.end); return d >= DUR_MIN && d <= DUR_MAX; });
      const latestOf = (arr: Fact[]) => arr.sort((a, b) => a.end.localeCompare(b.end) || (a.filed ?? '').localeCompare(b.filed ?? '')).slice(-1)[0];
      const prevOf = (arr: Fact[], f: Fact) => arr.filter((x) => Math.abs(days(x.end, f.end) - 365) <= 20).sort((a, b) => (a.filed ?? '').localeCompare(b.filed ?? '')).slice(-1)[0];
      for (const [label, arr] of [['최근 분기', q], ['최근 연간', y]] as const) {
        const f = latestOf([...arr]);
        if (!f) continue;
        const p = prevOf(arr, f);
        out.push({ 항목: name, 기간: `${label}(${f.start}~${f.end})`, 값: f.val, 전년동기: p?.val ?? null, '증감%': p && p.val ? ((f.val - p.val) / Math.abs(p.val)) * 100 : null });
      }
      break;
    }
  }
  return out;
}

/** SIC 코드 → 업종유형(부록 A 업종 분기) */
export function sicToType(sic: string | number | null | undefined): '일반' | '은행' | '보험' | '지주사' {
  const s = Number(sic);
  if ([6021, 6022, 6029, 6035, 6036].includes(s)) return '은행';
  if (s >= 6311 && s <= 6411) return '보험';
  if (s === 6719) return '지주사';
  return '일반';
}
