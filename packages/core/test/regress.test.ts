// 검수 결함 회귀 테스트: 부채 태그 없음 → null, 증분 ROIC 정의 불가 → 판단불가, 태그 이어 붙이기, 버크셔 분기 범위
import { describe, it, expect } from 'vitest';
import cfgJson from '../../../config/buffett.json';
import { computeCalc, judgeQuant, type Config } from '../src/buffett/engine';
import { normalizeCompanyFacts, type CompanyFacts } from '../src/sec/facts';
import { berkshireFor, type Filing13F } from '../src/sec/berkshire';
import { fixture } from './fixtures';

const cfg = cfgJson as unknown as Config;
const flow = (y: number, val: number) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, form: '10-K', filed: `${y + 1}-02-15` });
const inst = (y: number, val: number) => ({ end: `${y}-12-31`, val, form: '10-K', filed: `${y + 1}-02-15` });
const usd = (arr: object[]) => ({ units: { USD: arr } });

function facts(withDebt: boolean): CompanyFacts {
  const Y = [2019, 2020, 2021, 2022, 2023, 2024];
  const g: Record<string, { units: Record<string, any[]> }> = {
    // 매출 태그가 2021년부터 바뀐 회사(ASC 606형): 앞 2년은 SalesRevenueNet에만 있음
    RevenueFromContractWithCustomerExcludingAssessedTax: usd(Y.slice(2).map((y) => flow(y, 1000 + y))),
    SalesRevenueNet: usd(Y.slice(0, 2).map((y) => flow(y, 900 + y))),
    OperatingIncomeLoss: usd(Y.map((y) => flow(y, 200))),
    NetIncomeLoss: usd(Y.map((y) => flow(y, 150))),
    StockholdersEquity: usd(Y.map((y) => inst(y, 1000))),
    Liabilities: usd(Y.map((y) => inst(y, 800))),
    CashAndCashEquivalentsAtCarryingValue: usd(Y.map((y) => inst(y, 100))),
  };
  if (withDebt) g.DebtCurrent = usd(Y.map((y) => inst(y, 50)));
  return { facts: { 'us-gaap': g } };
}

describe('부채 태그 없음 → 0으로 채우지 않음(9절)', () => {
  it('이자부부채·투하자본 null + 메모', () => {
    const r = normalizeCompanyFacts(facts(false));
    expect(r.재무_10년.every((y) => y.이자부부채 === null && y.투하자본 === null)).toBe(true);
    expect(r.메모.some((m) => m.includes('0으로 추정하지 않고'))).toBe(true);
  });
  it('DebtCurrent만 보고하는 회사도 부채로 인식', () => {
    const r = normalizeCompanyFacts(facts(true));
    expect(r.재무_10년.every((y) => y.이자부부채 === 50 && y.투하자본 === 950)).toBe(true);
  });
  it('엔진: 부채 데이터가 없으면 G5가 통과로 나오지 않음', () => {
    const inp = fixture();
    inp.재무_10년.forEach((y) => { y.이자부부채 = null; y.투하자본 = null; });
    const q = judgeQuant(inp, computeCalc(inp, cfg), cfg);
    expect(q.G5.상태).not.toBe('통과');
    expect(q.G4.상태).toBe('판단불가');
  });
});

describe('증분 ROIC 정의 불가(투하자본 증가 ≤ 0) → G4 판단불가', () => {
  it('값을 지어내지 않고 판단불가', () => {
    const inp = fixture();
    inp.재무_10년.forEach((y, i) => { y.투하자본 = 2000 - i * 50; });
    const c = computeCalc(inp, cfg);
    expect(c.증분ROIC_10년).toBeNull();
    expect(c.검산플래그.some((f) => f.항목 === '증분ROIC')).toBe(true);
    const q = judgeQuant(inp, c, cfg);
    expect(q.G4.상태).toBe('판단불가');
    expect(q.G4.근거).toContain('정의 불가');
  });
});

describe('XBRL 태그 연도별 이어 붙이기', () => {
  it('태그가 바뀐 회사도 앞 연도 매출을 잃지 않고 메모를 남김', () => {
    const r = normalizeCompanyFacts(facts(true));
    expect(r.재무_10년.map((y) => y.매출)).toEqual([2919, 2920, 3021, 3022, 3023, 3024]);
    expect(r.메모.some((m) => m.startsWith('매출') && m.includes('이어 붙였음'))).toBe(true);
  });
  it('빠진 연도는 검산 플래그', () => {
    const inp = fixture(); inp.재무_10년[2].매출 = null;
    const c = computeCalc(inp, cfg);
    expect(c.검산플래그.some((f) => f.항목 === '매출 빠진 연도' && f.설명.includes('2018'))).toBe(true);
  });
});

describe('버크셔 추정 매수가 범위: 전체 봉을 넘겨도 13F 기준 분기만 사용(배치·즉시 분석 공통)', () => {
  const row = (sh: number) => ({ nameOfIssuer: 'TESTCO', titleOfClass: 'COM', cusip: 'X1', value: sh * 10, sshPrnamt: sh, sshPrnamtType: 'SH' });
  const cur: Filing13F = { period: '2026-09-30', filed: '2026-11-14', accession: 'a', confidential: false, rows: [row(200)] };
  const prev: Filing13F = { period: '2026-06-30', filed: '2026-08-14', accession: 'b', confidential: false, rows: [row(100)] };
  const bars = [{ d: '2026-06-30', c: 1 }, { d: '2026-07-01', c: 50 }, { d: '2026-09-30', c: 60 }, { d: '2026-10-15', c: 999 }];
  it('분기 밖 봉(6/30·10/15)은 제외', () => {
    const b = berkshireFor({ cusips: ['X1'], usListed: true, cur, prev, quarterBars: bars });
    expect(b.추정매수가범위).toEqual({ 하단: 50, 상단: 60, 대상분기: '2026Q3' });
    expect(b.변화구분).toBe('증가');
  });
});
