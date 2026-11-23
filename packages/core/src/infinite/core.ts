// M4 무한매수법 계산 엔진(Core) — 계산 로직만 공개(D1). 규칙 '값'(비율·기울기·분모·한도 등)은
// private/ 규칙 파일과 각 기기 IndexedDB(암호화 동기화)에만 있다. 이 파일·주석·테스트에는 규칙 값을 적지 않는다.
// 규칙 창작 금지: 아래 REGISTRY의 종류·필드는 사용자 문서 대응표(private/infinite-v4-mapping.md)에서 확인된 것만 둔다.
// 규칙 파일이 없거나 필요한 종류가 빠지면 계산하지 않는다(기본값 없음).

export const SPLITS = 40; // 2절 확정: 40분할
export type Symbol = 'TQQQ' | 'SOXL';

export interface RuleEntry { 규칙ID: string; 문서쪽번호: string | number; 종류: string; [field: string]: unknown }
export interface RuleFile { 버전: string; 작성일: string; /** 옮겨 온 원본 문서와 그 SHA-256(판 확인용) */ 원본문서?: string; 원본해시?: string; DUMMY?: boolean; 규칙: RuleEntry[] }

/** 체결 1건. 역할은 계획 주문의 역할(어느 주문이 체결됐는지)로, 회차(T) 갱신에 쓴다 */
export type Role = 'first' | 'buy_star' | 'buy_avg' | 'ladder' | 'sell_quarter' | 'sell_target' | 'rev_sell_moc' | 'rev_sell' | 'rev_buy' | 'manual';
export interface Fill { 일자: string; 구분: '매수' | '매도'; 수량: number; 가격: number; 역할?: Role; 메모?: string }
export type Mode = '일반' | '리버스';
export interface PositionState {
  종목: Symbol; 원금: number; 분할수: number;
  /** 회차 T(소수 허용) */ 회차: number;
  /** 보유분 매수원가 합(= 평단 × 보유수량) */ 누적매수금: number;
  보유수량: number; 잔금: number; 모드: Mode; 리버스일차: number; 사이클: number; 체결: Fill[];
}
export type OrderType = 'LOC' | 'MOC' | '지정가';
export interface Order { 종류: string; 역할: Role; 구분: '매수' | '매도'; 주문유형: OrderType; 가격: number | null; 수량: number; 규칙ID: string }
export interface PlanInfo { 구간: '첫 매수' | '전반전' | '후반전' | '리버스' | '리버스 종료(일반 복귀)'; 회차: number; '1회매수금': number | null; '별%': number | null; 별지점: number | null; 매수점: number | null; 평단: number | null; 잔금: number; 리버스일차: number | null; 참고: string[] }
export interface PlanResult { 상태: '정상' | '규칙 미입력' | '규칙 오류' | 'DUMMY 차단' | '입력 필요' | '가격 데이터 부족'; 메시지: string; 주문: Order[]; 정보?: PlanInfo }
export interface MarketInput { 기준일: string; 전일종가: number | null; /** 최근 종가(오래된 → 최신). 리버스 모드 별지점 계산에 쓴다 */ 최근종가?: number[] }
/** 사용자가 이 기기에서 고르는 값(문서가 범위만 주거나 개수를 정하지 않은 항목) */
export interface UserOptions { '첫매수할증%'?: number | null; 사다리개수?: number | null }

type FieldType = 'number' | 'string';
type Handler = { 필드: Record<string, FieldType>; 종목별?: boolean; 분할수별?: boolean; dummyOnly?: boolean };

/** 규칙 종류 등록부(구조만 — 값은 규칙 파일에) */
export const REGISTRY: Record<string, Handler> = {
  BUY_AMOUNT: { 필드: {} }, // 1회매수금 = 잔금 ÷ (분할수 − T)
  STAR_LINEAR: { 필드: { 종목: 'string', 분할수: 'number', 시작값: 'number', 기울기: 'number' }, 종목별: true, 분할수별: true }, // 별% = 시작값 − 기울기 × T
  STAR_POINT: { 필드: { 자릿수: 'number' } }, // 별지점 = 평단 × (1 + 별%), 반올림
  BUY_OFFSET: { 필드: { 값: 'number' } }, // 매수점 = 별지점 − 값
  FIRST_BUY: { 필드: { '할증최소%': 'number', '할증최대%': 'number' } }, // 첫 매수: 전일 종가 × (1 + 할증) LOC, 할증은 범위 안에서 사용자가 고름
  PHASE: { 필드: { 경계비율: 'number', 전반전분할비율: 'number' } }, // 전반전: T < 분할수 × 경계비율, 1회매수금을 비율로 나눠 별지점·평단에
  LADDER: { 필드: { 사다리수량: 'number' } }, // 사다리: 가격 = 1회매수금 ÷ (누적 수량 + k), 내림
  QUARTER_SELL: { 필드: { 비율: 'number' } }, // 보유 × 비율(내림) → 별지점 LOC 매도
  TARGET_SELL: { 필드: { 종목: 'string', '목표%': 'number' }, 종목별: true }, // 나머지 → 평단 × (1 + 목표%) 지정가
  T_UPDATE: { 필드: { 전량매수: 'number', 절반매수: 'number', 쿼터매도배수: 'number', 목표매도배수: 'number' } },
  REVERSE_TRIGGER: { 필드: { 여유회차: 'number' } }, // T > 분할수 − 여유회차 → 리버스
  REVERSE_STAR: { 필드: { 이동평균일수: 'number' } }, // 리버스 별지점 = 최근 N거래일 종가 평균
  REVERSE_SELL: { 필드: { 분할수: 'number', 매도분모: 'number' }, 분할수별: true }, // 첫날 MOC, 이후 별지점 LOC: 보유 ÷ 분모(내림)
  REVERSE_BUY: { 필드: { 잔금분모: 'number' } }, // 둘째 날부터 잔금 ÷ 분모 → 매수점 LOC
  REVERSE_T: { 필드: { 분할수: 'number', 매도배수: 'number', 매수비율: 'number' }, 분할수별: true }, // 매도: T × 배수, 매수: T + (분할수 − T) × 비율
  REVERSE_EXIT: { 필드: { 종목: 'string', '하락한도%': 'number' }, 종목별: true }, // 종가 > 평단 × (1 − 한도) → 일반 복귀
  QTY_ROUNDING: { 필드: { 방식: 'string' } }, // 수량 반올림 방식('내림'만 지원)
  DUMMY_TEST: { 필드: { 테스트값: 'number' }, dummyOnly: true }, // 테스트 전용
};
const REQUIRED = ['BUY_AMOUNT', 'STAR_LINEAR', 'STAR_POINT', 'BUY_OFFSET', 'FIRST_BUY', 'PHASE', 'LADDER', 'QUARTER_SELL', 'TARGET_SELL', 'T_UPDATE', 'REVERSE_TRIGGER', 'REVERSE_STAR', 'REVERSE_SELL', 'REVERSE_BUY', 'REVERSE_T', 'REVERSE_EXIT', 'QTY_ROUNDING'];

export interface Validation { ok: boolean; errors: string[] }

export function validateRuleFile(x: unknown, opts: { allowDummy: boolean }): Validation {
  const errors: string[] = [];
  if (!x || typeof x !== 'object') return { ok: false, errors: ['JSON 객체가 아님'] };
  const f = x as RuleFile;
  if (typeof f.버전 !== 'string' || !f.버전) errors.push('버전 없음');
  if (typeof f.작성일 !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f.작성일)) errors.push('작성일 형식 오류(YYYY-MM-DD)');
  if (!Array.isArray(f.규칙) || !f.규칙.length) errors.push('규칙 목록 없음');
  if (f.DUMMY && !opts.allowDummy) errors.push('DUMMY 규칙 파일은 실제 계산 화면에서 쓸 수 없음');
  const ids = new Set<string>();
  for (const [i, r] of (Array.isArray(f.규칙) ? f.규칙 : []).entries()) {
    const at = `규칙[${i}]`;
    if (!r || typeof r !== 'object') { errors.push(`${at}: 객체 아님`); continue; }
    if (typeof r.규칙ID !== 'string' || !r.규칙ID) errors.push(`${at}: 규칙ID 없음`);
    else if (ids.has(r.규칙ID)) errors.push(`${at}: 규칙ID 중복(${r.규칙ID})`); else ids.add(r.규칙ID);
    if (r.문서쪽번호 === undefined || r.문서쪽번호 === '') errors.push(`${at}: 문서쪽번호 없음`);
    const h = REGISTRY[r.종류];
    if (!h) { errors.push(`${at}: 등록되지 않은 규칙 종류 '${String(r.종류)}' (문서에서 확인된 종류만 허용)`); continue; }
    if (h.dummyOnly && !(f.DUMMY && opts.allowDummy)) { errors.push(`${at}: DUMMY 전용 종류`); continue; }
    for (const [k, t] of Object.entries(h.필드)) {
      if (typeof r[k] !== t || (t === 'number' && !Number.isFinite(r[k] as number))) errors.push(`${at}: 필드 '${k}'(${t}) 없음/형식 오류 — 기본값 없음`);
    }
    if (r.종류 === 'QTY_ROUNDING' && r.방식 !== '내림') errors.push(`${at}: 수량 반올림 방식은 '내림'만 지원`);
  }
  if (!f.DUMMY && Array.isArray(f.규칙)) {
    const kinds = new Set(f.규칙.map((r) => r?.종류));
    for (const k of REQUIRED) if (!kinds.has(k)) errors.push(`필요한 규칙 종류 '${k}' 없음`);
  }
  return { ok: errors.length === 0, errors };
}

// ───────── 규칙 조회 ─────────
type R = RuleEntry & Record<string, any>;
function pick(rules: RuleFile, 종류: string, s?: { 종목?: Symbol; 분할수?: number }): R | null {
  const h = REGISTRY[종류];
  return (rules.규칙.find((r) => r.종류 === 종류 && (!h?.종목별 || r.종목 === s?.종목) && (!h?.분할수별 || r.분할수 === s?.분할수)) as R) ?? null;
}
function need(rules: RuleFile, 종류: string, s?: { 종목?: Symbol; 분할수?: number }): R {
  const r = pick(rules, 종류, s);
  if (!r) throw new RuleMissing(`${종류}${s?.종목 ? `(${s.종목}` : ''}${s?.분할수 ? `·${s.분할수}분할` : ''}${s?.종목 ? ')' : ''} 규칙 없음`);
  return r;
}
class RuleMissing extends Error {}

// ───────── 반올림 ─────────
const EPS = 1e-9;
export const roundTo = (x: number, d: number) => { const m = 10 ** d; return Math.round((x + Math.sign(x) * EPS) * m) / m; };
export const floorTo = (x: number, d: number) => { const m = 10 ** d; return Math.floor(x * m + EPS) / m; };
const floorQty = (x: number) => Math.floor(x + EPS);

// ───────── 상태 ─────────
export function newState(종목: Symbol, 원금: number): PositionState {
  return { 종목, 원금, 분할수: SPLITS, 회차: 0, 누적매수금: 0, 보유수량: 0, 잔금: 원금, 모드: '일반', 리버스일차: 0, 사이클: 1, 체결: [] };
}
/** 이전 버전 상태(잔금·모드 없음)를 새 형식으로 */
export function migrateState(s: PositionState): PositionState {
  if (typeof s.잔금 === 'number' && s.모드) return s;
  const cash = s.원금 - s.체결.reduce((a, f) => a + (f.구분 === '매수' ? 1 : -1) * f.수량 * f.가격, 0);
  return { ...s, 잔금: cash, 모드: '일반', 리버스일차: 0, 사이클: s.사이클 ?? 1 };
}
export function avgCost(s: PositionState): number | null { return s.보유수량 > 0 ? s.누적매수금 / s.보유수량 : null; }

// ───────── 계산 조각(테스트용으로 공개) ─────────
export function starPct(rules: RuleFile, s: { 종목: Symbol; 분할수: number }, T: number): number {
  const r = need(rules, 'STAR_LINEAR', s);
  return r.시작값 - r.기울기 * T;
}
export function starPoint(rules: RuleFile, avg: number, pct: number): number {
  return roundTo(avg * (1 + pct / 100), need(rules, 'STAR_POINT').자릿수);
}
export function buyPoint(rules: RuleFile, star: number): number {
  return roundTo(star - need(rules, 'BUY_OFFSET').값, need(rules, 'STAR_POINT').자릿수);
}
export function oneBuyAmount(s: Pick<PositionState, '잔금' | '분할수' | '회차'>): number | null {
  const left = s.분할수 - s.회차;
  return left > 0 ? s.잔금 / left : null;
}
/** 사다리: 누적 수량 q 다음부터, 가격 = 1회매수금 ÷ (q + k)(내림), 기준가보다 낮은 가격만, n개 */
export function ladder(rules: RuleFile, oneBuy: number, q: number, below: number, n: number): { 가격: number; 수량: number }[] {
  const d = need(rules, 'STAR_POINT').자릿수, qty = need(rules, 'LADDER').사다리수량;
  const out: { 가격: number; 수량: number }[] = [];
  for (let k = 1; out.length < n && k < 10000; k++) {
    const p = floorTo(oneBuy / (q + k), d);
    if (p <= 0) break;
    if (p < below - EPS) out.push({ 가격: p, 수량: qty });
  }
  return out;
}
export function phaseOf(rules: RuleFile, s: Pick<PositionState, '분할수' | '회차' | '보유수량'>): '첫 매수' | '전반전' | '후반전' | '소진' {
  if (s.보유수량 <= 0 && s.회차 === 0) return '첫 매수';
  if (s.회차 > s.분할수 - need(rules, 'REVERSE_TRIGGER').여유회차 + EPS) return '소진';
  return s.회차 < s.분할수 * need(rules, 'PHASE').경계비율 - EPS ? '전반전' : '후반전';
}

// ───────── 주문 계획 ─────────
export function plan(s0: PositionState, rules: RuleFile | null, m: MarketInput, opts: { allowDummy?: boolean; user?: UserOptions } = {}): PlanResult {
  if (!rules) return { 상태: '규칙 미입력', 메시지: '규칙 미입력 — 무한매수법 문서 필요', 주문: [] };
  if (rules.DUMMY && !opts.allowDummy) return { 상태: 'DUMMY 차단', 메시지: 'DUMMY 규칙은 실제 계산 화면에서 쓸 수 없습니다', 주문: [] };
  const v = validateRuleFile(rules, { allowDummy: !!opts.allowDummy });
  if (!v.ok) return { 상태: '규칙 오류', 메시지: v.errors.join(' / '), 주문: [] };
  if (rules.DUMMY && rules.규칙.some((x) => x.종류 === 'DUMMY_TEST')) {
    const r = rules.규칙.find((x) => x.종류 === 'DUMMY_TEST') as R | undefined;
    return { 상태: '정상', 메시지: 'DUMMY', 주문: r && m.전일종가 ? [{ 종류: 'DUMMY', 역할: 'manual', 구분: '매수', 주문유형: 'LOC', 가격: m.전일종가, 수량: floorQty(r.테스트값 / m.전일종가), 규칙ID: r.규칙ID }] : [] };
  }
  try { return planReal(migrateState(s0), rules, m, opts.user ?? {}); } catch (e) {
    if (e instanceof RuleMissing) return { 상태: '규칙 오류', 메시지: e.message, 주문: [] };
    throw e;
  }
}

function planReal(s: PositionState, rules: RuleFile, m: MarketInput, u: UserOptions): PlanResult {
  const key = { 종목: s.종목, 분할수: s.분할수 };
  const d = need(rules, 'STAR_POINT').자릿수;
  const avg = avgCost(s);
  const notes: string[] = [];
  const info = (구간: PlanInfo['구간'], extra: Partial<PlanInfo> = {}): PlanInfo => ({ 구간, 회차: s.회차, '1회매수금': null, '별%': null, 별지점: null, 매수점: null, 평단: avg, 잔금: s.잔금, 리버스일차: s.모드 === '리버스' ? s.리버스일차 : null, 참고: notes, ...extra });
  const ok = (orders: Order[], i: PlanInfo): PlanResult => ({ 상태: '정상', 메시지: '계산 결과이며 주문은 사용자가 직접 또는 별도 자동매매 프로그램에서 실행합니다.', 주문: orders.filter((o) => o.수량 > 0), 정보: i });
  const sells = (st: PositionState, star: number): Order[] => {
    const avg = avgCost(st);
    if (!(st.보유수량 > 0) || avg === null) return [];
    const qr = need(rules, 'QUARTER_SELL'), tr = need(rules, 'TARGET_SELL', key);
    const quarter = floorQty(st.보유수량 * qr.비율);
    return [
      { 종류: '쿼터매도', 역할: 'sell_quarter', 구분: '매도', 주문유형: 'LOC', 가격: star, 수량: quarter, 규칙ID: qr.규칙ID },
      { 종류: '목표 매도', 역할: 'sell_target', 구분: '매도', 주문유형: '지정가', 가격: roundTo(avg * (1 + tr['목표%'] / 100), d), 수량: st.보유수량 - quarter, 규칙ID: tr.규칙ID },
    ];
  };
  const ladderN = u.사다리개수 != null && u.사다리개수 >= 0 ? Math.floor(u.사다리개수) : null;
  if (ladderN === null) notes.push('사다리 개수 미입력 — 사다리 주문을 넣지 않았습니다(문서에 개수가 정해져 있지 않음)');
  const ladderOrders = (oneBuy: number, q: number, below: number): Order[] => {
    const lr = need(rules, 'LADDER');
    return ladder(rules, oneBuy, q, below, ladderN ?? 0).map((x) => ({ 종류: '사다리', 역할: 'ladder' as Role, 구분: '매수' as const, 주문유형: 'LOC' as OrderType, 가격: x.가격, 수량: x.수량, 규칙ID: lr.규칙ID }));
  };

  // 리버스 모드
  if (s.모드 === '리버스') {
    const ex = need(rules, 'REVERSE_EXIT', key);
    const close = m.전일종가;
    if (s.리버스일차 >= 2 && close !== null && avg !== null && close > avg * (1 - ex['하락한도%'] / 100) + EPS) {
      notes.push(`종료 조건 충족(규칙 ${ex.규칙ID}) — 오늘부터 일반 모드, 회차 승계`);
      return planNormal({ ...s, 모드: '일반', 리버스일차: 0 }, '리버스 종료(일반 복귀)');
    }
    const n = need(rules, 'REVERSE_STAR').이동평균일수;
    const closes = (m.최근종가 ?? []).slice(-n);
    const rs = need(rules, 'REVERSE_SELL', key);
    if (s.리버스일차 <= 1) {
      return ok([{ 종류: '리버스 첫날 매도', 역할: 'rev_sell_moc', 구분: '매도', 주문유형: 'MOC', 가격: null, 수량: floorQty(s.보유수량 / rs.매도분모), 규칙ID: rs.규칙ID }], info('리버스', { 리버스일차: 1 }));
    }
    if (closes.length < n) return { 상태: '가격 데이터 부족', 메시지: `리버스 별지점에 최근 ${n}거래일 종가가 필요합니다`, 주문: [], 정보: info('리버스') };
    const star = roundTo(closes.reduce((a, b) => a + b, 0) / n, d);
    const bp = buyPoint(rules, star);
    const rb = need(rules, 'REVERSE_BUY');
    const buyAmt = s.잔금 / rb.잔금분모;
    return ok([
      { 종류: '리버스 매도', 역할: 'rev_sell', 구분: '매도', 주문유형: 'LOC', 가격: star, 수량: floorQty(s.보유수량 / rs.매도분모), 규칙ID: rs.규칙ID },
      { 종류: '리버스 매수', 역할: 'rev_buy', 구분: '매수', 주문유형: 'LOC', 가격: bp, 수량: floorQty(buyAmt / bp), 규칙ID: rb.규칙ID },
    ], info('리버스', { 별지점: star, 매수점: bp, '1회매수금': buyAmt }));
  }
  return planNormal(s, null);

  function planNormal(st: PositionState, label: PlanInfo['구간'] | null): PlanResult {
    const ph = phaseOf(rules, st);
    if (ph === '소진') return { 상태: '정상', 메시지: '회차가 소진 기준을 넘었습니다 — 체결 입력 시 리버스 모드로 바뀝니다', 주문: [], 정보: info('리버스') };
    const oneBuy = oneBuyAmount(st);
    if (oneBuy === null) return { 상태: '규칙 오류', 메시지: '1회매수금을 계산할 수 없음(분할수 − 회차 ≤ 0)', 주문: [] };
    const ba = need(rules, 'BUY_AMOUNT');
    if (ph === '첫 매수') {
      const fb = need(rules, 'FIRST_BUY');
      const prem = u['첫매수할증%'];
      if (prem == null || prem < fb['할증최소%'] - EPS || prem > fb['할증최대%'] + EPS) return { 상태: '입력 필요', 메시지: `첫 매수 할증률을 ${fb['할증최소%']}~${fb['할증최대%']}% 안에서 입력하세요(규칙 ${fb.규칙ID})`, 주문: [], 정보: info('첫 매수', { '1회매수금': oneBuy }) };
      if (m.전일종가 === null) return { 상태: '가격 데이터 부족', 메시지: '전일 종가가 없습니다', 주문: [], 정보: info('첫 매수', { '1회매수금': oneBuy }) };
      const p = roundTo(m.전일종가 * (1 + prem / 100), d);
      const q = floorQty(oneBuy / p);
      return ok([{ 종류: '첫 매수', 역할: 'first', 구분: '매수', 주문유형: 'LOC', 가격: p, 수량: q, 규칙ID: fb.규칙ID }, ...ladderOrders(oneBuy, q, p)], info(label ?? '첫 매수', { '1회매수금': oneBuy }));
    }
    const a = avgCost(st);
    if (a === null) return { 상태: '규칙 오류', 메시지: '보유수량이 0인데 회차가 0이 아닙니다 — 회차를 확인하세요', 주문: [] };
    const pct = starPct(rules, st, st.회차);
    const star = starPoint(rules, a, pct);
    const bp = buyPoint(rules, star);
    const sl = need(rules, 'STAR_LINEAR', key);
    const orders: Order[] = [];
    if (ph === '전반전') {
      const pr = need(rules, 'PHASE');
      const half = oneBuy * pr.전반전분할비율;
      const avgP = floorTo(a, d);
      const q1 = floorQty(half / bp), q2 = floorQty((oneBuy - half) / avgP);
      orders.push({ 종류: '별지점 매수', 역할: 'buy_star', 구분: '매수', 주문유형: 'LOC', 가격: bp, 수량: q1, 규칙ID: pr.규칙ID },
        { 종류: '평단 매수', 역할: 'buy_avg', 구분: '매수', 주문유형: 'LOC', 가격: avgP, 수량: q2, 규칙ID: pr.규칙ID }, ...ladderOrders(oneBuy, q1 + q2, Math.min(bp, avgP)));
    } else {
      const q1 = floorQty(oneBuy / bp);
      orders.push({ 종류: '별지점 매수', 역할: 'buy_star', 구분: '매수', 주문유형: 'LOC', 가격: bp, 수량: q1, 규칙ID: need(rules, 'PHASE').규칙ID }, ...ladderOrders(oneBuy, q1, bp));
    }
    const sel = sells(st, star);
    return ok([...orders, ...sel], info(label ?? ph, { '1회매수금': oneBuy, '별%': pct, 별지점: star, 매수점: bp, 평단: a, 참고: [...notes, `1회매수금 규칙 ${ba.규칙ID}, 별% 규칙 ${sl.규칙ID}`] }));
  }
}

// ───────── 체결 반영(다음 회차) ─────────
/** 하루 체결을 반영해 다음 상태를 만든다. 회차(T)는 규칙 파일의 갱신 규칙으로 계산한다.
 *  planned: 그날 계획(역할 확인용). fills: 실제 체결(역할 포함). */
export function settleDay(s0: PositionState, rules: RuleFile, planned: PlanResult, fills: Fill[]): PositionState {
  let s = migrateState(s0);
  const v = validateRuleFile(rules, { allowDummy: !!rules.DUMMY });
  if (!v.ok) throw new Error('규칙 파일 오류: ' + v.errors.join(' / '));
  const key = { 종목: s.종목, 분할수: s.분할수 };
  const T0 = s.회차;
  for (const f of fills) {
    if (!(f.수량 > 0) || !(f.가격 > 0)) throw new Error('체결 수량·가격은 0보다 커야 함');
    if (f.구분 === '매수') { s = { ...s, 누적매수금: s.누적매수금 + f.수량 * f.가격, 보유수량: s.보유수량 + f.수량, 잔금: s.잔금 - f.수량 * f.가격 }; }
    else {
      if (f.수량 > s.보유수량 + EPS) throw new Error('보유수량보다 많이 매도할 수 없음');
      const avg = avgCost(s) ?? 0;
      const q = s.보유수량 - f.수량;
      s = { ...s, 보유수량: q, 누적매수금: q > 0 ? avg * q : 0, 잔금: s.잔금 + f.수량 * f.가격 };
    }
  }
  s = { ...s, 체결: [...s.체결, ...fills] };
  const roles = new Set(fills.map((f) => f.역할));
  const plannedRoles = new Set(planned.주문.map((o) => o.역할));
  const wasReverse = planned.정보?.구간 === '리버스' && s.모드 === '리버스';
  if (planned.정보?.구간 === '리버스' && s.모드 !== '리버스') return { ...s, 모드: '리버스', 리버스일차: 1 }; // 소진 확인만 된 날
  let T = T0;
  if (wasReverse) {
    const rt = need(rules, 'REVERSE_T', key);
    if (roles.has('rev_sell_moc') || roles.has('rev_sell')) T = T * rt.매도배수;
    if (roles.has('rev_buy')) T = T + (s.분할수 - T) * rt.매수비율;
    s = { ...s, 모드: '리버스', 리버스일차: Math.max(1, s.리버스일차) + 1 };
  } else {
    const tu = need(rules, 'T_UPDATE');
    if (roles.has('sell_quarter')) T *= tu.쿼터매도배수;
    if (roles.has('sell_target')) T *= tu.목표매도배수;
    const mainBuys = (['first', 'buy_star', 'buy_avg'] as Role[]).filter((r) => plannedRoles.has(r));
    const filledMain = mainBuys.filter((r) => roles.has(r));
    if (filledMain.length && filledMain.length === mainBuys.length) T += tu.전량매수;
    else if (filledMain.length) T += tu.절반매수;
    if (planned.정보?.구간 === '리버스 종료(일반 복귀)') s = { ...s, 모드: '일반', 리버스일차: 0 };
  }
  if (s.보유수량 <= EPS) return { ...s, 회차: 0, 보유수량: 0, 누적매수금: 0, 모드: '일반', 리버스일차: 0 }; // 사이클 종료
  s = { ...s, 회차: T };
  if (s.모드 === '일반' && T > s.분할수 - need(rules, 'REVERSE_TRIGGER').여유회차 + EPS) s = { ...s, 모드: '리버스', 리버스일차: 1 };
  return s;
}

/** 사이클 종료 뒤 새 사이클 원금(복리·단리는 사용자가 고름) */
export function newCycle(s: PositionState, 원금: number): PositionState {
  if (s.보유수량 > 0) throw new Error('보유수량이 남아 있어 새 사이클을 시작할 수 없음');
  if (!(원금 > 0)) throw new Error('원금은 0보다 커야 함');
  return { ...s, 원금, 잔금: 원금, 회차: 0, 누적매수금: 0, 모드: '일반', 리버스일차: 0, 사이클: (s.사이클 ?? 1) + 1 };
}

/** 수동 체결 기록(규칙 갱신 없이) — 회차는 사용자가 기록 */
export function applyFills(s0: PositionState, fills: Fill[]): PositionState {
  let s = migrateState(s0);
  for (const f of fills) {
    if (!(f.수량 > 0) || !(f.가격 > 0)) throw new Error('체결 수량·가격은 0보다 커야 함');
    if (f.구분 === '매수') s = { ...s, 누적매수금: s.누적매수금 + f.수량 * f.가격, 보유수량: s.보유수량 + f.수량, 잔금: s.잔금 - f.수량 * f.가격 };
    else {
      if (f.수량 > s.보유수량) throw new Error('보유수량보다 많이 매도할 수 없음');
      const avg = avgCost(s) ?? 0; const q = s.보유수량 - f.수량;
      s = { ...s, 보유수량: q, 누적매수금: q > 0 ? avg * q : 0, 잔금: s.잔금 + f.수량 * f.가격 };
    }
    s = { ...s, 체결: [...s.체결, f] };
  }
  return s;
}
export function setRound(s: PositionState, 회차: number): PositionState {
  if (!(회차 >= 0) || 회차 > s.분할수) throw new Error(`회차는 0~${s.분할수} 범위`);
  return { ...s, 회차 };
}
