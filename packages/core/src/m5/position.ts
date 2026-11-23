// M5 SOXL 낙폭 매수 연구 — 포지션 현황과 100% 검사(D2: M5 자금만 따로 계산, M4 원금 합산 안 함)
export interface Buy { 일자: string; 가격: number; 수량: number; 메모?: string }
export interface M5Input { 총자산: number; 매수내역: Buy[]; 대기자산?: number | null; 현재가?: number | null; 전고점?: number | null }
export interface M5Status {
  총매수금: number; '투입비율%': number | null; 평단: number | null; 보유수량: number; 평가금액: number | null; 평가손익: number | null; '평가손익률%': number | null;
  '전고점대비낙폭%': number | null; 대기자산: number | null; '총합비율%': number | null; 경고: string[];
}

export function m5Status(i: M5Input): M5Status {
  const warn: string[] = [];
  const qty = i.매수내역.reduce((a, b) => a + b.수량, 0);
  const cost = i.매수내역.reduce((a, b) => a + b.수량 * b.가격, 0);
  const avg = qty > 0 ? cost / qty : null;
  const val = i.현재가 != null && qty > 0 ? qty * i.현재가 : null;
  const pnl = val !== null ? val - cost : null;
  const ratio = i.총자산 > 0 ? (cost / i.총자산) * 100 : null;
  if (!(i.총자산 > 0)) warn.push('M5 총자산을 입력하세요');
  if (ratio !== null && ratio > 100 + 1e-9) warn.push(`M5 총 매수금액이 M5 총자산의 100%를 넘었습니다(${ratio.toFixed(2)}%)`);
  const wait = i.대기자산 ?? null;
  const total = wait !== null && i.총자산 > 0 ? ((cost + wait) / i.총자산) * 100 : null;
  if (total !== null && Math.abs(total - 100) > 0.5) warn.push(`매수금액 + 대기자산이 총자산과 다릅니다(${total.toFixed(2)}%)`);
  return {
    총매수금: cost, '투입비율%': ratio, 평단: avg, 보유수량: qty, 평가금액: val, 평가손익: pnl,
    '평가손익률%': pnl !== null && cost > 0 ? (pnl / cost) * 100 : null,
    '전고점대비낙폭%': i.현재가 != null && i.전고점 ? (i.현재가 / i.전고점 - 1) * 100 : null,
    대기자산: wait, '총합비율%': total, 경고: warn,
  };
}

/** 운용 규칙표(확정 전에는 '규칙 미확정'). 필드는 2절·5절 M5에 명시된 항목만. */
export interface M5Rules {
  확정: boolean;
  분할매수: { 'SOXX낙폭이하%': number; 매수금액: number }[];
  매도구간: { 조건: string; '매도비율%': number }[];
  손절?: { 조건: string } | null;
  '대기자산비율%'?: number | null;
}
/** 규칙 파일 검사: 정해진 필드·형식만 허용(규칙 값을 지어내거나 기본값을 채우지 않는다). 오류가 있으면 받아들이지 않는다 */
export function validateM5Rules(x: unknown): { rules: M5Rules; errors: [] } | { rules: null; errors: string[] } {
  const e: string[] = [];
  const o = x as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { rules: null, errors: ['JSON 객체가 아닙니다'] };
  const allowed = new Set(['확정', '분할매수', '매도구간', '손절', '대기자산비율%']);
  for (const k of Object.keys(o)) if (!allowed.has(k)) e.push(`알 수 없는 항목: ${k}`);
  if (typeof o.확정 !== 'boolean') e.push('확정: true/false 필요');
  if (!Array.isArray(o.분할매수) || !o.분할매수.length) e.push('분할매수: 1개 이상 필요');
  else (o.분할매수 as unknown[]).forEach((b, i) => {
    const r = b as Record<string, unknown>;
    if (!r || !num(r['SOXX낙폭이하%']) || (r['SOXX낙폭이하%'] as number) > 0 || (r['SOXX낙폭이하%'] as number) < -100) e.push(`분할매수[${i}].SOXX낙폭이하%: -100~0 숫자 필요`);
    if (!r || !num(r.매수금액) || (r.매수금액 as number) <= 0) e.push(`분할매수[${i}].매수금액: 0보다 큰 숫자 필요`);
    if (r) for (const k of Object.keys(r)) if (k !== 'SOXX낙폭이하%' && k !== '매수금액') e.push(`분할매수[${i}]: 알 수 없는 항목 ${k}`);
  });
  if (!Array.isArray(o.매도구간)) e.push('매도구간: 배열 필요(없으면 [])');
  else (o.매도구간 as unknown[]).forEach((b, i) => {
    const r = b as Record<string, unknown>;
    if (!r || typeof r.조건 !== 'string' || !r.조건.trim()) e.push(`매도구간[${i}].조건: 글자 필요`);
    if (!r || !num(r['매도비율%']) || (r['매도비율%'] as number) <= 0 || (r['매도비율%'] as number) > 100) e.push(`매도구간[${i}].매도비율%: 0 초과 100 이하`);
  });
  if (o.손절 != null && (typeof o.손절 !== 'object' || typeof (o.손절 as Record<string, unknown>).조건 !== 'string')) e.push('손절: { "조건": "글자" } 또는 null');
  if (o['대기자산비율%'] != null && (!num(o['대기자산비율%']) || (o['대기자산비율%'] as number) < 0 || (o['대기자산비율%'] as number) > 100)) e.push('대기자산비율%: 0~100 숫자 또는 null');
  return e.length ? { rules: null, errors: e } : { rules: o as unknown as M5Rules, errors: [] };
}

/** 오늘 해당 구간: 조건에 맞는 구간을 **모두** 보여준다(어느 것을 고를지는 규칙에 없으므로 고르지 않음). 확정 전에는 '참고'로 표시 */
export function todayBand(rules: M5Rules | null, soxxDD: number | null): { 상태: string; 구간: M5Rules['분할매수'] } {
  if (!rules) return { 상태: '규칙 미입력', 구간: [] };
  const pre = rules.확정 ? '' : '규칙 미확정(참고) — ';
  if (soxxDD === null) return { 상태: pre + 'SOXX 낙폭 데이터 없음', 구간: [] };
  const hits = rules.분할매수.filter((b) => soxxDD <= b['SOXX낙폭이하%']).sort((a, b) => b['SOXX낙폭이하%'] - a['SOXX낙폭이하%']);
  return { 상태: pre + (hits.length ? `조건에 맞는 구간 ${hits.length}개` : '해당 구간 없음'), 구간: hits };
}
