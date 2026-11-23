// 공용 수치 유틸 — 모든 계산은 코드가 한다(4-3절). 외부 의존성 없음(배치 Node·브라우저 공용).

export type Num = number | null | undefined;

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function mean(xs: Num[]): number | null {
  const v = xs.filter(isNum);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** 모표준편차(population). 값이 2개 미만이면 null */
export function sdPop(xs: Num[]): number | null {
  const v = xs.filter(isNum);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

export function median(xs: Num[]): number | null {
  const v = xs.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}

export function minOf(xs: Num[]): number | null {
  const v = xs.filter(isNum);
  return v.length ? Math.min(...v) : null;
}
export function maxOf(xs: Num[]): number | null {
  const v = xs.filter(isNum);
  return v.length ? Math.max(...v) : null;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function safeDiv(a: Num, b: Num): number | null {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

export type Band = '통과' | '조건부' | '탈락';

/**
 * 구간 판정. A-7-1 구간 경계 규칙:
 *  - 통과 기준과 같으면 '통과'
 *  - 조건부와 탈락의 경계값과 같으면 '조건부' (조건부 구간은 반열린 구간)
 *  dir=higher: 통과 v>=pass, 조건부 cond<=v<pass, 탈락 v<cond
 *  dir=lower : 통과 v<=pass, 조건부 pass<v<=cond, 탈락 v>cond
 */
export interface BandRule { dir: 'higher' | 'lower'; pass: number; cond: number }

export function judgeBand(v: number, r: BandRule): Band {
  if (r.dir === 'higher') {
    if (v >= r.pass) return '통과';
    if (v >= r.cond) return '조건부';
    return '탈락';
  }
  if (v <= r.pass) return '통과';
  if (v <= r.cond) return '조건부';
  return '탈락';
}

/** 여러 지표 구간을 합친다: 탈락 1개 이상 → 탈락, 조건부 1개 이상 → 조건부, 그 외 통과 */
export function combineBands(bs: Band[]): Band {
  if (bs.includes('탈락')) return '탈락';
  if (bs.includes('조건부')) return '조건부';
  return '통과';
}

/** 상대 오차 비교(테스트·검산용) */
export function relClose(a: number, b: number, tol = 1e-9): boolean {
  if (a === b) return true;
  const d = Math.abs(a - b);
  return d <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
