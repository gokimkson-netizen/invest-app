// M6 중대 뉴스 — 중요도는 코드가 규칙(config/news_rules.json)으로 정한다. LLM은 정하지 않는다.
export type Level = '참고' | '보통' | '높음' | '긴급';
export const LEVELS: Level[] = ['참고', '보통', '높음', '긴급'];
const lv = (l: Level) => LEVELS.indexOf(l);
const maxL = (a: Level, b: Level): Level => (lv(a) >= lv(b) ? a : b);
const minL = (a: Level, b: Level): Level => (lv(a) <= lv(b) ? a : b);
const up = (l: Level, cap: Level): Level => minL(LEVELS[Math.min(3, lv(l) + 1)], maxL(cap, l));

export interface NewsItem {
  id: string; title: string; summary?: string | null; source: string; domain: string; grade: 'A' | 'B' | 'C';
  url: string; published: string; kind: 'official' | 'filing' | 'media'; market: 'US' | 'KR';
  tickers?: string[];
}
export interface EventType { id: string; 이름: string; 범위: string; 기본: Level; 가족?: string; 지표?: string; keywords: { ko: string[]; en: string[] }; exclude: { ko: string[]; en: string[] } }
export interface Rules {
  version: string; speculation: { ko: string[]; en: string[] }; event_types: EventType[];
  speculation_type: { id: string; 이름: string; 범위: string; 기본: Level };
  unscheduled_rate_decision: { 적용유형: string[]; 결과: Level; 허용일수: number; 설명: string };
  indicator_surprise: { 기준: Record<string, { 종류: '전월비%' | '증감차'; 임계: number }> };
  relevance: { 상한: Level }; c_only_cap: Level; cluster: { jaccard: number; hours: number }; retention_days: number;
}
export interface UniverseEntry { ticker: string; name: string; name_ko?: string; market: string; sector?: string; top_cap?: boolean }
export interface CalendarEvent { date: string; type: string; 기관?: string; 이름: string }
export interface IndicatorObs { series: string; latest?: { date: string; value: number; realtime_start?: string } | null; previous?: { date: string; value: number } | null }

export interface Classification { 유형: string | null; 유형이름: string | null; 범위: string; 기본: Level; 규칙: string[] }

const ascii = (s: string) => /^[\x00-\x7f]+$/.test(s);
function hit(text: string, kw: string): boolean {
  if (!kw) return false;
  if (ascii(kw) && /^[A-Za-z0-9 .\-]+$/.test(kw.trim())) {
    const esc = kw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i').test(text);
  }
  return text.toLowerCase().includes(kw.toLowerCase());
}
const any = (text: string, kws: string[]) => kws.some((k) => hit(text, k));

export function classify(item: NewsItem, rules: Rules): Classification {
  const text = `${item.title}\n${item.summary ?? ''}`;
  const spec = any(text, [...rules.speculation.ko, ...rules.speculation.en]);
  let rateMention = false;
  for (const et of rules.event_types) {
    const kw = [...et.keywords.ko, ...et.keywords.en];
    if (!any(text, kw)) continue;
    if (et.가족 === 'rate') rateMention = true;
    if (any(text, [...et.exclude.ko, ...et.exclude.en])) continue;
    if (spec && et.가족 === 'rate' && et.id !== 'fomc_statement') continue; // 전망·가능성은 결정이 아님
    if (spec && !et.가족 && item.kind === 'media') {
      return { 유형: et.id, 유형이름: et.이름, 범위: et.범위, 기본: LEVELS[Math.max(0, lv(et.기본) - 1)], 규칙: [`①사건유형:${et.이름}`, '①추측 표현 → 한 단계 낮춤'] };
    }
    return { 유형: et.id, 유형이름: et.이름, 범위: et.범위, 기본: et.기본, 규칙: [`①사건유형:${et.이름}`, `②영향범위:${et.범위}`] };
  }
  if (rateMention || (spec && /금리|rate/i.test(text))) {
    const s = rules.speculation_type;
    return { 유형: s.id, 유형이름: s.이름, 범위: s.범위, 기본: s.기본, 규칙: [`①사건유형:${s.이름}`, '①전망·가능성 표현(결정 아님)'] };
  }
  return { 유형: null, 유형이름: null, 범위: '개별', 기본: '참고', 규칙: ['①해당 사건 유형 없음'] };
}

// ───── 묶기(제목 유사도 + 시간 근접) ─────
function grams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const out = new Set<string>();
  for (const w of t.split(' ')) {
    if (!w) continue;
    if (/[ㄱ-힝]/.test(w)) { for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); if (w.length === 1) out.add(w); }
    else out.add(w);
  }
  return out;
}
export function jaccard(a: string, b: string): number {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

export interface Cluster { id: string; items: NewsItem[]; rep: NewsItem }
const GR = { A: 3, B: 2, C: 1 } as const;
export function clusterItems(items: NewsItem[], rules: Rules): Cluster[] {
  const sorted = [...items].sort((a, b) => a.published.localeCompare(b.published));
  const cl: Cluster[] = [];
  for (const it of sorted) {
    const t = Date.parse(it.published);
    const c = cl.find((c) => c.items.some((x) => Math.abs(Date.parse(x.published) - t) <= rules.cluster.hours * 3600e3 && jaccard(x.title, it.title) >= rules.cluster.jaccard));
    if (c) c.items.push(it); else cl.push({ id: it.id, items: [it], rep: it });
  }
  for (const c of cl) {
    c.rep = [...c.items].sort((a, b) => GR[b.grade] - GR[a.grade] || a.published.localeCompare(b.published))[0];
    c.id = c.rep.id;
  }
  return cl;
}

// ───── 관련 종목 매칭(유니버스) ─────
export function matchTickers(item: NewsItem, uni: UniverseEntry[]): UniverseEntry[] {
  const pre = new Set(item.tickers ?? []);
  const text = `${item.title} ${item.summary ?? ''}`;
  return uni.filter((u) => pre.has(u.ticker) || (u.name.length >= 4 && hit(text, u.name)) || (!!u.name_ko && u.name_ko.length >= 2 && text.includes(u.name_ko)));
}

export interface SurpriseResult { 상태: '해당' | '비해당' | '확인 중' | '해당없음'; 설명: string }
function surprise(cls: Classification, item: NewsItem, rules: Rules, cal: CalendarEvent[], obs: Record<string, IndicatorObs>): SurpriseResult {
  const u = rules.unscheduled_rate_decision;
  if (cls.유형 && u.적용유형.includes(cls.유형) && item.kind === 'official') {
    const t = Date.parse(item.published.slice(0, 10));
    const sched = cal.some((e) => e.type === 'rate_decision' && Math.abs(Date.parse(e.date) - t) <= u.허용일수 * 864e5);
    return sched ? { 상태: '비해당', 설명: '공식 일정표에 있던 결정' } : { 상태: '해당', 설명: u.설명 };
  }
  const et = rules.event_types.find((e) => e.id === cls.유형);
  if (et?.지표) {
    const o = obs[et.지표];
    const th = rules.indicator_surprise.기준[et.지표];
    if (!o || !o.latest || !o.previous || !th) return { 상태: '확인 중', 설명: '공식 API에 아직 반영되지 않음 — 다음 배치에서 다시 판정' };
    if (o.latest.realtime_start && o.latest.realtime_start < item.published.slice(0, 10)) return { 상태: '확인 중', 설명: '발표 직후라 공식 API에 아직 반영되지 않음 — 다음 배치에서 다시 판정' };
    const diff = th.종류 === '전월비%' ? ((o.latest.value / o.previous.value) - 1) * 100 : o.latest.value - o.previous.value;
    const big = Math.abs(diff) >= th.임계;
    return { 상태: big ? '해당' : '비해당', 설명: `직전값 대비 ${th.종류 === '전월비%' ? diff.toFixed(2) + '%' : diff.toFixed(0)} (기준 ${th.임계}) — 시장 예상치가 아닌 직전값 비교` };
  }
  return { 상태: '해당없음', 설명: '' };
}

export interface NewsCard {
  id: string; 대표: NewsItem; 기사: NewsItem[]; 출처목록: { source: string; grade: string; url: string; published: string }[];
  중요도: Level; 걸린규칙: string[]; 유형: string | null; 유형이름: string | null; 범위: string;
  관련종목: string[]; 관련업종: string[]; 확인되지않음: boolean; 예상밖: SurpriseResult; 시장: 'US' | 'KR';
}

export function buildCards(items: NewsItem[], rules: Rules, uni: UniverseEntry[], cal: CalendarEvent[], obs: Record<string, IndicatorObs>, now: Date): NewsCard[] {
  const cutoff = now.getTime() - rules.retention_days * 864e5;
  const fresh = items.filter((i) => Date.parse(i.published) >= cutoff);
  const cards: NewsCard[] = [];
  for (const c of clusterItems(fresh, rules)) {
    const cls = classify(c.rep, rules);
    // 묶음 안 다른 기사가 더 강한 유형이면 그 유형을 쓴다
    let best = cls;
    for (const it of c.items) { const k = classify(it, rules); if (lv(k.기본) > lv(best.기본)) best = k; }
    let level = best.기본;
    const ruleHits = [...best.규칙];
    const sp = surprise(best, c.rep, rules, cal, obs);
    if (sp.상태 === '해당') { level = '긴급'; ruleHits.push(`⑤예상밖:${sp.설명}`); }
    else if (sp.상태 === '확인 중') ruleHits.push('⑤예상밖:확인 중');
    const rel = Array.from(new Map(c.items.flatMap((i) => matchTickers(i, uni)).map((u) => [u.ticker, u])).values());
    if (best.유형 && rel.some((u) => u.top_cap) && level !== '긴급') { const nl = up(level, rules.relevance.상한); if (nl !== level) { level = nl; ruleHits.push('③관련성:시총 상위 유니버스 종목'); } }
    else if (rel.length) ruleHits.push(`③관련성:유니버스 ${rel.length}종목`);
    const grades = c.items.map((i) => i.grade);
    const cOnly = grades.every((g) => g === 'C');
    ruleHits.push(`④출처신뢰도:${[...new Set(grades)].sort().join('·')}급`);
    if (cOnly && lv(level) > lv(rules.c_only_cap)) { level = rules.c_only_cap; ruleHits.push(`④C급 단독 → 최대 '${rules.c_only_cap}'`); }
    if (cOnly && level === '긴급') level = rules.c_only_cap;
    cards.push({
      id: c.id, 대표: c.rep, 기사: c.items,
      출처목록: c.items.map((i) => ({ source: i.source, grade: i.grade, url: i.url, published: i.published })),
      중요도: level, 걸린규칙: ruleHits, 유형: best.유형, 유형이름: best.유형이름, 범위: best.범위,
      관련종목: rel.map((u) => u.ticker), 관련업종: [...new Set(rel.map((u) => u.sector).filter((s): s is string => !!s))],
      확인되지않음: cOnly, 예상밖: sp, 시장: c.rep.market,
    });
  }
  return sortCards(cards);
}

export function sortCards(cards: NewsCard[]): NewsCard[] {
  return [...cards].sort((a, b) => lv(b.중요도) - lv(a.중요도) || b.대표.published.localeCompare(a.대표.published));
}

/** 브라우저에서만: '내 관심종목' 표시 + 위로 올림(배치 중요도는 바꾸지 않는다) */
export function applyWatchlist<T extends NewsCard>(cards: T[], watch: Set<string>): (T & { 내관심: boolean })[] {
  const m = cards.map((c) => ({ ...c, 내관심: c.관련종목.some((t) => watch.has(t)) }));
  return [...m].sort((a, b) => Number(b.내관심) - Number(a.내관심) || lv(b.중요도) - lv(a.중요도) || b.대표.published.localeCompare(a.대표.published));
}

/** M6 LLM 응답 스키마 — 카드 1~6번(7번 출처는 코드가 렌더링) */
export const NEWS_LLM_SCHEMA = {
  type: 'object',
  properties: {
    한줄요약: { type: 'string' },
    중요도이유: { type: 'string' },
    왜중요한가: { type: 'string' },
    누구에게영향: { type: 'string' },
    확인된사실: { type: 'array', items: { type: 'string' } },
    아직모르는것: { type: 'array', items: { type: 'string' } },
    용어풀이: { type: 'array', items: { type: 'object', properties: { 용어: { type: 'string' }, 설명: { type: 'string' } }, required: ['용어', '설명'] } },
    언급종목: { type: 'array', items: { type: 'string' } },
    언급업종: { type: 'array', items: { type: 'string' } },
  },
  required: ['한줄요약', '중요도이유', '왜중요한가', '누구에게영향', '확인된사실', '아직모르는것', '용어풀이', '언급종목', '언급업종'],
} as const;

export interface NewsExplain { 한줄요약: string; 중요도이유: string; 왜중요한가: string; 누구에게영향: string; 확인된사실: string[]; 아직모르는것: string[]; 용어풀이: { 용어: string; 설명: string }[]; 언급종목: string[]; 언급업종: string[] }

/** 10절 28번: LLM 출력의 관련 업종·종목이 코드 매칭 목록과 일치하는지, 3번 항목에 수치·과거 사례가 없는지 */
const SECTORS = ['반도체', '정보기술', 'Information Technology', '금융', 'Financials', '헬스케어', 'Health Care', '에너지', 'Energy', '산업재', 'Industrials', '소재', 'Materials',
  '경기소비재', 'Consumer Discretionary', '필수소비재', 'Consumer Staples', '유틸리티', 'Utilities', '부동산', 'Real Estate', '통신서비스', 'Communication Services', '자동차', '은행', '보험', '건설', '조선', '항공', '화학', '철강', '바이오'];
/** universe를 주면 본문('누구에게영향'·'왜중요한가'·'한줄요약')에서 목록 밖 유니버스 종목·업종명이 쓰였는지도 직접 찾는다 */
export function validateExplain(e: NewsExplain, card: NewsCard, universe: { ticker: string; name: string; name_ko?: string }[] = []): string[] {
  const errs: string[] = [];
  const body = [e.누구에게영향, e.왜중요한가, e.한줄요약].join('\n');
  const src = `${card.대표.title} ${card.대표.summary ?? ''}`;
  for (const u of universe) {
    if (card.관련종목.includes(u.ticker)) continue;
    const names = [u.name.length >= 4 ? u.name : null, u.name_ko && u.name_ko.length >= 2 ? u.name_ko : null, u.ticker.length >= 3 && /^[A-Z.]+$/.test(u.ticker) ? u.ticker : null].filter((x): x is string => !!x);
    const n = names.find((x) => (/^[A-Z.]+$/.test(x) ? new RegExp(`(^|[^A-Za-z])${x.replace('.', '\\.')}([^A-Za-z]|$)`).test(body) : body.includes(x)) && !src.includes(x));
    if (n) errs.push(`본문에 목록 밖 종목: ${n}`);
  }
  for (const sname of SECTORS) if (body.includes(sname) && !card.관련업종.includes(sname) && !src.includes(sname)) errs.push(`본문에 목록 밖 업종: ${sname}`);
  const extraT = e.언급종목.filter((t) => !card.관련종목.includes(t));
  const extraS = e.언급업종.filter((s) => !card.관련업종.includes(s));
  if (extraT.length) errs.push(`목록에 없는 종목: ${extraT.join(', ')}`);
  if (extraS.length) errs.push(`목록에 없는 업종: ${extraS.join(', ')}`);
  if (/\d/.test(e.왜중요한가)) errs.push("'왜 중요한가'에 숫자가 있음");
  if (/(과거|예전|지난\s?\d|역사적으로|당시|사례|in \d{4}|back in)/i.test(e.왜중요한가)) errs.push("'왜 중요한가'에 과거 사례 표현이 있음");
  return errs;
}

export interface RunRec { scheduled: string | null; started: string; manual: boolean; delay_min?: number | null }
/** news.yml cron("분목록 * * * *")에서 분 목록을 읽는다. 형식이 다르면 null */
export function cronMinutes(cron: string): number[] | null {
  const m = cron.trim().match(/^(\d{1,2}(?:,\d{1,2})*) \* \* \* \*$/);
  if (!m) return null;
  const mins = [...new Set(m[1].split(',').map(Number))].sort((a, b) => a - b);
  return mins.every((x) => x >= 0 && x < 60) ? mins : null;
}
/** 예약 실행의 예정 시각 배정(실측 지연). 각 실행은 "시작 시각 이전의 가장 가까운 예정 시각"으로 1차 배정하고,
 *  두 실행이 같은 예정 시각에 배정되면 앞 실행을 그 이전 예정 시각으로 옮긴다(간격보다 오래 늦은 실행이 지연을 작게 기록하는 문제 방지).
 *  수동 실행은 지연 계산에서 뺀다. */
export function assignRunSlots(runs: RunRec[], minutes: number[]): (RunRec & { delay_min: number | null })[] {
  const M = 60e3, H = 60 * M;
  const prevSlot = (t: number) => { // t 이하의 가장 가까운 예정 시각
    const h = Math.floor(t / H) * H;
    for (let k = 0; k < 3; k++) { const base = h - k * H; for (const m of [...minutes].reverse()) if (base + m * M <= t) return base + m * M; }
    return t;
  };
  const sorted = [...runs].sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
  const auto = sorted.filter((r) => !r.manual);
  const slots = auto.map((r) => prevSlot(Date.parse(r.started)));
  for (let i = slots.length - 2; i >= 0; i--) if (slots[i] >= slots[i + 1]) slots[i] = prevSlot(slots[i + 1] - 1);
  const bySlot = new Map(auto.map((r, i) => [r, slots[i]]));
  return sorted.map((r) => { const s = bySlot.get(r); return s === undefined ? { ...r, scheduled: null, delay_min: null } : { ...r, scheduled: new Date(s).toISOString(), delay_min: Math.round((Date.parse(r.started) - s) / 60000) }; });
}
/** 최근 24시간 통계: 실행된 예정 시각 수 / 예상 수, 최대 지연, 건너뛴(실행되지 않은) 예정 시각 수 */
export function runStats(runs: (RunRec & { delay_min: number | null })[], now: number, perHour = 1): { 실행수: number; 예상: number; 실행률: number; 최대지연분: number | null; 건너뜀: number } {
  const exp = 24 * perHour;
  const d24 = runs.filter((r) => !r.manual && r.scheduled && Date.parse(r.scheduled) >= now - 864e5);
  const slots = new Set(d24.map((r) => r.scheduled));
  return { 실행수: slots.size, 예상: exp, 실행률: Math.round((Math.min(exp, slots.size) / exp) * 100), 최대지연분: d24.length ? Math.max(...d24.map((r) => r.delay_min ?? 0)) : null, 건너뜀: Math.max(0, exp - slots.size) };
}
