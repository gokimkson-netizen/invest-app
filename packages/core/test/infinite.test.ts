// M4 Core 구조 테스트 — 문서 값이 아닌 임의의 DUMMY 값만 쓴다(실제 규칙 값은 private/ 로컬 테스트에서 검증)
import { describe, it, expect } from 'vitest';
import { plan, settleDay, newState, validateRuleFile, ladder, migrateState, newCycle, type RuleFile, type PositionState } from '../src/infinite/core';

const K = (종류: string, f: Record<string, unknown> = {}, i = 0) => ({ 규칙ID: `DUMMY-${종류}-${i}`, 문서쪽번호: 'DUMMY', 종류, ...f });
const D: RuleFile = { 버전: 'DUMMY', 작성일: '2000-01-01', DUMMY: true, 규칙: [
  K('BUY_AMOUNT'), K('STAR_LINEAR', { 종목: 'TQQQ', 분할수: 40, 시작값: 8, 기울기: 0.4 }), K('STAR_POINT', { 자릿수: 3 }), K('BUY_OFFSET', { 값: 0.05 }),
  K('FIRST_BUY', { '할증최소%': 3, '할증최대%': 6 }), K('PHASE', { 경계비율: 0.6, 전반전분할비율: 0.4 }), K('LADDER', { 사다리수량: 2 }), K('QUARTER_SELL', { 비율: 0.5 }),
  K('TARGET_SELL', { 종목: 'TQQQ', '목표%': 9 }), K('T_UPDATE', { 전량매수: 2, 절반매수: 1, 쿼터매도배수: 0.5, 목표매도배수: 0.1 }), K('REVERSE_TRIGGER', { 여유회차: 2 }),
  K('REVERSE_STAR', { 이동평균일수: 3 }), K('REVERSE_SELL', { 분할수: 40, 매도분모: 8 }), K('REVERSE_BUY', { 잔금분모: 3 }), K('REVERSE_T', { 분할수: 40, 매도배수: 0.8, 매수비율: 0.5 }),
  K('REVERSE_EXIT', { 종목: 'TQQQ', '하락한도%': 7 }), K('QTY_ROUNDING', { 방식: '내림' }),
] };
const s = (o: Partial<PositionState>) => ({ ...newState('TQQQ', 10000), ...o });
const P = (st: PositionState, m: any, u: any = {}) => plan(st, D, { 기준일: 'x', ...m }, { allowDummy: true, user: u });

describe('M4 Core(DUMMY 값으로 구조만 검증)', () => {
  it('DUMMY 파일은 실제 화면에서 차단, 필요한 종류가 빠진 실제 파일은 오류', () => {
    expect(plan(s({}), D, { 기준일: 'x', 전일종가: 10 }).상태).toBe('DUMMY 차단');
    const real = { ...D, DUMMY: false, 규칙: D.규칙.filter((r) => r.종류 !== 'LADDER') };
    expect(validateRuleFile(real, { allowDummy: false }).errors).toContain("필요한 규칙 종류 'LADDER' 없음");
  });
  it('첫 매수: 할증률 범위 밖이면 입력 필요, 안이면 LOC + 사다리', () => {
    expect(P(s({}), { 전일종가: 10 }, { '첫매수할증%': 7 }).상태).toBe('입력 필요');
    const r = P(s({}), { 전일종가: 10 }, { '첫매수할증%': 5, 사다리개수: 2 });
    expect(r.주문[0]).toMatchObject({ 역할: 'first', 가격: 10.5, 수량: Math.floor(250 / 10.5) });
    expect(r.주문.filter((o) => o.역할 === 'ladder').length).toBe(2);
  });
  it('사다리 개수 미입력이면 사다리 없이 안내', () => {
    const r = P(s({}), { 전일종가: 10 }, { '첫매수할증%': 5 });
    expect(r.주문.some((o) => o.역할 === 'ladder')).toBe(false);
    expect(r.정보!.참고.join()).toContain('사다리 개수 미입력');
  });
  it('사다리 가격은 기준가보다 낮은 것만, 내림', () => expect(ladder(D, 100, 9, 9.5, 2).map((x) => [x.가격, x.수량])).toEqual([[9.09, 2], [8.333, 2]]));
  it('전반전/후반전 경계, 매도 2건(비율·나머지)', () => {
    const a = P(s({ 보유수량: 10, 누적매수금: 100, 잔금: 9900, 회차: 23.9 }), { 전일종가: 10 });
    expect(a.정보!.구간).toBe('전반전'); expect(a.주문.some((o) => o.역할 === 'buy_avg')).toBe(true);
    const b = P(s({ 보유수량: 10, 누적매수금: 100, 잔금: 9900, 회차: 24 }), { 전일종가: 10 });
    expect(b.정보!.구간).toBe('후반전'); expect(b.주문.some((o) => o.역할 === 'buy_avg')).toBe(false);
    expect(b.주문.filter((o) => o.구분 === '매도').map((o) => o.수량)).toEqual([5, 5]);
  });
  it('T 갱신은 규칙 파일 값으로(절반 매수, 매도 배수), 보유 0이면 T 0', () => {
    const st = s({ 보유수량: 10, 누적매수금: 100, 잔금: 9900, 회차: 4 });
    const r = P(st, { 전일종가: 10 });
    expect(settleDay(st, D, r, [{ 일자: 'x', 구분: '매수', 수량: 1, 가격: 10, 역할: 'buy_star' }]).회차).toBe(5);
    expect(settleDay(st, D, r, [{ 일자: 'x', 구분: '매도', 수량: 5, 가격: 10, 역할: 'sell_quarter' }]).회차).toBe(2);
    expect(settleDay(st, D, r, [{ 일자: 'x', 구분: '매도', 수량: 10, 가격: 10, 역할: 'sell_target' }]).회차).toBe(0);
  });
  it('소진 → 리버스 첫날 MOC → 이후 이동평균 별지점, 종료 조건에서 일반 복귀', () => {
    const st = s({ 보유수량: 80, 누적매수금: 800, 잔금: 300, 회차: 37.5 });
    const n = settleDay(st, D, P(st, { 전일종가: 9 }), [{ 일자: 'x', 구분: '매수', 수량: 1, 가격: 9, 역할: 'buy_star' }]);
    expect(n.모드).toBe('리버스'); expect(n.리버스일차).toBe(1);
    const d1 = P(n, { 전일종가: 8 });
    expect(d1.주문).toEqual([expect.objectContaining({ 역할: 'rev_sell_moc', 수량: 10 })]);
    const n2 = settleDay(n, D, d1, [{ 일자: 'y', 구분: '매도', 수량: 10, 가격: 8, 역할: 'rev_sell_moc' }]);
    expect(n2.회차).toBeCloseTo(39.5 * 0.8, 9); expect(n2.리버스일차).toBe(2);
    expect(P(n2, { 전일종가: 8 }).상태).toBe('가격 데이터 부족');
    const d2 = P(n2, { 전일종가: 8, 최근종가: [9, 8, 7] });
    expect(d2.정보!.별지점).toBe(8);
    expect(P(n2, { 전일종가: 9.5, 최근종가: [9, 9, 9.5] }).정보!.구간).toBe('리버스 종료(일반 복귀)');
  });
  it('이전 버전 상태 변환, 새 사이클', () => {
    const old = { 종목: 'TQQQ', 원금: 1000, 분할수: 40, 회차: 1, 누적매수금: 100, 보유수량: 10, 체결: [{ 일자: 'x', 구분: '매수', 수량: 10, 가격: 10 }] } as unknown as PositionState;
    expect(migrateState(old)).toMatchObject({ 잔금: 900, 모드: '일반' });
    expect(newCycle(s({ 잔금: 12000 }), 12000)).toMatchObject({ 원금: 12000, 잔금: 12000, 사이클: 2 });
  });
});
