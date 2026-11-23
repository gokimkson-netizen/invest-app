// M3 MDD 투자참고 — 통계 정의는 docs/mdd-definitions.md (수식)와 1:1 대응한다.
// "과거 통계이며 매수·매도 신호가 아닙니다."
import { mean, median, isNum } from '../common/util';
import { firstTradingDayOfYear, Market } from '../common/calendar';

export interface Bar { d: string; c: number; h?: number; l?: number; v?: number }

export interface YearStat {
  연도: number; 기준일: string; 기준가: number; 완결: boolean; 사유?: string;
  '상승률%': number; '낙폭%': number; 'MDD%': number; '수익률%': number;
  MDD_고점일: string; MDD_저점일: string;
}

export interface MddSummary {
  시작일: string | null; 종료일: string | null; 표본연수: number;
  '평균상승률%': number | null; '평균낙폭%': number | null; '평균MDD%': number | null; '평균수익률%': number | null;
  '중앙값MDD%': number | null; '최악MDD%': number | null; '상승연도비율%': number | null;
  연도별: YearStat[];
  빈도표: { 구간: string; 하한: number; 상한: number; 횟수: number; '비율%': number }[];
}

export type PeakWindow = '52w' | '3y' | '5y' | '10y' | 'ytd' | 'all' | { start: string };

export interface CurrentDD {
  기준일: string; 현재가: number; 고점: number; 고점일: string; '고점대비하락률%': number;
  '역대일별낙폭_백분위%': number | null; 최장수중일수: number;
}

const yr = (d: string) => +d.slice(0, 4);

/** 연간 기준일: 주식 = 시장별 매년 첫 거래일(D4), BTC = 1월 2일(2절) */
export function baseDateOf(year: number, market: Market): string {
  if (market === 'CRYPTO') return `${year}-01-02`;
  return firstTradingDayOfYear(year, market);
}

export function yearStats(bars: Bar[], market: Market): YearStat[] {
  if (!bars.length) return [];
  const out: YearStat[] = [];
  const y0 = yr(bars[0].d), y1 = yr(bars[bars.length - 1].d);
  // 연도별 기준일 인덱스(기준일 당일 또는 그 이후 첫 봉)
  const baseIdx = new Map<number, number>();
  const baseOk = new Map<number, boolean>();
  for (let y = y0; y <= y1; y++) {
    const bd = baseDateOf(y, market);
    const i = bars.findIndex((b) => b.d >= bd && yr(b.d) === y);
    if (i >= 0) { baseIdx.set(y, i); baseOk.set(y, y > y0 || bars[i].d === bd); }
  }
  for (let y = y0; y <= y1; y++) {
    const i = baseIdx.get(y);
    if (i === undefined) continue;
    const next = baseIdx.get(y + 1);
    const end = next === undefined ? bars.length - 1 : next - 1;
    if (end < i) continue;
    const cb = bars[i].c;
    let hi = cb, lo = cb, peak = cb, peakD = bars[i].d, mdd = 0, mddPeakD = bars[i].d, mddTroughD = bars[i].d;
    for (let k = i; k <= end; k++) {
      const c = bars[k].c;
      if (c > hi) hi = c;
      if (c < lo) lo = c;
      if (c > peak) { peak = c; peakD = bars[k].d; }
      const dd = c / peak - 1;
      if (dd < mdd) { mdd = dd; mddPeakD = peakD; mddTroughD = bars[k].d; }
    }
    const complete = next !== undefined && baseOk.get(y) === true;
    out.push({
      연도: y, 기준일: bars[i].d, 기준가: cb, 완결: complete,
      사유: complete ? undefined : baseOk.get(y) !== true ? '기준일 데이터 없음(상장 연도 등)' : '진행 중인 연도',
      '상승률%': (hi / cb - 1) * 100, '낙폭%': (lo / cb - 1) * 100, 'MDD%': mdd * 100, '수익률%': (bars[end].c / cb - 1) * 100,
      MDD_고점일: mddPeakD, MDD_저점일: mddTroughD,
    });
  }
  return out;
}

/** 연중 MDD 구간 경계(낙폭 크기 %). 사용자 기존 엑셀의 구간을 따른다: 5% 이하, 5~10, 10~15, 15~25, 25~35, 35~50, 50~60, 60~70, 70~80, 80% 이상 */
export const DEFAULT_BINS = [5, 10, 15, 25, 35, 50, 60, 70, 80];

/** 연중 MDD 구간별 빈도표. 낙폭 크기 m = −MDD%. 첫 구간 0 ≤ m ≤ 5, 그다음 (하한, 상한] (예: 정확히 10%는 "5% ~ 10%"), 마지막 m > 80 */
export function frequencyTable(stats: YearStat[], bins = DEFAULT_BINS) {
  const done = stats.filter((s) => s.완결);
  const mags = done.map((s) => -s['MDD%']);
  const eps = 1e-9;
  const rows = [] as MddSummary['빈도표'];
  const push = (label: string, lo: number, hi: number, test: (m: number) => boolean) => {
    const n = mags.filter(test).length;
    rows.push({ 구간: label, 하한: -hi, 상한: -lo, 횟수: n, '비율%': done.length ? (n / done.length) * 100 : 0 });
  };
  push(`${bins[0]}% 이하`, 0, bins[0], (m) => m <= bins[0] + eps);
  for (let i = 1; i < bins.length; i++) { const lo = bins[i - 1], hi = bins[i]; push(`${lo}% ~ ${hi}%`, lo, hi, (m) => m > lo + eps && m <= hi + eps); }
  const last = bins[bins.length - 1];
  push(`${last}% 이상`, last, 100, (m) => m > last + eps);
  return rows;
}

export function summarize(bars: Bar[], market: Market, bins = DEFAULT_BINS): MddSummary {
  const st = yearStats(bars, market);
  const done = st.filter((s) => s.완결);
  return {
    시작일: bars[0]?.d ?? null, 종료일: bars[bars.length - 1]?.d ?? null, 표본연수: done.length,
    '평균상승률%': mean(done.map((s) => s['상승률%'])),
    '평균낙폭%': mean(done.map((s) => s['낙폭%'])),
    '평균MDD%': mean(done.map((s) => s['MDD%'])),
    '평균수익률%': mean(done.map((s) => s['수익률%'])),
    '중앙값MDD%': median(done.map((s) => s['MDD%'])),
    '최악MDD%': done.length ? Math.min(...done.map((s) => s['MDD%'])) : null,
    '상승연도비율%': done.length ? (done.filter((s) => s['수익률%'] > 0).length / done.length) * 100 : null,
    연도별: st,
    빈도표: frequencyTable(st, bins),
  };
}

function windowStart(bars: Bar[], w: PeakWindow): string {
  const lastD = bars[bars.length - 1].d;
  const back = (years: number) => { const dt = new Date(lastD + 'T00:00:00Z'); dt.setUTCFullYear(dt.getUTCFullYear() - years); return dt.toISOString().slice(0, 10); };
  if (typeof w === 'object') return w.start;
  switch (w) {
    case '52w': { const dt = new Date(lastD + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - 364); return dt.toISOString().slice(0, 10); }
    case '3y': return back(3);
    case '5y': return back(5);
    case '10y': return back(10);
    case 'ytd': return lastD.slice(0, 4) + '-01-01';
    default: return '0000-00-00';
  }
}

/** 일별 낙폭 시계열(전체 기간 누적 고점 기준) */
export function drawdownSeries(bars: Bar[]): { d: string; dd: number }[] {
  let peak = -Infinity;
  return bars.map((b) => { peak = Math.max(peak, b.c); return { d: b.d, dd: (b.c / peak - 1) * 100 }; });
}

export function currentDrawdown(bars: Bar[], w: PeakWindow): CurrentDD | null {
  if (!bars.length) return null;
  const s = windowStart(bars, w);
  const win = bars.filter((b) => b.d >= s);
  if (!win.length) return null;
  let peak = win[0];
  for (const b of win) if (b.c > peak.c) peak = b;
  const lastB = bars[bars.length - 1];
  const dds = drawdownSeries(bars);
  const cur = dds[dds.length - 1].dd;
  const pctRank = dds.length ? (dds.filter((x) => x.dd <= cur).length / dds.length) * 100 : null;
  let longest = 0, run = 0;
  for (const x of dds) { if (x.dd < 0) { run++; longest = Math.max(longest, run); } else run = 0; }
  return {
    기준일: lastB.d, 현재가: lastB.c, 고점: peak.c, 고점일: peak.d, '고점대비하락률%': (lastB.c / peak.c - 1) * 100,
    '역대일별낙폭_백분위%': pctRank, 최장수중일수: longest,
  };
}

// ───────────────── 백테스트 ─────────────────
export interface BacktestParams {
  진입낙폭: number;           // 예: -30 (누적 고점 대비 -30% 이하이면 진입)
  청산: { 종류: '전고점회복' } | { 종류: '목표수익'; 목표: number };
  손절?: number | null;       // 예: -20 (진입가 대비)
  수수료bp: number;           // 편도 수수료(bp)
  세율?: number | null;       // 실현이익 세율(%) — null이면 '세금 미반영'
  환율?: Bar[] | null;        // 원화 환산 시 USD/KRW 일별(같은 날짜 없으면 직전 값)
  시작일?: string; 종료일?: string;
}
export interface Trade { 진입일: string; 진입가: number; 청산일: string | null; 청산가: number | null; '수익률%': number | null; 사유: string }
export interface BacktestResult {
  거래: Trade[]; '누적수익률%': number; '연환산%': number | null; '전략MDD%': number;
  '단순보유_누적%': number; '단순보유_MDD%': number; '투자기간비율%': number; 세금반영: boolean; 환산: boolean;
}

function fxAt(fx: Bar[] | null | undefined, d: string): number | null {
  if (!fx || !fx.length) return null;
  let lo = 0, hi = fx.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (fx[m].d <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? fx[ans].c : null;
}

export function backtest(barsIn: Bar[], p: BacktestParams): BacktestResult {
  let bars = barsIn.filter((b) => (!p.시작일 || b.d >= p.시작일) && (!p.종료일 || b.d <= p.종료일));
  const conv = !!(p.환율 && p.환율.length);
  if (conv) bars = bars.map((b) => { const r = fxAt(p.환율, b.d); return r ? { d: b.d, c: b.c * r } : null; }).filter((x): x is Bar => !!x);
  const fee = p.수수료bp / 10000;
  const tax = isNum(p.세율) ? p.세율 / 100 : null;
  let equity = 1, peakEq = 1, mddEq = 0, inPos = false, entry: Bar | null = null, entryPeak = 0, units = 0, cash = 1, daysIn = 0;
  let peak = -Infinity;
  const trades: Trade[] = [];
  for (const b of bars) {
    peak = Math.max(peak, b.c);
    const dd = (b.c / peak - 1) * 100;
    if (!inPos && dd <= p.진입낙폭) {
      inPos = true; entry = b; entryPeak = peak; units = (cash * (1 - fee)) / b.c; cash = 0;
    } else if (inPos && entry) {
      const ret = (b.c / entry.c - 1) * 100;
      let reason = '';
      if (p.청산.종류 === '전고점회복' && b.c >= entryPeak) reason = '전고점 회복';
      else if (p.청산.종류 === '목표수익' && ret >= p.청산.목표) reason = `목표 +${p.청산.목표}%`;
      else if (isNum(p.손절) && ret <= p.손절) reason = `손절 ${p.손절}%`;
      if (reason) {
        let proceeds = units * b.c * (1 - fee);
        const cost = units * entry.c;
        if (tax !== null && proceeds > cost) proceeds -= (proceeds - cost) * tax;
        trades.push({ 진입일: entry.d, 진입가: entry.c, 청산일: b.d, 청산가: b.c, '수익률%': (proceeds / (cost / (1 - fee)) - 1) * 100, 사유: reason });
        cash = proceeds; units = 0; inPos = false; entry = null;
      }
    }
    if (inPos) daysIn++;
    equity = cash + units * b.c;
    peakEq = Math.max(peakEq, equity);
    mddEq = Math.min(mddEq, equity / peakEq - 1);
  }
  if (inPos && entry) trades.push({ 진입일: entry.d, 진입가: entry.c, 청산일: null, 청산가: null, '수익률%': null, 사유: '보유 중(평가)' });
  const years = bars.length > 1 ? (Date.parse(bars[bars.length - 1].d) - Date.parse(bars[0].d)) / (365.25 * 864e5) : 0;
  let bhPeak = -Infinity, bhMdd = 0;
  for (const b of bars) { bhPeak = Math.max(bhPeak, b.c); bhMdd = Math.min(bhMdd, b.c / bhPeak - 1); }
  return {
    거래: trades,
    '누적수익률%': (equity - 1) * 100,
    '연환산%': years > 0 && equity > 0 ? (Math.pow(equity, 1 / years) - 1) * 100 : null,
    '전략MDD%': mddEq * 100,
    '단순보유_누적%': bars.length ? (bars[bars.length - 1].c / bars[0].c - 1) * 100 : 0,
    '단순보유_MDD%': bhMdd * 100,
    '투자기간비율%': bars.length ? (daysIn / bars.length) * 100 : 0,
    세금반영: tax !== null, 환산: conv,
  };
}

/** 유니버스 스캔: 현재 낙폭 큰 순 정렬 */
export function rankByDrawdown<T extends { 현재낙폭?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.현재낙폭 ?? Infinity) - (b.현재낙폭 ?? Infinity));
}
