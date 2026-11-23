import { describe, it, expect } from 'vitest';
import rulesJson from '../../../config/news_rules.json';
import { classify, buildCards, clusterItems, applyWatchlist, validateExplain, type Rules, type NewsItem, type UniverseEntry } from '../src/news/news';

const rules = rulesJson as unknown as Rules;
const now = new Date('2026-11-23T06:00:00Z');
let n = 0;
const it_ = (title: string, o: Partial<NewsItem> = {}): NewsItem => ({ id: `n${++n}`, title, summary: null, source: o.source ?? '연합뉴스', domain: 'x', grade: o.grade ?? 'B', url: `https://example.com/${n}`, published: o.published ?? '2026-11-23T01:00:00Z', kind: o.kind ?? 'media', market: o.market ?? 'KR', ...o });
const uni: UniverseEntry[] = [{ ticker: 'NVDA', name: 'NVIDIA', market: 'US', sector: '반도체', top_cap: true }, { ticker: '005930.KS', name: 'Samsung Electronics', name_ko: '삼성전자', market: 'KR', sector: '반도체', top_cap: true }, { ticker: 'XYZ', name: 'Xyzcorp Inc', market: 'US', sector: '산업재' }];
const cal = [{ date: '2026-12-09', type: 'rate_decision', 이름: 'FOMC' }];

describe('사건 유형 픽스처 → 정해진 등급(10절 22번)', () => {
  it.each([
    ['한국은행, 기준금리 인상…3.25%', 'rate_hike'],
    ['Fed cuts rates by a quarter point', 'rate_cut'],
    ['미국 소비자물가(CPI) 발표', 'cpi'],
    ['삼성전자 매매거래정지 공시', 'trading_halt'],
    ['XYZ 상장폐지 결정', 'delisting'],
    ['러시아 추가 제재 발표', 'war_sanction'],
  ])('%s → %s', (t, id) => expect(classify(it_(t), rules).유형).toBe(id));
  it('오탐 반례: "금리 인상 가능성 낮아" → 금리 인상 아님', () => {
    const c = classify(it_('한은 총재 "금리 인상 가능성 낮아"'), rules);
    expect(c.유형).not.toBe('rate_hike'); expect(c.유형).toBe('rate_outlook');
  });
  it('오탐 반례: "금리 동결" → 동결(인상 아님)', () => {
    const c = classify(it_('한국은행 기준금리 동결'), rules);
    expect(c.유형).toBe('rate_hold');
  });
  it('공식 일정표에 없던 금리 결정(A급 공식 발표) = 긴급', () => {
    const cards = buildCards([it_('Federal Reserve cuts rates in emergency move', { grade: 'A', kind: 'official', market: 'US', published: '2026-11-22T12:00:00Z' })], rules, uni, cal, {}, now);
    expect(cards[0].중요도).toBe('긴급');
    expect(cards[0].걸린규칙.some((r) => r.startsWith('⑤예상밖'))).toBe(true);
  });
  it('일정표에 있던 금리 결정 = 높음', () => {
    const cards = buildCards([it_('Fed cuts rates', { grade: 'A', kind: 'official', market: 'US', published: '2026-12-09T19:00:00Z' })], rules, uni, cal, {}, new Date('2026-12-10T00:00:00Z'));
    expect(cards[0].중요도).toBe('높음');
  });
  it('C급 단독 뉴스는 긴급이 될 수 없다(최대 보통, 확인되지 않음)', () => {
    const cards = buildCards([it_('Fed cuts rates in surprise move', { grade: 'C', kind: 'official', market: 'US', published: '2026-11-22T12:00:00Z' })], rules, uni, cal, {}, now);
    expect(cards[0].중요도).toBe('보통'); expect(cards[0].확인되지않음).toBe(true);
  });
  it('시총 상위 유니버스 종목 관련 → 한 단계 가중', () => {
    const cards = buildCards([it_('NVIDIA announces merger agreement', { market: 'US' })], rules, uni, cal, {}, now);
    expect(cards[0].중요도).toBe('높음'); expect(cards[0].관련종목).toEqual(['NVDA']);
  });
  it('지표 ⑤: API 미반영이면 확인 중', () => {
    const cards = buildCards([it_('Consumer Price Index for October 2026', { grade: 'A', kind: 'official', market: 'US' })], rules, uni, cal, {}, now);
    expect(cards[0].예상밖.상태).toBe('확인 중');
  });
  it('지표 ⑤: 직전값 대비 큰 변화 → 긴급', () => {
    const obs = { CPIAUCSL: { series: 'CPIAUCSL', latest: { date: '2026-10-01', value: 330, realtime_start: '2026-11-23' }, previous: { date: '2026-09-01', value: 327 } } };
    const cards = buildCards([it_('Consumer Price Index for October 2026', { grade: 'A', kind: 'official', market: 'US' })], rules, uni, cal, obs, now);
    expect(cards[0].중요도).toBe('긴급');
  });
});

describe('같은 사건 기사 묶기(10절 23번)', () => {
  it('중복 픽스처 → 1개 묶음, 대표 = 최고 등급', () => {
    const a = it_('삼성전자 3분기 잠정실적 발표 영업이익 증가', { grade: 'C', published: '2026-11-23T01:00:00Z' });
    const b = it_('삼성전자 3분기 잠정실적 발표…영업이익 증가', { grade: 'A', source: 'DART', kind: 'filing', published: '2026-11-23T02:00:00Z' });
    const c = it_('삼성전자, 3분기 잠정실적 발표 영업이익 증가세', { grade: 'B', published: '2026-11-23T03:00:00Z' });
    const d = it_('국제유가 급락', { published: '2026-11-23T02:00:00Z' });
    const cl = clusterItems([a, b, c, d], rules);
    expect(cl).toHaveLength(2);
    const big = cl.find((x) => x.items.length === 3)!;
    expect(big.rep.grade).toBe('A');
  });
  it('보관 기간(7일) 밖 기사는 제외', () => {
    const cards = buildCards([it_('옛 뉴스', { published: '2026-11-10T00:00:00Z' })], rules, uni, cal, {}, now);
    expect(cards).toHaveLength(0);
  });
});

describe('브라우저 관심종목 표시(배치 중요도 불변)', () => {
  it('내 관심종목은 위로, 중요도는 그대로', () => {
    const cards = buildCards([it_('러시아 추가 제재 발표'), it_('Xyzcorp Inc announces merger agreement', { market: 'US' })], rules, uni, cal, {}, now);
    const before = cards.map((c) => [c.id, c.중요도]);
    const w = applyWatchlist(cards, new Set(['XYZ']));
    expect(w[0].관련종목).toContain('XYZ'); expect(w[0].내관심).toBe(true);
    expect(w.map((c) => [c.id, c.중요도]).sort()).toEqual(before.sort());
  });
});

describe('LLM 해설 검증(10절 28번)', () => {
  it('목록에 없는 종목·업종, 3번 항목의 수치·과거 사례 → 오류', () => {
    const card = buildCards([it_('NVIDIA announces merger agreement', { market: 'US' })], rules, uni, cal, {}, now)[0];
    const ok = validateExplain({ 한줄요약: '', 중요도이유: '', 왜중요한가: '회사 구조가 바뀔 수 있습니다.', 누구에게영향: '', 확인된사실: [], 아직모르는것: [], 용어풀이: [], 언급종목: ['NVDA'], 언급업종: ['반도체'] }, card);
    expect(ok).toEqual([]);
    const bad = validateExplain({ 한줄요약: '', 중요도이유: '', 왜중요한가: '과거 2008년처럼 30% 오를 수 있습니다.', 누구에게영향: '', 확인된사실: [], 아직모르는것: [], 용어풀이: [], 언급종목: ['AMD'], 언급업종: ['자동차'] }, card);
    expect(bad.length).toBe(4);
  });
  it('본문에 쓴 목록 밖 종목·업종도 직접 찾아낸다', () => {
    const card = buildCards([it_('NVIDIA announces merger agreement', { market: 'US' })], rules, uni, cal, {}, now)[0];
    const sneaky = validateExplain({ 한줄요약: '', 중요도이유: '', 왜중요한가: '', 누구에게영향: '삼성전자와 자동차 업종에도 영향이 있을 수 있습니다.', 확인된사실: [], 아직모르는것: [], 용어풀이: [], 언급종목: ['NVDA'], 언급업종: ['반도체'] }, card, uni);
    expect(sneaky.some((x) => x.includes('삼성전자'))).toBe(true);
    expect(sneaky.some((x) => x.includes('자동차'))).toBe(true);
  });
});

import { assignRunSlots, runStats, cronMinutes } from '../src/news/news';
describe('뉴스 실행 지연 실측(60분 넘는 지연도 바르게)', () => {
  it('8:07 실행이 9:20에 시작하고 9:07 실행이 9:25에 시작하면 앞 실행 지연은 73분', () => {
    const r = assignRunSlots([{ scheduled: null, started: '2026-11-23T09:20:00Z', manual: false }, { scheduled: null, started: '2026-11-23T09:25:00Z', manual: false }], [7]);
    expect(r.map((x) => x.delay_min)).toEqual([73, 18]);
    expect(r[0].scheduled).toBe('2026-11-23T08:07:00.000Z');
  });
  it('수동 실행은 지연 계산에서 빠지고, 건너뛴 예정 시각을 센다', () => {
    const runs = assignRunSlots([
      { scheduled: null, started: '2026-11-23T07:10:00Z', manual: false },
      { scheduled: null, started: '2026-11-23T07:30:00Z', manual: true },
      { scheduled: null, started: '2026-11-23T09:12:00Z', manual: false },
    ], [7]);
    expect(runs[1].delay_min).toBeNull();
    const s = runStats(runs, Date.parse('2026-11-23T10:00:00Z'));
    expect(s.실행수).toBe(2); expect(s.건너뜀).toBe(22); expect(s.최대지연분).toBe(5);
  });
});
describe('cron 분 목록', () => {
  it('읽기', () => { expect(cronMinutes('7 * * * *')).toEqual([7]); expect(cronMinutes('7,37 * * * *')).toEqual([7, 37]); expect(cronMinutes('*/5 * * * *')).toBeNull(); });
  it('30분 간격: 7:07 예정이 7:50에 시작하고 7:37 예정이 7:55에 시작하면 지연 43·18분', () => {
    const r = assignRunSlots([{ scheduled: null, started: '2026-11-23T07:50:00Z', manual: false }, { scheduled: null, started: '2026-11-23T07:55:00Z', manual: false }], [7, 37]);
    expect(r.map((v) => v.delay_min)).toEqual([43, 18]);
    expect(runStats(r, Date.parse('2026-11-23T08:00:00Z'), 2).예상).toBe(48);
  });
});
