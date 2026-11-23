// 부록 A-3 `버크셔_참고` 코드 산출 규칙. 판정·내재가치·확신도에는 쓰지 않는다(A-2 규칙 8).
import type { Bar } from '../mdd/mdd';

export interface InfoRow { nameOfIssuer: string; titleOfClass: string; cusip: string; value: number; sshPrnamt: number; sshPrnamtType?: string; putCall?: string | null }
export interface Filing13F { period: string; filed: string; accession: string; confidential: boolean; rows: InfoRow[] }
export interface Form4 { 제출일: string; 양식: string; 거래일: string; 주식수: number; 가격: number | null; 출처: string; ticker?: string }

export interface BerkshireRef {
  보유여부: boolean | null; 확인불가_사유: '비밀취급' | '13F대상아님' | null;
  '13F_기준일': string | null; '13F_제출일': string | null; '13F_접수번호': string | null; 비밀취급_표시: boolean;
  보유주식수: number | null; 직전분기_보유주식수: number | null; 주식수_변화: number | null; 변화구분: '신규' | '증가' | '감소' | '유지' | '전량매도' | null;
  '13F_평가액': number | null; '13F_포트폴리오비중%': number | null;
  현재추정평가액: number | null; 현재추정평가액_기준일: string | null;
  추정매수가범위: { 하단: number; 상단: number; 대상분기: string } | null;
  최근내부자공시: Form4[]; 출처: 'SEC EDGAR'; 매핑등급: 'A' | 'C';
}

/** CUSIP별 모든 줄 합산(자회사 등 매니저별 분할 기재 합산). 옵션(putCall) 줄은 제외 */
export function aggregate(rows: InfoRow[]): Map<string, { shares: number; value: number; name: string; cls: string }> {
  const m = new Map<string, { shares: number; value: number; name: string; cls: string }>();
  for (const r of rows) {
    if (r.putCall) continue;
    if (r.sshPrnamtType && r.sshPrnamtType !== 'SH') continue;
    const k = r.cusip.toUpperCase();
    const p = m.get(k) ?? { shares: 0, value: 0, name: r.nameOfIssuer, cls: r.titleOfClass };
    p.shares += r.sshPrnamt; p.value += r.value;
    m.set(k, p);
  }
  return m;
}

export function quarterOf(period: string): string { const m = +period.slice(5, 7); return `${period.slice(0, 4)}Q${Math.ceil(m / 3)}`; }
function quarterStart(period: string): string { const y = period.slice(0, 4), q = Math.ceil(+period.slice(5, 7) / 3); return `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`; }

export function berkshireFor(
  /** quarterBars: 전체 가격 봉을 넘기면 13F 기준 분기(분기 첫날~기준일)만 골라 쓴다(배치·즉시 분석 공통) */
  opt: { cusips: string[]; usListed: boolean; cur: Filing13F | null; prev: Filing13F | null; lastClose?: { d: string; c: number } | null; splitFactor?: number; quarterBars?: Bar[]; form4?: Form4[]; mappingGrade?: 'A' | 'C' },
): BerkshireRef {
  const base: BerkshireRef = {
    보유여부: null, 확인불가_사유: null, '13F_기준일': opt.cur?.period ?? null, '13F_제출일': opt.cur?.filed ?? null, '13F_접수번호': opt.cur?.accession ?? null,
    비밀취급_표시: !!opt.cur?.confidential, 보유주식수: null, 직전분기_보유주식수: null, 주식수_변화: null, 변화구분: null,
    '13F_평가액': null, '13F_포트폴리오비중%': null, 현재추정평가액: null, 현재추정평가액_기준일: null, 추정매수가범위: null,
    최근내부자공시: opt.form4 ?? [], 출처: 'SEC EDGAR', 매핑등급: opt.mappingGrade ?? 'C',
  };
  if (!opt.usListed) return { ...base, 보유여부: null, 확인불가_사유: '13F대상아님' };
  if (!opt.cur) return base;
  const cur = aggregate(opt.cur.rows), prev = opt.prev ? aggregate(opt.prev.rows) : new Map();
  const total = [...cur.values()].reduce((a, b) => a + b.value, 0);
  const keys = opt.cusips.map((c) => c.toUpperCase());
  const hold = keys.map((k) => cur.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
  const prevShares = keys.map((k) => prev.get(k)?.shares ?? 0).reduce((a, b) => a + b, 0);
  if (!hold.length) {
    const sold = prevShares > 0;
    if (opt.cur.confidential) return { ...base, 보유여부: null, 확인불가_사유: '비밀취급', 직전분기_보유주식수: prevShares || null };
    return { ...base, 보유여부: false, 직전분기_보유주식수: prevShares || null, 보유주식수: 0, 주식수_변화: sold ? -prevShares : null, 변화구분: sold ? '전량매도' : null };
  }
  const shares = hold.reduce((a, b) => a + b.shares, 0);
  const value = hold.reduce((a, b) => a + b.value, 0);
  const diff = shares - prevShares;
  const kind = prevShares === 0 ? '신규' : diff > 0 ? '증가' : diff < 0 ? '감소' : '유지';
  const sf = opt.splitFactor ?? 1;
  let range: BerkshireRef['추정매수가범위'] = null;
  if (diff > 0 && opt.quarterBars?.length) {
    const qs = quarterStart(opt.cur.period);
    const qb = opt.quarterBars.filter((b) => b.d >= qs && b.d <= opt.cur!.period);
    if (qb.length) range = { 하단: Math.min(...qb.map((b) => b.l ?? b.c)), 상단: Math.max(...qb.map((b) => b.h ?? b.c)), 대상분기: quarterOf(opt.cur.period) };
  }
  return {
    ...base, 보유여부: true, 보유주식수: shares, 직전분기_보유주식수: prevShares, 주식수_변화: diff, 변화구분: kind,
    '13F_평가액': value, '13F_포트폴리오비중%': total ? (value / total) * 100 : null,
    현재추정평가액: opt.lastClose ? shares * sf * opt.lastClose.c : null, 현재추정평가액_기준일: opt.lastClose?.d ?? null,
    추정매수가범위: range,
  };
}
