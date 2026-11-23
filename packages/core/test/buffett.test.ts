import { describe, it, expect } from 'vitest';
import cfgJson from '../../../config/buffett.json';
import { computeCalc, decide, judgeQuant, buildLlmInput, dcfEquity, oeCagr, type BuffettInput, type Config, type LlmJudgement } from '../src/buffett/engine';
import { judgeBand } from '../src/common/util';
import { fixture } from './fixtures';

const cfg = cfgJson as unknown as Config;

const pass = (원인: any = '해당없음'): LlmJudgement => ({
  G1: { 상태: '통과', 근거: '이해 가능', 등급: 'A' }, G3: { 상태: '통과', 근거: '적자 없음', 등급: 'A', 원인 }, G6: { 상태: '통과', 근거: '양호', 등급: 'A' },
});

describe('구간 판정 경계값(A-7-1 경계 규칙)', () => {
  const roic = cfg.일반.G2.ROIC_10년평균, sd = cfg.일반.G2.영업이익률_표준편차, icr = cfg.일반.G5.이자보상배율, dec = cfg.일반.G2.ROIC_하락연도수;
  it.each([
    [12, '통과'], [11.999, '조건부'], [9.6, '조건부'], [9.599, '탈락'],
  ])('ROIC %s → %s', (v, e) => expect(judgeBand(v as number, roic)).toBe(e));
  it.each([[5, '통과'], [5.0001, '조건부'], [7.5, '조건부'], [7.5001, '탈락']])('영업이익률 표준편차 %s → %s', (v, e) => expect(judgeBand(v as number, sd)).toBe(e));
  it.each([[8, '통과'], [7.99, '조건부'], [3, '조건부'], [2.99, '탈락']])('이자보상배율 %s → %s', (v, e) => expect(judgeBand(v as number, icr)).toBe(e));
  it.each([[3, '통과'], [4, '조건부'], [5, '조건부'], [6, '탈락']])('ROIC 하락 연도 %s → %s', (v, e) => expect(judgeBand(v as number, dec)).toBe(e));
  it('금융업 표도 같은 경계 규칙', () => {
    expect(judgeBand(1.0, cfg.금융업.G2.은행_ROA_10년평균)).toBe('통과');
    expect(judgeBand(0.8, cfg.금융업.G2.은행_ROA_10년평균)).toBe('조건부');
    expect(judgeBand(97, cfg.금융업.G2.보험_합산비율_10년평균)).toBe('통과');
    expect(judgeBand(100, cfg.금융업.G2.보험_합산비율_10년평균)).toBe('조건부');
    expect(judgeBand(100.01, cfg.금융업.G2.보험_합산비율_10년평균)).toBe('탈락');
  });
});

describe('계산(G7·G8)', () => {
  it('DCF 수식', () => {
    // 성장 0, r=10, g=0 → 영구연금 = OE/r
    expect(dcfEquity(100, 0, 10, 0, 0, 0)).toBeCloseTo(1000, 6);
  });
  it('CAGR: 첫 3년 평균→마지막 3년 평균, 기간 N−3', () => {
    const s = [100, 100, 100, 121, 121, 121];
    expect(oeCagr(s)!).toBeCloseTo(((121 / 100) ** (1 / 3) - 1) * 100, 9);
    expect(oeCagr([-5, 1, 1, 2])).toBeNull();
  });
  it('순현금 기업은 순부채 비율 2개 통과', () => {
    const inp = fixture();
    const c = computeCalc(inp, cfg);
    expect(c.순부채!).toBeLessThan(0);
    const q = judgeQuant(inp, c, cfg);
    expect(q.G5.지표!.순부채_EBITDA.구간).toBe('통과');
  });
  it('G9 후보값 두 개를 계산하고 LLM 입력에서는 확정값을 뺀다', () => {
    const inp = fixture();
    const c = computeCalc(inp, cfg);
    expect(c.매수검토가격_후보['25%']).not.toBeNull();
    expect(c.매수검토가격_후보['35%']!).toBeLessThan(c.매수검토가격_후보['25%']!);
    const li = buildLlmInput(inp, c) as any;
    expect(JSON.stringify(li)).not.toContain('요구안전마진%"');
    expect(JSON.stringify(li)).not.toContain('주당_매수검토가격"');
    expect(li.계산값['후보값(판정 전)']).toBeTruthy();
  });
});

describe('결정표 A-5 (위에서부터 첫 일치)', () => {
  it('LLM 전: 정량 관문만 판정 → 판단 불가(④)', () => {
    const inp = fixture(); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, null);
    expect(d.정량만).toBe(true);
    expect(d.판정).toBe('판단 불가');
    expect(d.결정표_줄).toBe(4);
  });
  it('① G1 탈락 → 제외(능력범위 밖)', () => {
    const inp = fixture(); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, { ...pass(), G1: { 상태: '탈락', 근거: 'x', 등급: 'A' } });
    expect([d.판정, d.결정표_줄]).toEqual(['제외', 1]);
  });
  it('② G5 탈락 → 제외 (이자보상배율 < 3)', () => {
    const inp = fixture({ debt: 5000 });
    inp.재무_10년.forEach((y) => (y.이자비용 = 200));
    const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, pass());
    expect(d.관문.G5.상태).toBe('탈락');
    expect([d.판정, d.결정표_줄]).toEqual(['제외', 2]);
  });
  it('③ G6 탈락 → 제외', () => {
    const inp = fixture(); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, { ...pass(), G6: { 상태: '탈락', 근거: '물적분할', 등급: 'A' } });
    expect([d.판정, d.결정표_줄]).toEqual(['제외', 3]);
  });
  it('③ G3 적자 2회 → 탈락 → 제외', () => {
    const inp = fixture({ deficit: [3, 5] }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, pass());
    expect(d.관문.G3.상태).toBe('탈락');
    expect(d.결정표_줄).toBe(3);
  });
  it('G3 적자 1회: 일회성 → 조건부, 구조적 → 탈락, 원인 불명 → 판단불가', () => {
    const inp = fixture({ deficit: [4] }); const c = computeCalc(inp, cfg);
    expect(decide(inp, c, cfg, pass('일회성')).관문.G3.상태).toBe('조건부');
    expect(decide(inp, c, cfg, pass('구조적')).관문.G3.상태).toBe('탈락');
    expect(decide(inp, c, cfg, pass('판단불가')).관문.G3.상태).toBe('판단불가');
  });
  it('⑥ 현재가 ≤ 매수검토가격 → 매수 검토, 요구 안전마진 25%(조건부 0개)', () => {
    const inp = fixture({ price: 1 }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, pass());
    expect(d.조건부_개수).toBe(0);
    expect(d['요구안전마진%']).toBe(25);
    expect([d.판정, d.결정표_줄]).toEqual(['매수 검토', 6]);
    expect(d.주당_매수검토가격).toBeCloseTo(c.매수검토가격_후보['25%']!, 9);
  });
  it('⑦ 현재가 > 매수검토가격 → 관심 종목(가격 대기)', () => {
    const inp = fixture({ price: 100000 }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, pass());
    expect([d.판정, d.결정표_줄]).toEqual(['관심 종목(가격 대기)', 7]);
    expect(d.주당_매수검토가격).not.toBeNull();
  });
  it('조건부 1개 → 요구 안전마진 35%, 매수검토가격은 35% 후보값', () => {
    const inp = fixture({ price: 1 }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, { ...pass(), G6: { 상태: '조건부', 근거: '희석', 등급: 'A' } });
    expect(d['요구안전마진%']).toBe(35);
    expect(d.주당_매수검토가격).toBeCloseTo(c.매수검토가격_후보['35%']!, 9);
  });
  it('⑤ 조건부 2개 이상 → 관심 종목, 매수검토가격 미제시', () => {
    const inp = fixture({ price: 1 }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, { G1: { 상태: '조건부', 근거: 'x', 등급: 'A' }, G3: { 상태: '통과', 근거: '', 등급: 'A', 원인: '해당없음' }, G6: { 상태: '조건부', 근거: 'x', 등급: 'A' } });
    expect([d.판정, d.결정표_줄]).toEqual(['관심 종목', 5]);
    expect(d.주당_매수검토가격).toBeNull();
    expect(d['요구안전마진%']).toBeNull();
  });
  it('④ 데이터 5년 미만 → G2·G3 판단불가 → 판단 불가', () => {
    const inp = fixture({ years: 4 }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, pass());
    expect(d.관문.G2.상태).toBe('판단불가');
    expect(d.판정).toBe('판단 불가');
  });
  it('④ 정규화 오너 어닝 ≤ 0 → G8 판단불가', () => {
    const inp = fixture({ niMul: -1 }); const c = computeCalc(inp, cfg);
    expect(c.정규화오너어닝_양수).toBe(false);
  });
  it('JSON 형식 오류(상태 값 이상) → 해당 관문 판단불가', () => {
    const inp = fixture(); const c = computeCalc(inp, cfg);
    const bad = { G1: { 상태: '좋음', 근거: 1 } } as unknown as LlmJudgement;
    const d = decide(inp, c, cfg, bad);
    expect(d.관문.G1.상태).toBe('판단불가');
    expect(d.관문.G6.상태).toBe('판단불가');
  });
  it('LLM 본문에 다른 최종 판정 → 불일치 경고', () => {
    const inp = fixture({ price: 100000 }); const c = computeCalc(inp, cfg);
    const d = decide(inp, c, cfg, pass(), '최종 판정: 매수 검토');
    expect(d.경고.some((w) => w.includes('LLM 판정 불일치'))).toBe(true);
  });
  it('확신도: 가격 근거가 C급이면 상 불가, 지주사는 하, 금융업은 최대 중', () => {
    const inp = fixture({ price: 1 }); inp.근거등급!.가격 = 'C';
    expect(decide(inp, computeCalc(inp, cfg), cfg, pass()).확신도).toBe('하');
    const a = fixture({ price: 1 });
    expect(decide(a, computeCalc(a, cfg), cfg, pass()).확신도).toBe('상');
    const h = fixture({ price: 1, type: '지주사' });
    expect(decide(h, computeCalc(h, cfg), cfg, pass()).확신도).toBe('하');
  });
});
