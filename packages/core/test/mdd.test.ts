import { describe, it, expect } from 'vitest';
import { summarize, yearStats, currentDrawdown, backtest, frequencyTable, type Bar } from '../src/mdd/mdd';

// 10절 8번: 엑셀이 없으므로 '정의 문서 + 수작업 검산 예시 3건'. 아래 기대값은 docs/mdd-definitions.md 4절의 손 계산과 같다.
const B = (d: string, c: number): Bar => ({ d, c });

describe('수작업 검산 예시 1 — 미국 주식(기준일 = 매년 첫 거래일)', () => {
  const bars = [B('2024-01-02', 100), B('2024-03-01', 120), B('2024-06-03', 90), B('2024-12-31', 110), B('2025-01-02', 110), B('2025-05-01', 77), B('2025-12-31', 121), B('2026-01-02', 121)];
  const s = summarize(bars, 'US');
  it('연도별', () => {
    const y24 = s.연도별.find((y) => y.연도 === 2024)!, y25 = s.연도별.find((y) => y.연도 === 2025)!;
    expect(y24.완결).toBe(true);
    expect(y24['상승률%']).toBeCloseTo(20, 9); expect(y24['낙폭%']).toBeCloseTo(-10, 9); expect(y24['MDD%']).toBeCloseTo(-25, 9); expect(y24['수익률%']).toBeCloseTo(10, 9);
    expect(y25['상승률%']).toBeCloseTo(10, 9); expect(y25['낙폭%']).toBeCloseTo(-30, 9); expect(y25['MDD%']).toBeCloseTo(-30, 9);
    expect(s.연도별.find((y) => y.연도 === 2026)!.완결).toBe(false);
  });
  it('평균(완결 연도만)', () => {
    expect(s.표본연수).toBe(2);
    expect(s['평균상승률%']!).toBeCloseTo(15, 9); expect(s['평균낙폭%']!).toBeCloseTo(-20, 9); expect(s['평균MDD%']!).toBeCloseTo(-27.5, 9); expect(s['평균수익률%']!).toBeCloseTo(10, 9);
  });
  it('빈도표(엑셀 구간): -25%는 경계값이라 "15% ~ 25%", -30%는 "25% ~ 35%"', () => {
    const f = Object.fromEntries(s.빈도표.map((r) => [r.구간, r.횟수]));
    expect(f['15% ~ 25%']).toBe(1); expect(f['25% ~ 35%']).toBe(1);
    expect(s.빈도표.reduce((a, r) => a + r.횟수, 0)).toBe(2);
  });
});

describe('수작업 검산 예시 2 — BTC(기준일 = 매년 1월 2일)', () => {
  const bars = [B('2023-01-01', 50), B('2023-01-02', 100), B('2023-06-01', 50), B('2023-12-31', 200), B('2024-01-01', 210), B('2024-01-02', 200), B('2024-12-31', 150), B('2025-01-02', 150)];
  const st = yearStats(bars, 'CRYPTO');
  it('기준일 이전 봉(1월 1일)은 다음 기준일 전까지 직전 연도에 속한다', () => {
    const y23 = st.find((y) => y.연도 === 2023)!;
    expect(y23.기준일).toBe('2023-01-02');
    expect(y23['상승률%']).toBeCloseTo(110, 9); expect(y23['낙폭%']).toBeCloseTo(-50, 9); expect(y23['MDD%']).toBeCloseTo(-50, 9); expect(y23['수익률%']).toBeCloseTo(110, 9);
    const y24 = st.find((y) => y.연도 === 2024)!;
    expect(y24['MDD%']).toBeCloseTo(-25, 9); expect(y24['수익률%']).toBeCloseTo(-25, 9);
  });
  it('평균', () => {
    const s = summarize(bars, 'CRYPTO');
    expect(s['평균MDD%']!).toBeCloseTo(-37.5, 9); expect(s['평균상승률%']!).toBeCloseTo(55, 9);
  });
});

describe('수작업 검산 예시 3 — 현재 낙폭·백테스트', () => {
  const bars = [B('2025-01-02', 100), B('2025-01-03', 80), B('2025-01-06', 60), B('2025-01-07', 90), B('2025-01-08', 100), B('2025-01-09', 110)];
  it('현재 낙폭(전체 기간) = 0%, 52주 고점 = 110', () => {
    const c = currentDrawdown(bars, 'all')!;
    expect(c['고점대비하락률%']).toBeCloseTo(0, 9); expect(c.고점).toBe(110);
    const c2 = currentDrawdown(bars.slice(0, 3), '52w')!;
    expect(c2['고점대비하락률%']).toBeCloseTo(-40, 9);
  });
  it('진입 -30%, 전고점 회복 청산, 수수료 0', () => {
    const r = backtest(bars, { 진입낙폭: -30, 청산: { 종류: '전고점회복' }, 수수료bp: 0 });
    expect(r.거래).toHaveLength(1);
    expect(r.거래[0].진입가).toBe(60); expect(r.거래[0].청산가).toBe(100);
    expect(r['누적수익률%']).toBeCloseTo((100 / 60 - 1) * 100, 9);
    expect(r['단순보유_누적%']).toBeCloseTo(10, 9);
    expect(r.세금반영).toBe(false);
  });
  it('수수료 10bp 반영', () => {
    const r = backtest(bars, { 진입낙폭: -30, 청산: { 종류: '전고점회복' }, 수수료bp: 10 });
    expect(r['누적수익률%']).toBeCloseTo((0.999 * 0.999 * 100 / 60 - 1) * 100, 9);
  });
  it('세율 20% 반영 시 이익에서 차감', () => {
    const r = backtest(bars, { 진입낙폭: -30, 청산: { 종류: '전고점회복' }, 수수료bp: 0, 세율: 20 });
    expect(r['누적수익률%']).toBeCloseTo((100 / 60 - 1) * 0.8 * 100, 9);
  });
  it('원화 환산', () => {
    const fx = bars.map((b) => B(b.d, 1000));
    const r = backtest(bars, { 진입낙폭: -30, 청산: { 종류: '전고점회복' }, 수수료bp: 0, 환율: fx });
    expect(r.환산).toBe(true);
    expect(r['누적수익률%']).toBeCloseTo((100 / 60 - 1) * 100, 9);
  });
});

describe('빈도표 경계', () => {
  const y = (m: number) => ({ 연도: 2000, 기준일: '', 기준가: 1, 완결: true, '상승률%': 0, '낙폭%': m, 'MDD%': m, '수익률%': m, MDD_고점일: '', MDD_저점일: '' });
  it('0%·5%는 "5% 이하", 5.01%는 "5% ~ 10%", 80%는 "70% ~ 80%", 80.01%는 "80% 이상", 구간 10개', () => {
    const f = frequencyTable([y(0), y(-5), y(-5.01), y(-80), y(-80.01)]);
    expect(f.length).toBe(10);
    const m = Object.fromEntries(f.map((r) => [r.구간, r.횟수]));
    expect(m['5% 이하']).toBe(2); expect(m['5% ~ 10%']).toBe(1); expect(m['70% ~ 80%']).toBe(1); expect(m['80% 이상']).toBe(1);
  });
});
describe('빈도표 -100%', () => {
  it('완전 소멸(-100%)은 마지막 구간', () => {
    const f = frequencyTable([{ 연도: 2000, 기준일: '', 기준가: 1, 완결: true, '상승률%': 0, '낙폭%': -100, 'MDD%': -100, '수익률%': -100, MDD_고점일: '', MDD_저점일: '' }]);
    expect(f[f.length - 1].횟수).toBe(1);
  });
});
