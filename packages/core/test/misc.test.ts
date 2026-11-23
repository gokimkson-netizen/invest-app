import { describe, it, expect } from 'vitest';
import { checkNumbers, summarizeFindings } from '../src/common/numcheck';
import { plan, validateRuleFile, newState, applyFills, avgCost, setRound } from '../src/infinite/core';
import { m5Status, todayBand, validateM5Rules } from '../src/m5/position';
import { isStale, marketDayStatus, isTradingDay, tradingDaysBetween, firstTradingDayOfYear } from '../src/common/calendar';
import * as C from '../src/common/crypto';

describe('10절 7번 숫자 검사 — 허용/확인 필요/오류', () => {
  const input = { 단위: '백만원', 재무: { 매출: 1234567, 영업이익: 123456.7 }, 시장데이터: { 주가: 71500, 기준일: '2026-11-20' }, 'ROE%': 12.345 };
  it('허용: 단위 환산(1.23조원)·반올림(12.3%)·날짜', () => {
    const f = checkNumbers('매출은 약 1.23조원, ROE는 12.3%다. 기준일 2026-11-20 종가 71,500원.', input, { unit: '백만원' });
    expect(f.every((x) => x.상태 === '허용')).toBe(true);
  });
  it("'확인 필요': 입력값에서 나눗셈으로 파생된 비율(영업이익률 10.0%)", () => {
    const f = checkNumbers('영업이익률은 10.0%로 추정된다.', input, { unit: '백만원' });
    expect(f.find((x) => x.원문.includes('10.0'))!.상태).toBe('확인 필요');
  });
  it('오류: 근거 없는 숫자(목표주가 95,000원, 2027-01-05)', () => {
    const f = checkNumbers('목표주가는 95,000원이며 2027-01-05에 발표된다.', input, { unit: '백만원' });
    const s = summarizeFindings(f);
    expect(s.오류).toBe(2);
  });
  it('머리말 번호·관문 이름·개수 표현은 검사 대상이 아님', () => {
    const f = checkNumbers('## 8. 리스크 3가지\nG2 해자는 통과', input);
    expect(summarizeFindings(f).오류).toBe(0);
  });
});

describe('M4 무한매수법 Core — 규칙 창작 금지', () => {
  it('규칙 파일이 없으면 계산 결과를 출력하지 않는다', () => {
    const r = plan(newState('TQQQ', 10000), null, { 기준일: '2026-11-20', 전일종가: 50 });
    expect(r.상태).toBe('규칙 미입력'); expect(r.주문).toHaveLength(0);
    expect(r.메시지).toContain('규칙 미입력 — 무한매수법 문서 필요');
  });
  it('DUMMY 규칙은 실제 화면(allowDummy=false)에서 차단', () => {
    const f = { 버전: 'DUMMY', 작성일: '2026-11-23', DUMMY: true, 규칙: [{ 규칙ID: 'D-1', 문서쪽번호: 0, 종류: 'DUMMY_TEST', 테스트값: 100 }] };
    expect(plan(newState('SOXL', 1000), f, { 기준일: 'x', 전일종가: 10 }).상태).toBe('DUMMY 차단');
    expect(plan(newState('SOXL', 1000), f, { 기준일: 'x', 전일종가: 10 }, { allowDummy: true }).주문[0].수량).toBe(10);
  });
  it('등록되지 않은 규칙 종류·필드 누락은 스키마 검증 실패(기본값 없음)', () => {
    const v = validateRuleFile({ 버전: '4.0', 작성일: '2026-11-23', 규칙: [{ 규칙ID: 'R1', 문서쪽번호: 3, 종류: '임의규칙' }] }, { allowDummy: false });
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toContain('등록되지 않은 규칙 종류');
  });
  it('체결 기록: 평단·누적매수금, 회차는 사용자 기록', () => {
    let s = newState('TQQQ', 4000);
    s = applyFills(s, [{ 일자: '2026-11-20', 구분: '매수', 수량: 2, 가격: 50 }, { 일자: '2026-11-20', 구분: '매수', 수량: 2, 가격: 40 }]);
    expect(avgCost(s)).toBe(45); expect(s.누적매수금).toBe(180); expect(s.회차).toBe(0);
    s = setRound(s, 1.5); expect(s.회차).toBe(1.5);
    s = applyFills(s, [{ 일자: '2026-11-21', 구분: '매도', 수량: 1, 가격: 60 }]);
    expect(avgCost(s)).toBe(45); expect(s.보유수량).toBe(3);
    expect(s.분할수).toBe(40);
  });
});

describe('M5 100% 검사(M5 자금만)', () => {
  it('총 매수금액이 총자산의 100%를 넘으면 경고', () => {
    const r = m5Status({ 총자산: 1000, 매수내역: [{ 일자: 'x', 가격: 30, 수량: 40 }], 현재가: 30 });
    expect(r['투입비율%']).toBeCloseTo(120); expect(r.경고.some((w) => w.includes('100%를 넘었습니다'))).toBe(true);
  });
  it('정확히 100%는 경고 없음, 평단·평가손익', () => {
    const r = m5Status({ 총자산: 1200, 매수내역: [{ 일자: 'x', 가격: 30, 수량: 40 }], 현재가: 33, 전고점: 300, 대기자산: 0 });
    expect(r.경고.filter((w) => w.includes('100%'))).toHaveLength(0);
    expect(r.평단).toBe(30); expect(r.평가손익).toBeCloseTo(120); expect(r['전고점대비낙폭%']).toBeCloseTo(-89);
  });
  it('규칙 미입력', () => expect(todayBand(null, -50).상태).toBe('규칙 미입력'));
  const R = { 확정: false, 분할매수: [{ 'SOXX낙폭이하%': -20, 매수금액: 1 }, { 'SOXX낙폭이하%': -40, 매수금액: 2 }, { 'SOXX낙폭이하%': -60, 매수금액: 3 }], 매도구간: [] };
  it('조건에 맞는 구간을 모두 표시(하나를 고르지 않음), 미확정은 참고 표시', () => {
    const b = todayBand(R, -45);
    expect(b.구간.map((x) => x['SOXX낙폭이하%'])).toEqual([-20, -40]);
    expect(b.상태).toBe('규칙 미확정(참고) — 조건에 맞는 구간 2개');
    expect(todayBand({ ...R, 확정: true }, -10).상태).toBe('해당 구간 없음');
  });
  it('규칙 파일 검사: 형식 오류·알 수 없는 항목은 거부, 기본값을 채우지 않음', () => {
    expect(validateM5Rules(R).errors).toEqual([]);
    expect(validateM5Rules({ ...R, 확정: 'yes' }).errors).toContain('확정: true/false 필요');
    expect(validateM5Rules({ ...R, 분할매수: [{ 'SOXX낙폭이하%': 30, 매수금액: 1 }] }).errors[0]).toMatch('-100~0');
    expect(validateM5Rules({ ...R, 익절: 1 }).errors).toContain('알 수 없는 항목: 익절');
    expect(validateM5Rules({ 확정: true }).rules).toBeNull();
    expect(validateM5Rules([1]).errors).toEqual(['JSON 객체가 아닙니다']);
  });
});

describe('캘린더(10절 13번)', () => {
  it('휴장일 표시', () => {
    expect(isTradingDay('2026-11-26', 'US')).toBe(false); // 추수감사절
    expect(marketDayStatus(new Date('2026-11-26T15:00:00Z'), 'US')).toEqual({ 날짜: '2026-11-26', 휴장: true, 사유: 'Thanksgiving' });
    expect(marketDayStatus(new Date('2026-12-31T03:00:00Z'), 'KR').사유).toBe('연말 휴장일');
  });
  it('2거래일 넘게 지나면 오래된 데이터', () => {
    // 2026-11-20(금) 기준일, 오늘 2026-11-24(화, 뉴욕) → 23·24 = 2거래일 → 경고 아님
    expect(isStale('2026-11-20', new Date('2026-11-24T20:00:00Z'), 'US')).toBe(false);
    // 2026-11-25(수) → 3거래일 → 경고
    expect(isStale('2026-11-20', new Date('2026-11-25T20:00:00Z'), 'US')).toBe(true);
    // 추수감사절(11-26)은 세지 않음: 11-24 기준, 11-27 → 25·27 = 2
    expect(tradingDaysBetween('2026-11-24', '2026-11-27', 'US')).toBe(2);
  });
  it('첫 거래일', () => { expect(firstTradingDayOfYear(2027, 'KR')).toBe('2027-01-04'); expect(firstTradingDayOfYear(2026, 'US')).toBe('2026-01-02'); });
});

describe('암호화', () => {
  it('데이터 봉투 왕복·경로 바꿔치기 거부', async () => {
    const k = await C.importDataKey(C.newDataKeyBase64());
    const e = await C.sealData(k, 'm3/AAPL.json', { a: 1 });
    expect(await C.openData(k, e, 'm3/AAPL.json')).toEqual({ a: 1 });
    await expect(C.openData(k, { ...e, path: 'm3/MSFT.json' }, 'm3/MSFT.json')).rejects.toThrow();
  });
  it('동기화 봉투: 업로드마다 salt2·IV 새로, 같은 기본키로 복호화', async () => {
    const salt1 = C.rand(16);
    const base = await C.deriveBaseKey('비밀번호!', salt1);
    const e1 = await C.sealSync(base, salt1, { x: 1 }), e2 = await C.sealSync(base, salt1, { x: 1 });
    expect(e1.salt2).not.toBe(e2.salt2); expect(e1.iv).not.toBe(e2.iv); expect(e1.iter).toBeGreaterThanOrEqual(600000);
    const base2 = await C.deriveBaseKey('비밀번호!', C.unb64(e1.salt1));
    expect(await C.openSync(base2, e2)).toEqual({ x: 1 });
    await expect(C.openSync(await C.deriveBaseKey('틀림', salt1), e1)).rejects.toThrow();
  }, 20000);
  it('PBKDF2 60만 회 미만 거부', async () => { await expect(C.deriveBaseKey('a', C.rand(16), 1000)).rejects.toThrow(); });
});
