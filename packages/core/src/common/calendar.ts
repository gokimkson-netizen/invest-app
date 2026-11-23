// 거래일·휴장일 캘린더 (4-2절). 기준일 = 해당 시장 현지 거래일.
import holidays from '../../../../config/holidays.json';

export type Market = 'US' | 'KR' | 'CRYPTO';

const H = holidays as unknown as Record<'US' | 'KR', { 휴장: Record<string, string> }>;

const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
export const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** 캘린더에 해당 연도 목록이 있는지 */
export function calendarCovers(year: number, market: Market): boolean {
  if (market === 'CRYPTO') return true;
  return Object.keys(H[market].휴장).some((k) => k.startsWith(String(year)));
}

export function holidayName(d: string, market: Market): string | null {
  if (market === 'CRYPTO') return null;
  return H[market].휴장[d] ?? null;
}

export function isTradingDay(d: string, market: Market): boolean {
  if (market === 'CRYPTO') return true;
  const w = dow(d);
  if (w === 0 || w === 6) return false;
  if (H[market].휴장[d]) return false;
  // 목록이 없는 과거 연도: 1월 1일만 휴장으로 본다(주말 대체는 미반영) — 상장 첫해 판정에만 쓰임
  if (!calendarCovers(+d.slice(0, 4), market) && d.slice(5) === '01-01') return false;
  return true;
}

export function firstTradingDayOfYear(year: number, market: Market): string {
  let d = `${year}-01-01`;
  for (let i = 0; i < 15; i++) { if (isTradingDay(d, market)) return d; d = addDays(d, 1); }
  return `${year}-01-02`;
}

export function lastTradingDayOnOrBefore(d: string, market: Market): string {
  for (let i = 0; i < 20; i++) { if (isTradingDay(d, market)) return d; d = addDays(d, -1); }
  return d;
}

/** (a, b] 구간의 거래일 수 */
export function tradingDaysBetween(a: string, b: string, market: Market): number {
  if (b <= a) return 0;
  let n = 0, d = addDays(a, 1);
  for (let i = 0; i < 4000 && d <= b; i++) { if (isTradingDay(d, market)) n++; d = addDays(d, 1); }
  return n;
}

/** 현지 날짜(YYYY-MM-DD). 미국은 뉴욕, 한국은 서울 시간대 */
export function localDate(now: Date, market: Market): string {
  const tz = market === 'US' ? 'America/New_York' : market === 'KR' ? 'Asia/Seoul' : 'UTC';
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

/** 마지막 기준일이 2거래일 넘게 지났으면 true (4-2절 '데이터가 오래되면 경고') */
export function isStale(lastBase: string | null | undefined, now: Date, market: Market): boolean {
  if (!lastBase) return true;
  const today = localDate(now, market);
  const expected = lastTradingDayOnOrBefore(today, market);
  return tradingDaysBetween(lastBase, expected, market) > 2;
}

export interface MarketDayStatus { 날짜: string; 휴장: boolean; 사유: string | null }
export function marketDayStatus(now: Date, market: Market): MarketDayStatus {
  const d = localDate(now, market);
  const w = dow(d);
  if (market !== 'CRYPTO' && (w === 0 || w === 6)) return { 날짜: d, 휴장: true, 사유: '주말' };
  const h = holidayName(d, market);
  return { 날짜: d, 휴장: !!h, 사유: h };
}
