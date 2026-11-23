// M1 버핏식 분석 — 계산·정량 관문·결정표 (부록 A-3·A-4·A-5·A-7을 코드로 구현)
// 배치(Node)와 브라우저(즉시 분석)가 이 모듈 한 벌을 공유한다(3-8절).
import {
  BandRule, Band, judgeBand, combineBands, mean, sdPop, isNum, safeDiv, clamp, minOf, maxOf, Num,
} from '../common/util';

export type GateStatus = '통과' | '조건부' | '탈락' | '판단불가';
export type FinalVerdict = '매수 검토' | '관심 종목(가격 대기)' | '관심 종목' | '제외' | '판단 불가';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'P';

/** 부록 A-3 재무_10년 1개 연도. (법인세비용·세전이익은 ROIC 세후 계산을 위해 추가한 필드 — docs/design.md) */
export interface FinYear {
  연도: number;
  매출?: Num; 매출원가?: Num; 매출총이익?: Num; 영업이익?: Num; 지배순이익?: Num; 일회성손익?: Num;
  감가상각비?: Num; 무형자산상각비?: Num; 자본적지출?: Num; 운전자본증감?: Num;
  지배자기자본?: Num; 투하자본?: Num; 총부채?: Num; 이자부부채?: Num; 현금성자산?: Num; 비영업자산?: Num;
  이자비용?: Num; 이자수익?: Num; EBITDA?: Num;
  보통주_유통주식수?: Num; 희석주식수?: Num; 자사주수?: Num; 우선주_시가총액?: Num;
  배당금총액?: Num; 자사주매입액?: Num; 자사주소각액?: Num; 유상증자액?: Num; 주식보상비용?: Num;
  연말시가총액?: Num; PER?: Num; PBR?: Num;
  법인세비용?: Num; 세전이익?: Num;
}

export interface BuffettInput {
  기준일: string;
  단위: string;
  종목: { 이름: string; 티커: string; 시장: string; 통화: string; 업종?: string; 업종유형: '일반' | '은행' | '보험' | '지주사' };
  재무_10년: FinYear[];
  업종특화?: {
    은행?: { ROA?: Num[]; CET1비율?: Num[]; 대손비용률?: Num[] };
    보험?: { 합산비율?: Num[]; 지급여력비율?: Num[]; 지급여력_산출기준?: 'K-ICS' | 'RBC' };
    ROE?: Num[];
  };
  비재무_해자증거?: { 항목: string; 내용: string; 출처: string; 등급: string }[] | null;
  시장데이터: { 주가: Num; 보통주_시가총액: Num; 주당순자산?: Num; 국채10년_금리: Num; 금리_기준일?: string };
  /** 핵심 근거 등급(재무·가격 출처 등급). 확신도 '상' 판정에 쓴다 */
  근거등급?: { 재무?: Grade; 가격?: Grade; 금리?: Grade };
}

export interface Flag { 항목: string; 상태: '정상' | '불일치' | '데이터부족'; 설명: string }

export interface Scenario { 성장률: number | null; 할인율: number | null; 영구성장률: number | null; 자기자본가치: number | null; 주당내재가치: number | null }

export interface Calc {
  데이터기간_년: number;
  ROE_연도별: (number | null)[]; ROIC_연도별: (number | null)[]; 증분ROIC_10년: number | null;
  매출총이익률_연도별: (number | null)[]; 영업이익률_연도별: (number | null)[];
  오너어닝_연도별: { 보수: (number | null)[]; 낙관: (number | null)[] };
  정규화_오너어닝: { 보수: number | null; 기본: number | null; 낙관: number | null };
  부채비율_연도별: (number | null)[]; 순부채: number | null; 순부채_EBITDA: number | null; 이자보상배율: number | null; 순부채_정규화오너어닝: number | null;
  ROE_10년평균: number | null; ROIC_10년평균: number | null;
  'ROE_ROIC_괴리_10년평균%p': number | null; '영업이익률_표준편차%p': number | null; ROIC_하락연도수: number | null;
  총액오너어닝_10년CAGR: number | null; CAGR_산출가능: boolean; 정규화오너어닝_양수: boolean;
  초과현금: number | null; 지속가능ROE: number | null;
  '희석률_10년%': number | null; 유보이익_시총증가배수: number | null;
  가치평가: { 보수: Scenario; 기본: Scenario; 낙관: Scenario };
  민감도_주당내재가치: { '할인율+1%p': number | null; '할인율-1%p': number | null; '성장률+2%p': number | null; '성장률-2%p': number | null };
  '안전마진%_기본': number | null;
  /** G9 후보값(판정 전): 요구 안전마진 25%·35% 두 경우 */
  매수검토가격_후보: { '25%': number | null; '35%': number | null };
  '오너어닝수익률%': number | null; 'PER_10년위치%': number | null; 'PBR_10년위치%': number | null;
  적자연도수: number | null; 적자연도: number[]; 위기연도_일시적: boolean | null; 이익감소_지속: boolean | null;
  검산플래그: Flag[];
}

export interface GateResult { 상태: GateStatus | '산출'; 근거: string; 등급: Grade | string; 지표?: Record<string, { 값: number | null; 구간: Band | '데이터없음' }> }

export interface Config {
  '평가기간_년': number; '최소데이터_년': number;
  일반: { G2: Record<string, BandRule>; G4: Record<string, BandRule>; G5: Record<string, BandRule> };
  금융업: { G2: Record<string, BandRule>; G4: Record<string, BandRule>; G5: Record<string, BandRule> };
  초과현금_매출비율: number; '할인율_하한%': number; '할인율_최소스프레드%p': number;
  시나리오: Record<'보수' | '기본' | '낙관', { g1_배수: number; 'g1_상한%': number; '영구성장률%': number; '할인율_가산%p': number }>;
  '요구안전마진%': { 조건부0: number; 조건부1: number };
  위기연도: number[]; 위기회복_허용년수: number; 이익감소_지속_연속년수: number;
}

const pct = (a: Num, b: Num) => { const r = safeDiv(a, b); return r === null ? null : r * 100; };
const last = <T>(a: T[]): T | undefined => a[a.length - 1];

function sortedYears(inp: BuffettInput): FinYear[] {
  const ys = [...(inp.재무_10년 || [])].sort((a, b) => a.연도 - b.연도);
  return ys.slice(-10);
}

function taxRate(y: FinYear): number | null {
  if (isNum(y.법인세비용) && isNum(y.세전이익) && y.세전이익 > 0) return clamp(y.법인세비용 / y.세전이익, 0, 0.5);
  return null;
}

/** NOPAT = 영업이익 × (1 − 실효세율). 실효세율이 없는 해는 다른 해 평균 실효세율을 쓴다. */
function nopatSeries(ys: FinYear[], flags: Flag[]): (number | null)[] {
  const rates = ys.map(taxRate);
  const avgRate = mean(rates);
  if (avgRate === null) flags.push({ 항목: 'ROIC 세율', 상태: '데이터부족', 설명: '법인세비용·세전이익이 없어 ROIC(세후)를 계산할 수 없음' });
  const sub = ys.filter((_, i) => rates[i] === null && isNum(ys[i].영업이익)).map((y) => y.연도);
  if (avgRate !== null && sub.length) flags.push({ 항목: 'ROIC 세율 대체', 상태: '데이터부족', 설명: `${sub.join(', ')}년은 실효세율이 없어 다른 해 평균 세율(${(avgRate * 100).toFixed(1)}%)을 썼음(운영 기준)` });
  return ys.map((y, i) => {
    const t = rates[i] ?? avgRate;
    if (!isNum(y.영업이익) || t === null) return null;
    return y.영업이익 * (1 - t);
  });
}

export function ownerEarnings(y: FinYear): { 보수: number | null; 낙관: number | null } {
  const ni = y.지배순이익, d = y.감가상각비, a = y.무형자산상각비 ?? 0, capex = y.자본적지출;
  if (!isNum(ni) || !isNum(d) || !isNum(capex)) return { 보수: null, 낙관: null };
  const wc = isNum(y.운전자본증감) ? Math.max(0, y.운전자본증감) : 0;
  const capexAbs = Math.abs(capex);
  const a2 = isNum(a) ? a : 0;
  // 보수: 총 CAPEX 차감 + 운전자본 증가분 차감 / 낙관: 감가상각비 수준 CAPEX(실제 CAPEX보다 크지 않게)
  const 보수 = ni + d + a2 - capexAbs - wc;
  const 낙관 = ni + d + a2 - Math.min(capexAbs, d);
  return { 보수, 낙관 };
}

/** 최근 5년 평균(일회성손익 제외). 5년 중 4년 이상 '일회성'이 반복되면 제외하지 않는다(A-4 G7). */
function normalize(series: (number | null)[], ys: FinYear[]): number | null {
  const n = Math.min(5, ys.length);
  const tail = ys.slice(-n), vals = series.slice(-n);
  const nonzeroOneoff = tail.filter((y) => isNum(y.일회성손익) && y.일회성손익 !== 0).length;
  const exclude = nonzeroOneoff < 4;
  const adj = vals.map((v, i) => (isNum(v) ? v - (exclude && isNum(tail[i].일회성손익) ? (tail[i].일회성손익 as number) : 0) : null));
  if (adj.some((v) => v === null)) return mean(adj); // 일부 결측은 있는 값으로만 평균
  return mean(adj);
}

/** 보수 시리즈 총액 CAGR: 시작 = 첫 3년 평균, 끝 = 마지막 3년 평균, 기간 = N − 3 */
export function oeCagr(series: (number | null)[]): number | null {
  const v = series.filter(isNum);
  if (v.length < 4) return null;
  const s = mean(v.slice(0, 3))!, e = mean(v.slice(-3))!;
  if (s <= 0 || e <= 0) return null;
  const periods = v.length - 3;
  return (Math.pow(e / s, 1 / periods) - 1) * 100;
}

/** 2단계 DCF. r·g·g1은 % 단위 */
export function dcfEquity(oe0: number, g1: number, r: number, g: number, excessCash: number, nonOp: number): number {
  const R = r / 100, G = g / 100, G1 = g1 / 100;
  let pv = 0, oe = oe0;
  for (let t = 1; t <= 10; t++) { oe = oe0 * Math.pow(1 + G1, t); pv += oe / Math.pow(1 + R, t); }
  const tv = (oe * (1 + G)) / (R - G) / Math.pow(1 + R, 10);
  return pv + tv + excessCash + nonOp;
}

function positionPct(series: (number | null)[], current: number | null): number | null {
  const lo = minOf(series), hi = maxOf(series);
  if (current === null || lo === null || hi === null || hi === lo) return null;
  return clamp(((current - lo) / (hi - lo)) * 100, 0, 100);
}

export function computeCalc(inp: BuffettInput, cfg: Config): Calc {
  const flags: Flag[] = [];
  const ys = sortedYears(inp);
  const N = ys.length;
  const type = inp.종목.업종유형;
  const fin = type === '은행' || type === '보험';
  const L = last(ys);

  const roe = ys.map((y) => pct(y.지배순이익, y.지배자기자본));
  const nopat = nopatSeries(ys, flags);
  const roic = ys.map((y, i) => pct(nopat[i], y.투하자본));
  const gm = ys.map((y) => pct(isNum(y.매출총이익) ? y.매출총이익 : isNum(y.매출) && isNum(y.매출원가) ? y.매출 - y.매출원가 : null, y.매출));
  const opm = ys.map((y) => pct(y.영업이익, y.매출));
  const debtRatio = ys.map((y) => pct(y.총부채, y.지배자기자본));

  // 증분 ROIC
  let incRoic: number | null = null;
  const iFirst = ys.findIndex((y, i) => isNum(y.투하자본) && isNum(nopat[i]));
  let iLast = -1; for (let i = N - 1; i >= 0; i--) if (isNum(ys[i].투하자본) && isNum(nopat[i])) { iLast = i; break; }
  if (iFirst >= 0 && iLast > iFirst) {
    const dIC = (ys[iLast].투하자본 as number) - (ys[iFirst].투하자본 as number);
    const dN = (nopat[iLast] as number) - (nopat[iFirst] as number);
    if (dIC > 0) incRoic = (dN / dIC) * 100;
    else flags.push({ 항목: '증분ROIC', 상태: '데이터부족', 설명: `투하자본 증가분이 0 이하(${dIC.toFixed(0)}) — 증분 ROIC 정의 불가` });
  }

  // ROIC 하락 연도 수
  let declines = 0, cmp = 0;
  for (let i = 1; i < N; i++) if (isNum(roic[i]) && isNum(roic[i - 1])) { cmp++; if ((roic[i] as number) < (roic[i - 1] as number)) declines++; }

  const gap = mean(ys.map((_, i) => (isNum(roe[i]) && isNum(roic[i]) ? (roe[i] as number) - (roic[i] as number) : null)));

  // 오너 어닝
  const oe = ys.map(ownerEarnings);
  const wcMissing = ys.filter((y) => !isNum(y.운전자본증감) && isNum(y.지배순이익)).map((y) => y.연도);
  if (wcMissing.length) flags.push({ 항목: '운전자본증감', 상태: '데이터부족', 설명: `${wcMissing.join(', ')}년은 운전자본증감 데이터가 없어 차감하지 않았음(보수 오너 어닝이 과대될 수 있음)` });
  if (!fin) flags.push({ 항목: "G2 '형편없는' 유형", 상태: '데이터부족', 설명: "부록 A에 정량 정의가 없어 코드가 판정하지 않음(ROIC 구간으로만 판정) — 11절 확인 항목" });
  const oeCons = oe.map((o) => o.보수), oeOpt = oe.map((o) => o.낙관);
  let nCons = normalize(oeCons, ys), nOpt = normalize(oeOpt, ys);
  const tLatest = L ? taxRate(L) ?? mean(ys.map(taxRate)) ?? 0 : 0;
  const excessCash = L && isNum(L.현금성자산) && isNum(L.매출) ? Math.max(0, L.현금성자산 - L.매출 * cfg.초과현금_매출비율) : null;
  // 초과현금을 더하므로 할인에 쓰는 정규화 오너 어닝에서 그 현금의 세후 이자수익을 뺀다(이중 계산 방지)
  if (L && excessCash !== null && excessCash > 0 && isNum(L.이자수익) && isNum(L.현금성자산) && L.현금성자산 > 0) {
    const adj = L.이자수익 * (excessCash / L.현금성자산) * (1 - tLatest);
    if (nCons !== null) nCons -= adj;
    if (nOpt !== null) nOpt -= adj;
  }
  const nBase = nCons !== null && nOpt !== null ? (nCons + nOpt) / 2 : null;
  const cagr = oeCagr(oeCons);
  const cagrOk = cagr !== null;
  const oePositive = nCons !== null && nCons > 0;
  if (!fin && !cagrOk) flags.push({ 항목: 'CAGR', 상태: '데이터부족', 설명: '총액 오너 어닝 CAGR 정의 불가(시작/끝 평균 ≤ 0 또는 4년 미만)' });
  if (!fin && !oePositive) flags.push({ 항목: '정규화 오너 어닝', 상태: '데이터부족', 설명: '정규화 오너 어닝(보수)이 0 이하 또는 결측' });

  // 부채
  const netDebt = L && isNum(L.이자부부채) && isNum(L.현금성자산) ? L.이자부부채 - L.현금성자산 : null;
  const ndEbitda = netDebt !== null && L && isNum(L.EBITDA) && L.EBITDA > 0 ? netDebt / L.EBITDA : null;
  const icr = L && isNum(L.영업이익) && isNum(L.이자비용) ? (L.이자비용 === 0 ? Infinity : L.영업이익 / Math.abs(L.이자비용)) : null;
  const ndOe = netDebt !== null && nCons !== null && nCons > 0 ? netDebt / nCons : null;

  // 지속가능 ROE (금융업)
  const roeSeries = fin && inp.업종특화?.ROE?.length ? inp.업종특화.ROE : roe;
  const sustRoe = (() => {
    const v = roeSeries.filter(isNum);
    if (v.length < 3) return null;
    const m5 = mean(v.slice(-5))!, m3 = mean(v.slice(-3))!;
    return Math.min(m5, m3);
  })();

  // 희석률·유보이익 배수(참고)
  const sh = ys.map((y) => (isNum(y.희석주식수) ? y.희석주식수 : y.보통주_유통주식수));
  const s0 = sh.find(isNum), s1 = [...sh].reverse().find(isNum);
  const dilution = isNum(s0) && isNum(s1) && s0 > 0 ? ((s1 - s0) / s0) * 100 : null;
  let retainMult: number | null = null;
  {
    const f = ys[0], l = L;
    if (f && l && isNum(f.연말시가총액) && isNum(l.연말시가총액)) {
      const netIssue = ys.reduce((a, y) => a + (isNum(y.유상증자액) ? y.유상증자액 : 0), 0);
      const retained = ys.reduce((a, y) => a + (isNum(y.지배순이익) ? y.지배순이익 - (y.배당금총액 ?? 0) - (y.자사주매입액 ?? 0) : 0), 0);
      if (retained > 0) retainMult = (l.연말시가총액 - f.연말시가총액 - netIssue) / retained;
    }
  }

  // 가치평가
  const rf = inp.시장데이터.국채10년_금리;
  const rBase = isNum(rf) ? Math.max(rf, cfg['할인율_하한%']) : null;
  if (!isNum(rf)) flags.push({ 항목: '할인율', 상태: '데이터부족', 설명: '국채 10년 금리 없음' });
  const shares = L ? (isNum(L.희석주식수) ? L.희석주식수 : L.보통주_유통주식수) : null;
  const pref = L && isNum(L.우선주_시가총액) ? L.우선주_시가총액 : 0;
  const nonOp = L && isNum(L.비영업자산) ? L.비영업자산 : 0;
  const bvps = inp.시장데이터.주당순자산;

  const scen = (k: '보수' | '기본' | '낙관'): Scenario => {
    const p = cfg.시나리오[k];
    if (rBase === null) return { 성장률: null, 할인율: null, 영구성장률: null, 자기자본가치: null, 주당내재가치: null };
    const r = rBase + p['할인율_가산%p'];
    let g = p['영구성장률%'];
    if (r < g + cfg['할인율_최소스프레드%p']) g = r - cfg['할인율_최소스프레드%p'];
    if (fin) {
      if (!isNum(bvps) || sustRoe === null) return { 성장률: null, 할인율: r, 영구성장률: null, 자기자본가치: null, 주당내재가치: null };
      return { 성장률: null, 할인율: r, 영구성장률: null, 자기자본가치: null, 주당내재가치: bvps * (sustRoe / r) };
    }
    const g1 = cagr === null ? null : clamp(cagr * p.g1_배수, 0, p['g1_상한%']);
    const oe0 = k === '보수' ? nCons : k === '기본' ? nBase : nOpt;
    if (g1 === null || oe0 === null || !oePositive || !isNum(shares) || shares <= 0) return { 성장률: g1, 할인율: r, 영구성장률: g, 자기자본가치: null, 주당내재가치: null };
    const eq = dcfEquity(oe0, g1, r, g, excessCash ?? 0, nonOp);
    return { 성장률: g1, 할인율: r, 영구성장률: g, 자기자본가치: eq, 주당내재가치: (eq - pref) / shares };
  };
  const vC = scen('보수'), vB = scen('기본'), vO = scen('낙관');

  const sens = (dr: number, dg: number): number | null => {
    if (fin) {
      if (!isNum(bvps) || sustRoe === null || vB.할인율 === null) return null;
      if (dg !== 0) return null;
      return bvps * (sustRoe / (vB.할인율 + dr));
    }
    if (vB.성장률 === null || vB.할인율 === null || vB.영구성장률 === null || nBase === null || !isNum(shares) || !oePositive) return null;
    const r = vB.할인율 + dr;
    let g = vB.영구성장률; if (r < g + cfg['할인율_최소스프레드%p']) g = r - cfg['할인율_최소스프레드%p'];
    const eq = dcfEquity(nBase, Math.max(0, vB.성장률 + dg), r, g, excessCash ?? 0, nonOp);
    return (eq - pref) / (shares as number);
  };

  const price = inp.시장데이터.주가;
  const ivB = vB.주당내재가치, ivC = vC.주당내재가치;
  const mos = isNum(price) && ivB !== null && ivB > 0 ? ((ivB - price) / ivB) * 100 : null;
  const cand = (m: number) => (ivB !== null && ivC !== null ? Math.min(ivB * (1 - m / 100), ivC) : null);

  const mcap = inp.시장데이터.보통주_시가총액;
  const oeYield = isNum(mcap) && mcap > 0 && nCons !== null ? (nCons / mcap) * 100 : null;
  const curPer = isNum(mcap) && L && isNum(L.지배순이익) && L.지배순이익 > 0 ? mcap / L.지배순이익 : null;
  const curPbr = isNum(mcap) && L && isNum(L.지배자기자본) && L.지배자기자본 > 0 ? mcap / L.지배자기자본 : null;

  // G3 정량 부분(코드가 센다)
  const deficitYears = ys.filter((y) => (isNum(y.지배순이익) && y.지배순이익 < 0) || (isNum(y.영업이익) && y.영업이익 < 0)).map((y) => y.연도);
  let crisisOk: boolean | null = null;
  for (const cy of cfg.위기연도) {
    const i = ys.findIndex((y) => y.연도 === cy);
    if (i <= 0) continue;
    const pre = ys[i - 1].지배순이익, cur = ys[i].지배순이익;
    if (!isNum(pre) || !isNum(cur)) continue;
    if (crisisOk === null) crisisOk = true;
    if (cur < pre) {
      const after = ys.slice(i + 1, i + 1 + cfg.위기회복_허용년수).map((y) => y.지배순이익);
      const recovered = after.some((v) => isNum(v) && v >= pre);
      if (!recovered) crisisOk = false;
    }
  }
  let run = 0, maxRun = 0;
  for (let i = 1; i < N; i++) {
    const a = ys[i - 1].지배순이익, b = ys[i].지배순이익;
    if (isNum(a) && isNum(b) && b < a) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }

  // 검산: 매출총이익 = 매출 − 매출원가
  for (const y of ys) {
    if (isNum(y.매출) && isNum(y.매출원가) && isNum(y.매출총이익)) {
      const d = Math.abs(y.매출 - y.매출원가 - y.매출총이익);
      if (d > Math.max(1, Math.abs(y.매출) * 0.005)) flags.push({ 항목: `매출총이익(${y.연도})`, 상태: '불일치', 설명: '매출 − 매출원가와 매출총이익이 0.5% 넘게 다름' });
    }
  }
  const miss = (k: '매출' | '영업이익' | '지배순이익') => ys.filter((y) => !isNum(y[k])).map((y) => y.연도);
  for (const k of ['매출', '영업이익', '지배순이익'] as const) { const m = miss(k); if (m.length) flags.push({ 항목: `${k} 빠진 연도`, 상태: '데이터부족', 설명: `데이터 기간 ${N}년 중 ${m.join(', ')}년의 ${k} 값이 없음` }); }
  if (N < cfg['평가기간_년']) flags.push({ 항목: '데이터 기간', 상태: '데이터부족', 설명: `데이터 기간: ${N}년(10년 미만 — 일관성 판단 신뢰도 낮음)` });

  return {
    데이터기간_년: N,
    ROE_연도별: roe, ROIC_연도별: roic, 증분ROIC_10년: incRoic,
    매출총이익률_연도별: gm, 영업이익률_연도별: opm,
    오너어닝_연도별: { 보수: oeCons, 낙관: oeOpt },
    정규화_오너어닝: { 보수: nCons, 기본: nBase, 낙관: nOpt },
    부채비율_연도별: debtRatio, 순부채: netDebt, 순부채_EBITDA: ndEbitda, 이자보상배율: icr, 순부채_정규화오너어닝: ndOe,
    ROE_10년평균: mean(roeSeries), ROIC_10년평균: mean(roic),
    'ROE_ROIC_괴리_10년평균%p': gap, '영업이익률_표준편차%p': sdPop(opm), ROIC_하락연도수: cmp ? declines : null,
    총액오너어닝_10년CAGR: cagr, CAGR_산출가능: cagrOk, 정규화오너어닝_양수: oePositive,
    초과현금: excessCash, 지속가능ROE: sustRoe,
    '희석률_10년%': dilution, 유보이익_시총증가배수: retainMult,
    가치평가: { 보수: vC, 기본: vB, 낙관: vO },
    민감도_주당내재가치: { '할인율+1%p': sens(1, 0), '할인율-1%p': sens(-1, 0), '성장률+2%p': sens(0, 2), '성장률-2%p': sens(0, -2) },
    '안전마진%_기본': mos,
    매수검토가격_후보: { '25%': cand(cfg['요구안전마진%'].조건부0), '35%': cand(cfg['요구안전마진%'].조건부1) },
    '오너어닝수익률%': oeYield,
    'PER_10년위치%': positionPct(ys.map((y) => y.PER ?? null), curPer),
    'PBR_10년위치%': positionPct(ys.map((y) => y.PBR ?? null), curPbr),
    적자연도수: N ? deficitYears.length : null, 적자연도: deficitYears,
    위기연도_일시적: crisisOk, 이익감소_지속: N >= 2 ? maxRun >= cfg.이익감소_지속_연속년수 : null,
    검산플래그: flags,
  };
}

function bandOf(v: number | null, r: BandRule): Band | '데이터없음' { return v === null ? '데이터없음' : judgeBand(v, r); }

function gateFromIndicators(ind: Record<string, { 값: number | null; 구간: Band | '데이터없음' }>, grade: Grade, missingText: string): GateResult {
  const bands = Object.values(ind).map((x) => x.구간);
  if (bands.includes('데이터없음')) return { 상태: '판단불가', 근거: missingText, 등급: grade, 지표: ind };
  const s = combineBands(bands as Band[]);
  const txt = Object.entries(ind).map(([k, v]) => `${k} ${v.값 === null ? '-' : v.값 === Infinity ? '∞' : (+v.값.toFixed(2)).toLocaleString('ko-KR')} → ${v.구간}`).join(', ');
  return { 상태: s, 근거: txt, 등급: grade, 지표: ind };
}

/** 정량 관문 G2·G4·G5 (코드가 판정). 지표별 담당 Gate는 하나(중복 감점 방지) */
export function judgeQuant(inp: BuffettInput, c: Calc, cfg: Config): { G2: GateResult; G4: GateResult; G5: GateResult } {
  const type = inp.종목.업종유형;
  const g: Grade = inp.근거등급?.재무 ?? 'A';
  const minY = cfg['최소데이터_년'];
  if (type === '은행' || type === '보험') {
    const F = cfg.금융업;
    const bk = inp.업종특화?.은행, ins = inp.업종특화?.보험;
    // G2: 단일 지표
    let G2: GateResult;
    if (type === '은행') {
      const v = mean(bk?.ROA ?? []);
      G2 = gateFromIndicators({ 은행_ROA_10년평균: { 값: v, 구간: bandOf(v, F.G2.은행_ROA_10년평균) } }, g, '은행 ROA 데이터 없음');
    } else {
      const v = mean(ins?.합산비율 ?? []);
      G2 = gateFromIndicators({ 보험_합산비율_10년평균: { 값: v, 구간: bandOf(v, F.G2.보험_합산비율_10년평균) } }, g, '합산비율 데이터 없음');
    }
    const roeAvg = c.ROE_10년평균;
    const G4 = roeAvg === null
      ? { 상태: '판단불가' as const, 근거: 'ROE 데이터 없음', 등급: g }
      : gateFromIndicators({
        ROE_10년평균: { 값: roeAvg, 구간: bandOf(roeAvg, F.G4.ROE_10년평균) },
        지속가능ROE: { 값: c.지속가능ROE, 구간: bandOf(c.지속가능ROE, F.G4.지속가능ROE) },
      }, g, '지속가능ROE 데이터 없음');
    let G5: GateResult;
    if (type === '은행') {
      const cet1 = bk?.CET1비율?.filter(isNum).slice(-1)[0] ?? null;
      const lc = mean((bk?.대손비용률 ?? []).slice(-5));
      G5 = gateFromIndicators({
        은행_CET1비율: { 값: cet1, 구간: bandOf(cet1, F.G5.은행_CET1비율) },
        은행_대손비용률_5년평균: { 값: lc, 구간: bandOf(lc, F.G5.은행_대손비용률_5년평균) },
      }, g, '은행 건전성 데이터 없음');
    } else {
      const v = ins?.지급여력비율?.filter(isNum).slice(-1)[0] ?? null;
      const key = ins?.지급여력_산출기준 === 'RBC' ? '보험_지급여력_RBC' : '보험_지급여력_KICS';
      G5 = ins?.지급여력_산출기준
        ? gateFromIndicators({ [key]: { 값: v, 구간: bandOf(v, F.G5[key]) } }, g, '지급여력비율 데이터 없음')
        : { 상태: '판단불가', 근거: '지급여력 산출기준 없음', 등급: g };
    }
    return { G2, G4, G5 };
  }

  const R = cfg.일반;
  let G2: GateResult;
  if (c.데이터기간_년 < minY) G2 = { 상태: '판단불가', 근거: `재무 데이터 ${c.데이터기간_년}년(5년 미만)`, 등급: g };
  else {
    G2 = gateFromIndicators({
      ROIC_10년평균: { 값: c.ROIC_10년평균, 구간: bandOf(c.ROIC_10년평균, R.G2.ROIC_10년평균) },
      영업이익률_표준편차: { 값: c['영업이익률_표준편차%p'], 구간: bandOf(c['영업이익률_표준편차%p'], R.G2.영업이익률_표준편차) },
      ROIC_하락연도수: { 값: c.ROIC_하락연도수, 구간: bandOf(c.ROIC_하락연도수, R.G2.ROIC_하락연도수) },
    }, g, 'ROIC·영업이익률 데이터 부족');
    // 2차 가산: A·B급 비재무 증거가 있으면 '조건부'→'통과' 한 단계만(탈락은 올리지 않음)
    const ev = (inp.비재무_해자증거 ?? []).filter((e) => e.등급 === 'A' || e.등급 === 'B');
    if (G2.상태 === '조건부' && ev.length) G2 = { ...G2, 상태: '통과', 근거: `${G2.근거} / A·B급 비재무 해자 증거 ${ev.length}건으로 1단계 상향` };
  }

  // G4
  let G4: GateResult;
  const ic = inp.재무_10년.some((y) => isNum(y.투하자본));
  if (!ic) G4 = { 상태: '판단불가', 근거: '투하자본 데이터 없음', 등급: g };
  else {
    // 투하자본 증가분 ≤ 0이면 증분 ROIC를 정의할 수 없음 → '데이터없음'(G4 판단불가). 명세에 없는 규칙을 만들지 않는다(11절 확인 항목)
    const incBand: Band | '데이터없음' = bandOf(c.증분ROIC_10년, R.G4.증분ROIC_10년);
    const note = c.증분ROIC_10년 === null && c.검산플래그.some((f) => f.항목 === '증분ROIC') ? ' (증분 ROIC 정의 불가: 투하자본 증가 없음 — 판단불가)' : '';
    G4 = gateFromIndicators({
      ROE_10년평균: { 값: c.ROE_10년평균, 구간: bandOf(c.ROE_10년평균, R.G4.ROE_10년평균) },
      증분ROIC_10년: { 값: c.증분ROIC_10년, 구간: incBand },
      ROE_ROIC_괴리: { 값: c['ROE_ROIC_괴리_10년평균%p'], 구간: bandOf(c['ROE_ROIC_괴리_10년평균%p'], R.G4.ROE_ROIC_괴리) },
    }, g, 'ROE·ROIC 데이터 부족');
    if (note) G4 = { ...G4, 근거: G4.근거 + note };
  }

  // G5 (순현금이면 순부채 비율 2개는 통과)
  const L = sortedYears(inp).slice(-1)[0];
  const hasDebt = L && (isNum(L.이자부부채) || isNum(L.총부채));
  let G5: GateResult;
  if (!hasDebt) G5 = { 상태: '판단불가', 근거: '부채 데이터 없음', 등급: g };
  else {
    const netCash = c.순부채 !== null && c.순부채 <= 0;
    const dr = c.부채비율_연도별.filter(isNum).slice(-1)[0] ?? null;
    G5 = gateFromIndicators({
      순부채_EBITDA: { 값: c.순부채_EBITDA, 구간: netCash ? '통과' : bandOf(c.순부채_EBITDA, R.G5.순부채_EBITDA) },
      이자보상배율: { 값: c.이자보상배율, 구간: bandOf(c.이자보상배율, R.G5.이자보상배율) },
      부채비율: { 값: dr, 구간: bandOf(dr, R.G5.부채비율) },
      순부채_정규화오너어닝: { 값: c.순부채_정규화오너어닝, 구간: netCash ? '통과' : bandOf(c.순부채_정규화오너어닝, R.G5.순부채_정규화오너어닝) },
    }, g, '부채 지표 데이터 부족');
    if (netCash) G5 = { ...G5, 근거: G5.근거 + ' (순현금 기업: 순부채 비율 2개 통과 처리)' };
  }
  return { G2, G4, G5 };
}

/** LLM 판정(G1·G3·G6) — 본문 M1 절 JSON 스키마 */
export interface LlmGate { 상태: GateStatus; 근거: string; 등급: string; 원인?: '일회성' | '구조적' | '해당없음' | '판단불가' }
export interface LlmJudgement { G1?: LlmGate; G3?: LlmGate; G6?: LlmGate }

const GS: GateStatus[] = ['통과', '조건부', '탈락', '판단불가'];
export function validLlmGate(x: unknown): x is LlmGate {
  return !!x && typeof x === 'object' && GS.includes((x as LlmGate).상태) && typeof (x as LlmGate).근거 === 'string';
}

/** G3 최종: 코드가 센 적자 횟수 + LLM의 일회성/구조적 구분 */
export function judgeG3(c: Calc, cfg: Config, llm?: LlmGate | null): GateResult {
  if (c.데이터기간_년 < cfg['최소데이터_년']) return { 상태: '판단불가', 근거: `데이터 ${c.데이터기간_년}년(5년 미만)`, 등급: 'A' };
  const n = c.적자연도수 ?? 0;
  if (n >= 2) return { 상태: '탈락', 근거: `적자 ${n}회(${c.적자연도.join(', ')}) — 2회 이상`, 등급: 'A' };
  if (n === 1) {
    const cause = llm?.원인;
    if (!llm || !cause || cause === '판단불가' || cause === '해당없음') return { 상태: '판단불가', 근거: `적자 1회(${c.적자연도[0]}) — 원인 판단 근거 없음`, 등급: llm?.등급 ?? 'D' };
    if (cause === '구조적') return { 상태: '탈락', 근거: `적자 1회(${c.적자연도[0]}) — 구조적 원인. ${llm.근거}`, 등급: llm.등급 };
    return { 상태: '조건부', 근거: `적자 1회(${c.적자연도[0]}) — 일회성 원인. ${llm.근거}`, 등급: llm.등급 };
  }
  if (c.위기연도_일시적 === false) return { 상태: '조건부', 근거: '적자 0회, 위기 연도 이익 감소가 회복되지 않음', 등급: 'A' };
  if (c.이익감소_지속) return { 상태: '조건부', 근거: '적자 0회, 이익 감소가 2년 넘게 이어짐', 등급: 'A' };
  return { 상태: '통과', 근거: `적자 0회${c.위기연도_일시적 === null ? '(위기 연도 데이터 없음 — 생략)' : ', 위기 연도 이익 감소 일시적'}`, 등급: 'A' };
}

export interface Decision {
  판정: FinalVerdict; 결정표_줄: number; 사유: string;
  관문: Record<'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6', GateResult> & { G7: GateResult; G8: GateResult; G9: GateResult };
  조건부_개수: number; '요구안전마진%': number | null; 주당_매수검토가격: number | null;
  확신도: '상' | '중' | '하'; 경고: string[]; 정량만: boolean;
}

/**
 * 결정표(A-5)를 위에서부터 검사해 처음 맞는 줄에서 멈춘다. G9(요구 안전마진·매수검토가격)도 여기서 확정한다.
 * llm 이 없으면 G1·G3(원인)·G6 는 판단불가로 두고 '정량 관문만 판정됨' 표시(정량만=true).
 */
export function decide(inp: BuffettInput, c: Calc, cfg: Config, llm?: LlmJudgement | null, llmReport?: string | null): Decision {
  const q = judgeQuant(inp, c, cfg);
  const warn: string[] = [];
  const noLlm = (k: string): GateResult => ({ 상태: '판단불가', 근거: `${k}: LLM 판정 전(또는 응답 형식 오류)`, 등급: 'D' });
  const G1: GateResult = llm?.G1 && validLlmGate(llm.G1) ? { 상태: llm.G1.상태, 근거: llm.G1.근거, 등급: llm.G1.등급 } : noLlm('G1');
  const G6: GateResult = llm?.G6 && validLlmGate(llm.G6) ? { 상태: llm.G6.상태, 근거: llm.G6.근거, 등급: llm.G6.등급 } : noLlm('G6');
  const g3llm = llm?.G3 && validLlmGate(llm.G3) ? llm.G3 : null;
  const G3 = judgeG3(c, cfg, g3llm);
  if (g3llm && g3llm.상태 !== G3.상태) warn.push(`LLM 판정 불일치: G3 LLM '${g3llm.상태}' / 코드 '${G3.상태}'(코드 값 사용)`);

  const fin = inp.종목.업종유형 === '은행' || inp.종목.업종유형 === '보험';
  const g8Unknown = fin ? c.가치평가.기본.주당내재가치 === null : (!c.정규화오너어닝_양수 || !c.CAGR_산출가능 || c.가치평가.기본.주당내재가치 === null);
  const G7: GateResult = { 상태: '산출', 근거: fin ? '금융업: 오너 어닝 산출 안 함' : `정규화(보수/낙관) ${fmt(c.정규화_오너어닝.보수)} / ${fmt(c.정규화_오너어닝.낙관)} ${inp.단위}, CAPEX 가정: 보수=총 CAPEX, 낙관=감가상각비 수준`, 등급: 'A(운영 기준 가정 포함)' };
  const G8: GateResult = g8Unknown
    ? { 상태: '판단불가', 근거: c.검산플래그.filter((f) => ['CAGR', '정규화 오너 어닝', '할인율'].includes(f.항목)).map((f) => f.설명).join('; ') || '내재가치 산출 불가', 등급: 'A' }
    : { 상태: '산출', 근거: `주당 ${fmt(c.가치평가.보수.주당내재가치)} ~ ${fmt(c.가치평가.기본.주당내재가치)} ${inp.종목.통화}${fin ? ' (금융업 평가법 — 정밀도 낮음)' : `, g1 ${fmt(c.가치평가.기본.성장률)}%·g ${fmt(c.가치평가.기본.영구성장률)}%·r ${fmt(c.가치평가.기본.할인율)}%`}${inp.종목.업종유형 === '지주사' ? ' / 지주사 할인·자회사 가치 합산 검토 필요' : ''}`, 등급: 'A(운영 기준 가정 포함)' };

  const gates = { G1, G2: q.G2, G3, G4: q.G4, G5: q.G5, G6 };
  const st = Object.values(gates).map((g) => g.상태);
  const conds = st.filter((s) => s === '조건부').length;
  const reqM = conds === 0 ? cfg['요구안전마진%'].조건부0 : conds === 1 ? cfg['요구안전마진%'].조건부1 : null;
  const buyPrice = reqM === null ? null : reqM === cfg['요구안전마진%'].조건부0 ? c.매수검토가격_후보['25%'] : c.매수검토가격_후보['35%'];
  const price = inp.시장데이터.주가;

  let v: FinalVerdict, line: number, why: string;
  if (G1.상태 === '탈락') { v = '제외'; line = 1; why = '능력범위 밖(G1 탈락)'; }
  else if (q.G2.상태 === '탈락' || q.G5.상태 === '탈락') { v = '제외'; line = 2; why = q.G2.상태 === '탈락' ? 'G2 해자 탈락' : 'G5 재무건전성 탈락'; }
  else if ([G3, q.G4, G6].some((g) => g.상태 === '탈락')) { v = '제외'; line = 3; why = (['G3', 'G4', 'G6'] as const).filter((k) => gates[k].상태 === '탈락').join('·') + ' 탈락'; }
  else if (st.includes('판단불가') || g8Unknown) { v = '판단 불가'; line = 4; why = '부족한 데이터: ' + [...(Object.entries(gates).filter(([, g]) => g.상태 === '판단불가').map(([k]) => k)), ...(g8Unknown ? ['G8'] : [])].join('·'); }
  else if (conds >= 2) { v = '관심 종목'; line = 5; why = `조건부 ${conds}개 — 사업 질 보완 확인 필요`; }
  else if (isNum(price) && buyPrice !== null && price <= buyPrice) { v = '매수 검토'; line = 6; why = `현재 주가 ≤ 주당 매수검토가격`; }
  else { v = '관심 종목(가격 대기)'; line = 7; why = '주당 매수검토가격 대기'; }

  const G9: GateResult = { 상태: '산출', 근거: `안전마진 ${fmt(c['안전마진%_기본'])}% vs 요구 ${reqM ?? '-'}%`, 등급: 'A(운영 기준 가정 포함)' };

  // 확신도
  const yrs = c.데이터기간_년;
  const allA = [inp.근거등급?.재무 ?? 'A', inp.근거등급?.가격 ?? 'C', inp.근거등급?.금리 ?? 'A', G1.등급, G6.등급, G3.등급].every((x) => String(x).startsWith('A'));
  let conf: '상' | '중' | '하' = conds === 0 && yrs >= 10 && allA ? '상' : conds === 1 || (yrs >= 7 && yrs <= 9) ? '중' : '하';
  if (fin && conf === '상') conf = '중';
  if (inp.종목.업종유형 === '지주사') conf = '하';

  if (llmReport) {
    const labels: FinalVerdict[] = ['매수 검토', '관심 종목(가격 대기)', '관심 종목', '제외', '판단 불가'];
    for (const line of llmReport.split('\n')) {
      if (!/판정/.test(line)) continue;
      for (const lb of labels) {
        if (line.includes(lb) && lb !== v && !(v === '관심 종목(가격 대기)' && lb === '관심 종목')) { warn.push(`LLM 판정 불일치: 본문에 '${lb}' — 코드 결정표 결과 '${v}'를 사용`); break; }
      }
    }
  }
  return {
    판정: v, 결정표_줄: line, 사유: why,
    관문: { ...gates, G7, G8, G9 }, 조건부_개수: conds, '요구안전마진%': reqM,
    주당_매수검토가격: line === 6 || line === 7 ? buyPrice : null, 확신도: conf, 경고: warn, 정량만: !llm,
  };
}

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '데이터 없음';
  return (Math.round(v * 100) / 100).toLocaleString('ko-KR');
}

/** LLM 입력 JSON: 요구안전마진%·주당_매수검토가격을 빼고 후보값 2개를 '후보값(판정 전)'으로 넘긴다(G9 순환 방지) */
export function buildLlmInput(inp: BuffettInput, c: Calc, berkshire?: unknown): Record<string, unknown> {
  const { 매수검토가격_후보, ...rest } = c;
  return {
    ...inp,
    계산값: { ...rest, '후보값(판정 전)': { '25%': 매수검토가격_후보['25%'], '35%': 매수검토가격_후보['35%'], 설명: '요구 안전마진이 25%·35%일 때의 매수검토가격 후보값. 확정은 코드가 G1~G6 조건부 개수로 한다. 본문에서 언급하지 않는다.' } },
    버크셔_참고: berkshire ?? null,
  };
}

export const LLM_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    판정: {
      type: 'object',
      properties: {
        G1: { type: 'object', properties: { 상태: { type: 'string', enum: GS }, 근거: { type: 'string' }, 등급: { type: 'string' } }, required: ['상태', '근거', '등급'] },
        G3: { type: 'object', properties: { 상태: { type: 'string', enum: GS }, 근거: { type: 'string' }, 등급: { type: 'string' }, 원인: { type: 'string', enum: ['일회성', '구조적', '해당없음', '판단불가'] } }, required: ['상태', '근거', '등급', '원인'] },
        G6: { type: 'object', properties: { 상태: { type: 'string', enum: GS }, 근거: { type: 'string' }, 등급: { type: 'string' } }, required: ['상태', '근거', '등급'] },
      },
      required: ['G1', 'G3', 'G6'],
    },
    report_md: { type: 'string' },
  },
  required: ['판정', 'report_md'],
} as const;
