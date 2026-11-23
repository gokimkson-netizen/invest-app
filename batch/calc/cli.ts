// 배치 계산 CLI — 공용 계산 모듈(packages/core)을 Node에서 호출한다(3-8절: 계산은 한 벌).
// 파이썬 수집기가 원본을 work/raw 에 내려받으면, 이 CLI가 파싱·정규화·계산·암호화를 한다.
// 로그에는 URL·키·응답 원문을 출력하지 않는다(4-4절).
import fs from 'node:fs';
import path from 'node:path';
import { type Config } from '../../packages/core/src/buffett/engine';
import { assembleM1 } from '../../packages/core/src/buffett/assemble';
import { summarize, currentDrawdown, frequencyTable, type Bar } from '../../packages/core/src/mdd/mdd';
import { normalizeCompanyFacts, latestEarnings, type CompanyFacts } from '../../packages/core/src/sec/facts';
import { berkshireFor, aggregate, type Filing13F, type Form4 } from '../../packages/core/src/sec/berkshire';
import { priceEvidence, earningsEvidence } from '../../packages/core/src/m2/report';
import { buildCards, type NewsItem, type Rules, type UniverseEntry, type IndicatorObs, assignRunSlots, runStats, type RunRec, cronMinutes } from '../../packages/core/src/news/news';
import { extractItem1, extractProxy, htmlToText, parse13FInfoTable, parse13FCover, parseForm4, parseFeed, parseDartList, parseDartAccounts, mergeBars, parseStooqCsv, parseTiingo } from '../../packages/core/src/parse/parsers';
import { checkNumbers, summarizeFindings } from '../../packages/core/src/common/numcheck';
import { marketDayStatus, type Market } from '../../packages/core/src/common/calendar';
import { importDataKey, sealData, openData, isEnvelope } from '../../packages/core/src/common/crypto';
import cfgBuffett from '../../config/buffett.json';
import newsRules from '../../config/news_rules.json';
import newsSources from '../../config/news_sources.json';
import econCal from '../../config/econ_calendar.json';
import publishCfg from '../../config/publish.json';
import universeCfg from '../../config/universe.json';

const cfg = cfgBuffett as unknown as Config;
const log = (m: string) => process.stdout.write(`[calc] ${m}\n`);
const rj = <T = any>(p: string, d: T | null = null): T | null => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return d; } };
const wj = (p: string, o: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const ex = (p: string) => fs.existsSync(p);
const ls = (p: string) => (ex(p) ? fs.readdirSync(p) : []);
export const safe = (t: string) => t.replace(/[^A-Za-z0-9._-]/g, '_');
const nowIso = () => new Date().toISOString();

interface UniItem { ticker: string; name: string; name_ko?: string; market: 'US' | 'KR' | 'CRYPTO'; kind: 'stock' | 'etf' | 'crypto'; indices: string[]; sector?: string; cik?: string; cusips?: string[]; corp_code?: string; top_cap?: boolean; m1?: boolean }
interface RawPrice { ticker: string; source: string; grade: string; bars: Bar[]; full: boolean; error?: string | null }

// ───────── 공통: 가격 병합(M3 상태 = data/m3/{mkt}/sym) ─────────
function priceMarket(u: UniItem): 'us' | 'kr' { return u.market === 'KR' ? 'kr' : 'us'; }
function loadBars(prev: string, u: UniItem): Bar[] {
  const o = rj<{ bars?: [string, number, number?, number?, number?][] }>(path.join(prev, `data/m3/${priceMarket(u)}/sym/${safe(u.ticker)}.json`));
  return (o?.bars ?? []).map(([d, c, h, l, v]) => ({ d, c, h: h ?? undefined, l: l ?? undefined, v: v ?? undefined }));
}
const pack = (bars: Bar[]) => bars.map((b) => [b.d, b.c, b.h ?? null, b.l ?? null, b.v ?? null]);

interface Status { batch: string; 수집시각UTC: string; 기준일: string | null; 휴장: boolean; 휴장사유: string | null; 성공: Record<string, number>; 실패: { 모듈: string; 대상: string; 사유: string }[] }
function newStatus(batch: string, market: Market): Status {
  const ds = marketDayStatus(new Date(), market);
  return { batch, 수집시각UTC: nowIso(), 기준일: null, 휴장: ds.휴장, 휴장사유: ds.사유, 성공: {}, 실패: [] };
}
const fail = (s: Status, 모듈: string, 대상: string, 사유: string) => { if (s.실패.length < 500) s.실패.push({ 모듈, 대상, 사유: 사유.slice(0, 200) }); };
const ok = (s: Status, m: string) => { s.성공[m] = (s.성공[m] ?? 0) + 1; };

/** 파이썬이 저장한 원문(prices_src)을 공용 TS 파서로 변환 */
function readRawPrice(raw: string, mkt: string, u: UniItem): RawPrice | null {
  const base = path.join(raw, 'prices_src', mkt, safe(u.ticker));
  const meta = rj<{ source: string | null; grade: string | null; format: string | null; full: boolean; error?: string }>(base + '.meta.json');
  if (!meta) return null;
  if (!meta.format) return { ticker: u.ticker, source: '', grade: '', bars: [], full: meta.full, error: meta.error ?? '데이터 없음' };
  const r = meta.format === 'stooq' ? parseStooqCsv(fs.readFileSync(base + '.csv', 'utf8')) : parseTiingo(JSON.parse(fs.readFileSync(base + '.json', 'utf8')));
  return { ticker: u.ticker, source: meta.source ?? '', grade: meta.grade ?? 'C', bars: r.bars, full: meta.full, error: r.error };
}

// ───────── M3 ─────────
function buildM3(raw: string, prev: string, out: string, uni: UniItem[], mkt: 'us' | 'kr', st: Status) {
  const rows: Record<string, unknown>[] = [];
  let maxDate: string | null = null;
  for (const u of uni.filter((x) => priceMarket(x) === mkt)) {
    try {
      const rp = readRawPrice(raw, mkt, u);
      const old = loadBars(prev, u);
      const prevSym = rj<{ 출처?: string; 등급?: string; needFull?: boolean }>(path.join(prev, `data/m3/${mkt}/sym/${safe(u.ticker)}.json`)) ?? {};
      let bars = old, src = prevSym.출처 ?? null, grade = prevSym.등급 ?? 'C', err: string | null = null;
      // 직전 실행에서 전체 재수집을 요청했는데 이번에도 전체 데이터를 못 받았으면 요청을 유지
      let needFull = !!prevSym.needFull && !(rp && rp.full && !rp.error && rp.bars.length);
      if (rp && !rp.error && rp.bars.length) {
        const mg = rp.full ? { bars: rp.bars, needFull: false } : mergeBars(old, rp.bars);
        if (mg.needFull) {
          // 분할·배당으로 과거 수정주가가 바뀜 → 서로 다른 기준의 봉을 섞지 않는다. 직전(일관된) 데이터를 유지하고 다음 실행에서 전체 재수집
          needFull = true;
          err = '수정주가 변경 감지 — 직전 데이터 유지, 다음 실행에서 전체 재수집';
          fail(st, 'M3', u.ticker, err);
        } else { bars = mg.bars; src = rp.source; grade = rp.grade; }
      } else if (rp?.error) err = rp.error;
      if (!bars.length) { rows.push({ ticker: u.ticker, name: u.name, kind: u.kind, indices: u.indices, error: err ?? '데이터 없음' }); fail(st, 'M3', u.ticker, err ?? '데이터 없음'); continue; }
      const market: Market = u.market === 'CRYPTO' ? 'CRYPTO' : u.market;
      const sm = summarize(bars, market);
      const cur = { '52w': currentDrawdown(bars, '52w'), '3y': currentDrawdown(bars, '3y'), '5y': currentDrawdown(bars, '5y'), all: currentDrawdown(bars, 'all') };
      const last = bars[bars.length - 1].d;
      if (u.market !== 'CRYPTO' && (!maxDate || last > maxDate)) maxDate = last;
      wj(path.join(out, `data/m3/${mkt}/sym/${safe(u.ticker)}.json`), {
        ticker: u.ticker, name: u.name, market: u.market, kind: u.kind, indices: u.indices, 출처: src, 등급: grade, 수집시각: nowIso(), 기준일: last,
        시작일: bars[0].d, 가격기준: '수정주가(출처 제공 기준)', bars: pack(bars), 요약: { ...sm, 연도별: sm.연도별 }, 현재낙폭: cur, 오류: err, needFull,
      });
      rows.push({ ticker: u.ticker, name: u.name, kind: u.kind, indices: u.indices, market: u.market, 기준일: last, 시작일: bars[0].d, 현재가: bars[bars.length - 1].c,
        현재낙폭_52w: cur['52w']?.['고점대비하락률%'] ?? null, 현재낙폭_all: cur.all?.['고점대비하락률%'] ?? null, 평균MDD: sm['평균MDD%'], 평균상승률: sm['평균상승률%'], 평균낙폭: sm['평균낙폭%'], 표본연수: sm.표본연수, 출처: src, 등급: grade, error: err });
      ok(st, 'M3');
    } catch (e) { fail(st, 'M3', u.ticker, `계산 오류: ${(e as Error).message}`); }
  }
  rows.sort((a, b) => ((a.현재낙폭_52w as number) ?? 1e9) - ((b.현재낙폭_52w as number) ?? 1e9));
  const dates = uni.map((x) => (x as { 구성종목_수집일?: string }).구성종목_수집일).filter(Boolean).sort();
  const 구성종목출처 = mkt === 'us'
    ? { 출처: 'Wikipedia "List of S&P 500 companies"·"Nasdaq-100" 구성종목 표', 링크: ['https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', 'https://en.wikipedia.org/wiki/Nasdaq-100'], 라이선스: 'CC BY-SA 4.0', 등급: 'C', 수집일: dates.length ? dates[dates.length - 1] : null }
    : { 출처: 'OpenDART 고유번호·기업개황(corp_cls=Y)', 링크: ['https://opendart.fss.or.kr/'], 라이선스: null, 등급: 'A', 수집일: null };
  wj(path.join(out, `data/m3/${mkt}/index.json`), { 수집시각: nowIso(), 기준일: maxDate, 구성종목출처, rows });
  return maxDate;
}

// ───────── 공유: 금리·버크셔 ─────────
function buildSharedUs(raw: string, prev: string, out: string, st: Status) {
  const rates = rj<Record<string, unknown>>(path.join(raw, 'rates.json')) ?? rj<Record<string, unknown>>(path.join(prev, 'data/shared/us/rates.json'));
  if (rates) wj(path.join(out, 'data/shared/us/rates.json'), { 수집시각: nowIso(), 기준일: (rates as any).DGS10?.date ?? null, ...rates }); else fail(st, '공유', '금리', '국채 10년 금리 수집 실패');
  const bdir = path.join(raw, 'berkshire');
  const meta = rj<{ cur?: { accession: string; filed: string }; prev?: { accession: string; filed: string } }>(path.join(bdir, 'meta.json'));
  if (!meta?.cur || !ex(path.join(bdir, 'cur.xml'))) {
    const p = rj(path.join(prev, 'data/shared/us/berkshire.json'));
    if (p) wj(path.join(out, 'data/shared/us/berkshire.json'), p); else fail(st, '공유', '버크셔 13F', '수집 실패');
    return rj<any>(path.join(out, 'data/shared/us/berkshire.json'));
  }
  const cover = parse13FCover(fs.readFileSync(path.join(bdir, 'cur_cover.xml'), 'utf8'));
  const cur: Filing13F = { period: cover.period ?? '', filed: meta.cur.filed, accession: meta.cur.accession, confidential: cover.confidential, rows: parse13FInfoTable(fs.readFileSync(path.join(bdir, 'cur.xml'), 'utf8')) };
  let prv: Filing13F | null = null;
  if (meta.prev && ex(path.join(bdir, 'prev.xml'))) {
    const pc = ex(path.join(bdir, 'prev_cover.xml')) ? parse13FCover(fs.readFileSync(path.join(bdir, 'prev_cover.xml'), 'utf8')) : { period: '', confidential: false };
    prv = { period: pc.period ?? '', filed: meta.prev.filed, accession: meta.prev.accession, confidential: pc.confidential, rows: parse13FInfoTable(fs.readFileSync(path.join(bdir, 'prev.xml'), 'utf8')) };
  }
  // 수정 공시(13F-HR/A)는 파이썬이 같은 기준일이면 rows에 합쳐 cur.xml 뒤에 붙여 둔다(amend.xml)
  if (ex(path.join(bdir, 'amend.xml'))) cur.rows.push(...parse13FInfoTable(fs.readFileSync(path.join(bdir, 'amend.xml'), 'utf8')));
  const form4: Form4[] = [];
  for (const f of ls(path.join(bdir, 'form4'))) {
    if (!f.endsWith('.xml')) continue;
    const m = rj<{ filed: string; url: string }>(path.join(bdir, 'form4', f.replace(/\.xml$/, '.json')));
    for (const t of parseForm4(fs.readFileSync(path.join(bdir, 'form4', f), 'utf8'))) form4.push({ 제출일: m?.filed ?? '', 양식: 'Form 4', 거래일: t.거래일 ?? '', 주식수: t.주식수, 가격: t.가격, 출처: m?.url ?? 'SEC EDGAR', ticker: t.ticker ?? undefined });
  }
  const cusipMap = rj<Record<string, { ticker: string; grade: 'A' | 'C' }>>(path.join(bdir, 'cusip_map.json')) ?? {};
  const agg = [...aggregate(cur.rows).entries()].map(([cusip, v]) => ({ cusip, ...v, ticker: cusipMap[cusip]?.ticker ?? null, 매핑등급: cusipMap[cusip]?.grade ?? 'C' }));
  const 대량보유공시 = rj<{ 양식: string; 제출일: string; 접수번호: string; 원문: string }[]>(path.join(bdir, 'sched13.json')) ?? [];
  const obj = { 수집시각: nowIso(), cur, prev: prv, 보유요약: agg, form4, 대량보유공시, cusipMap, 출처: 'SEC EDGAR', 등급: 'A', 매핑안내: 'CUSIP→티커 무료 공식 매핑이 없어 이름 대조(C급)' };
  wj(path.join(out, 'data/shared/us/berkshire.json'), obj);
  ok(st, '버크셔');
  return obj;
}

// ───────── M1 ─────────
function buildM1(raw: string, prev: string, out: string, uni: UniItem[], st: Status, brk: any) {
  const rates = rj<{ DGS10?: { value: number; date: string } }>(path.join(out, 'data/shared/us/rates.json'));
  const rows: Record<string, unknown>[] = [];
  for (const u of uni.filter((x) => x.m1)) {
    try {
      const dir = path.join(raw, 'sec', safe(u.ticker));
      const factsRaw = ex(path.join(dir, 'facts.json')) ? rj<CompanyFacts>(path.join(dir, 'facts.json')) : null;
      const prevSym = rj<any>(path.join(prev, `data/m1/sym/${safe(u.ticker)}.json`));
      const sub = rj<{ sic?: string }>(path.join(dir, 'sub.json')) ?? { sic: prevSym?.sic };
      let years = factsRaw ? normalizeCompanyFacts(factsRaw).재무_10년 : prevSym?.input?.재무_10년 ?? null;
      const memo = factsRaw ? normalizeCompanyFacts(factsRaw).메모 : prevSym?.memo ?? [];
      if (!years || !years.length) { rows.push({ ticker: u.ticker, name: u.name, error: '재무 데이터 없음' }); fail(st, 'M1', u.ticker, '재무 데이터 없음(SEC companyfacts)'); continue; }
      const bars = loadBarsOut(out, u) ?? loadBars(prev, u);
      const last = bars[bars.length - 1] ?? null;
      const { inp, calc, quant, pre } = assembleM1({ ticker: u.ticker, name: u.name, sector: u.sector, sic: sub.sic, years, bars, dgs10: rates?.DGS10 ?? null, priceGrade: ((loadMeta(out, u)?.등급 as any) ?? 'C') }, cfg);
      // 공시 발췌·요약
      const fm = rj<any>(path.join(dir, 'filings.json')) ?? prevSym?.filings_meta ?? {};
      const item1 = ex(path.join(dir, 'item1.txt')) ? fs.readFileSync(path.join(dir, 'item1.txt'), 'utf8') : prevSym?.filings?.item1?.발췌 ?? null;
      const proxy = rj<{ 지분: string | null; 보수: string | null }>(path.join(dir, 'proxy.json')) ?? prevSym?.filings?.proxy?.발췌 ?? null;
      const sum = (acc?: string) => (acc ? rj<any>(path.join(raw, 'summaries', `${safe(acc)}.json`)) ?? rj<any>(path.join(prev, `state/summaries/done/${safe(acc)}.json`)) : null);
      const s1 = sum(fm['10-K']?.accession), s2 = sum(fm['DEF 14A']?.accession);
      const cusips = (brk?.보유요약 ?? []).filter((r: any) => r.ticker === u.ticker).map((r: any) => r.cusip);
      const berk = brk ? berkshireFor({ cusips, usListed: true, cur: brk.cur, prev: brk.prev, lastClose: last ? { d: last.d, c: last.c } : null, quarterBars: bars, form4: (brk.form4 ?? []).filter((f: Form4) => f.ticker === u.ticker), mappingGrade: cusips.length ? brk.cusipMap?.[cusips[0]]?.grade ?? 'C' : 'C' }) : null;
      wj(path.join(out, `data/m1/sym/${safe(u.ticker)}.json`), {
        ticker: u.ticker, name: u.name, sic: sub.sic, 기준일: inp.기준일, 수집시각: nowIso(), 출처: { 재무: 'SEC EDGAR', 가격: loadMeta(out, u)?.출처 ?? null, 금리: 'FRED' }, 등급: { 재무: 'A', 가격: loadMeta(out, u)?.등급 ?? null, 금리: 'A' }, input: inp, calc, quant, 정량판정: { 판정: '정량 관문만 판정됨(G2·G4·G5)', G2: quant.G2.상태, G4: quant.G4.상태, G5: quant.G5.상태, 결정표_LLM전: pre.판정 },
        filings_meta: fm, memo,
        filings: {
          item1: { 발췌: item1, 요약: s1?.summary ?? null, 요약검사: s1?.numcheck ?? null, 요약표시: s1?.summary ? 'AI 요약' : 'AI 요약 없음(원문 발췌만)', 등급: 'A', ...fm['10-K'] },
          proxy: { 발췌: proxy, 요약: s2?.summary ?? null, 요약검사: s2?.numcheck ?? null, 요약표시: s2?.summary ? 'AI 요약' : 'AI 요약 없음(원문 발췌만)', 등급: 'A', ...fm['DEF 14A'] },
        },
        버크셔_참고: berk,
      });
      rows.push({ ticker: u.ticker, name: u.name, 업종유형: inp.종목.업종유형, 판정: '정량 관문만 판정됨(G2·G4·G5)', G2: quant.G2.상태, G4: quant.G4.상태, G5: quant.G5.상태,
        '안전마진%': calc['안전마진%_기본'], 주가: inp.시장데이터.주가, 시가총액: inp.시장데이터.보통주_시가총액, 기준일: inp.기준일, 데이터기간: calc.데이터기간_년, error: null });
      ok(st, 'M1');
    } catch (e) { rows.push({ ticker: u.ticker, name: u.name, error: '계산 오류' }); fail(st, 'M1', u.ticker, `계산 오류: ${(e as Error).message}`); }
  }
  wj(path.join(out, 'data/m1/index.json'), { 수집시각: nowIso(), 대상: '나스닥100 + S&P500 구성종목(D7)', rows });
}
function loadBarsOut(out: string, u: UniItem): Bar[] | null {
  const o = rj<{ bars?: [string, number, number?, number?, number?][] }>(path.join(out, `data/m3/${priceMarket(u)}/sym/${safe(u.ticker)}.json`));
  return o?.bars ? o.bars.map(([d, c, h, l, v]) => ({ d, c, h: h ?? undefined, l: l ?? undefined, v: v ?? undefined })) : null;
}
function loadMeta(out: string, u: UniItem) { return rj<{ 등급?: string; 출처?: string }>(path.join(out, `data/m3/${priceMarket(u)}/sym/${safe(u.ticker)}.json`)); }

// ───────── M2 ─────────
function buildM2(raw: string, prev: string, out: string, uni: UniItem[], mkt: 'us' | 'kr', st: Status) {
  for (const u of uni.filter((x) => priceMarket(x) === mkt && x.kind !== 'crypto')) {
    try {
      const bars = loadBarsOut(out, u) ?? [];
      const meta = loadMeta(out, u);
      const ev = priceEvidence(bars, { 출처: meta?.출처 ?? '가격 출처', 등급: meta?.등급 ?? 'C' });
      let earn: ReturnType<typeof earningsEvidence> = [];
      let disc: { 날짜: string; 제목: string; url: string; 등급: string }[] = [];
      if (mkt === 'us') {
        const f = rj<CompanyFacts>(path.join(raw, 'sec', safe(u.ticker), 'facts.json'));
        if (f) earn = earningsEvidence(latestEarnings(f), { 출처: 'SEC EDGAR', 등급: 'A', 기준일: bars[bars.length - 1]?.d ?? null });
        const recent = rj<{ form: string; filed: string; url: string; title?: string }[]>(path.join(raw, 'sec', safe(u.ticker), 'recent.json')) ?? [];
        disc = recent.map((r) => ({ 날짜: r.filed, 제목: `${r.form}${r.title ? ' ' + r.title : ''}`, url: r.url, 등급: 'A' }));
      } else {
        const acc = rj(path.join(raw, 'dart', safe(u.ticker), 'accounts.json'));
        if (acc) earn = parseDartAccounts(acc).flatMap((e) => [{ 항목: `${e.항목} ${e.기간}`, 수치: e.값, 기준일: null, 출처: 'OpenDART', 등급: 'A' }, { 항목: `${e.항목} 전년 대비 증감% ${e.기간}`, 수치: e['증감%'], 기준일: null, 출처: 'OpenDART', 등급: 'A' }]);
        const list = rj(path.join(raw, 'dart', safe(u.ticker), 'list.json'));
        if (list) disc = parseDartList(list, { [u.ticker]: u.ticker }).map((n) => ({ 날짜: n.published.slice(0, 10), 제목: n.title, url: n.url, 등급: 'A' }));
      }
      const prevSym = rj<any>(path.join(prev, `data/m2/${mkt}/sym/${safe(u.ticker)}.json`));
      if (!earn.length && prevSym?.실적) earn = prevSym.실적;
      wj(path.join(out, `data/m2/${mkt}/sym/${safe(u.ticker)}.json`), {
        ticker: u.ticker, name: u.name, 기준일: bars[bars.length - 1]?.d ?? null, 수집시각: nowIso(), 출처: { 주가: meta?.출처 ?? null, 실적: mkt === 'us' ? 'SEC EDGAR' : 'OpenDART' }, 등급: { 주가: meta?.등급 ?? null, 실적: 'A' }, 주가: ev, 실적: earn, 공시: disc,
        수급: mkt === 'kr' ? { 상태: '제공 안 됨', 사유: 'KRX 이용약관이 자동화 수단에 의한 정보 수집을 금지(제10조②2호) — D6에 따라 미구현' } : { 상태: '제공 안 됨', 사유: '미국 종목은 수급을 제공하지 않음' },
      });
      ok(st, 'M2');
    } catch (e) { fail(st, 'M2', u.ticker, `오류: ${(e as Error).message}`); }
  }
}

// ───────── M6 ─────────
function buildNews(raw: string, prev: string, out: string, st: Status) {
  const uni = (rj<UniItem[]>(path.join(raw, 'universe.json')) ?? rj<UniItem[]>(path.join(prev, 'state/news/universe.json')) ?? []);
  const ue: UniverseEntry[] = uni.filter((u) => u.kind === 'stock').map((u) => ({ ticker: u.ticker, name: u.name, name_ko: u.name_ko, market: u.market, sector: u.sector, top_cap: u.top_cap }));
  const items: NewsItem[] = [];
  const grades = { official: 'A', filing: 'A' } as const;
  for (const s of newsSources.rss.filter((x) => x.enabled)) {
    const p = path.join(raw, 'news/feeds', `${s.id}.xml`);
    if (!ex(p)) { fail(st, 'M6', s.이름, '수집 실패'); continue; }
    items.push(...parseFeed(fs.readFileSync(p, 'utf8'), { id: s.id, 이름: s.이름, domain: s.domain, grade: grades[s.kind as 'official'] ?? 'B', kind: s.kind as NewsItem['kind'], market: s.market as 'US' | 'KR', summary_allowed: s.summary_allowed }));
    ok(st, 'M6 RSS');
  }
  const sec = path.join(raw, 'news/sec8k.xml');
  if (ex(sec)) {
    const cikMap: Record<string, string> = {};
    for (const u of uni) if (u.cik) cikMap[String(+u.cik)] = u.ticker;
    for (const it of parseFeed(fs.readFileSync(sec, 'utf8'), { id: 'sec8k', 이름: 'SEC EDGAR 8-K', domain: 'sec.gov', grade: 'A', kind: 'filing', market: 'US', summary_allowed: true })) {
      const m = it.url.match(/\/data\/(\d+)\//) ?? it.title.match(/\((\d{7,10})\)/);
      const t = m ? cikMap[String(+m[1])] : undefined;
      if (t) items.push({ ...it, tickers: [t] }); // 유니버스로 필터
    }
    ok(st, 'M6 8-K');
  }
  const dl = rj(path.join(raw, 'news/dart_list.json'));
  if (dl) { const byCode: Record<string, string> = {}; for (const u of uni) if (u.market === 'KR') byCode[u.ticker] = u.ticker; items.push(...parseDartList(dl, byCode)); ok(st, 'M6 DART'); }
  // 이전 항목과 합치기(최근 N일만 보관 — 재배포 최소화)
  const old = rj<NewsItem[]>(path.join(prev, 'state/news/items.json')) ?? [];
  const map = new Map<string, NewsItem>(old.map((i) => [i.id, i]));
  for (const i of items) map.set(i.id, i);
  const cutoff = Date.now() - (newsRules as any).retention_days * 864e5;
  const kept = [...map.values()].filter((i) => Date.parse(i.published) >= cutoff);
  const obs = rj<Record<string, IndicatorObs>>(path.join(raw, 'news/obs.json')) ?? {};
  const cards = buildCards(kept, newsRules as unknown as Rules, ue, (econCal as any).events, obs, new Date());
  // 실행 지연(실측)
  const run = rj<RunRec>(path.join(raw, 'runinfo.json'));
  const raw7 = (rj<RunRec[]>(path.join(prev, 'state/news/runs.json')) ?? []).filter((r) => Date.parse(r.started) >= Date.now() - 7 * 864e5);
  if (run) raw7.push(run);
  // 예정 시각은 news.yml의 cron에서 읽는다(README대로 간격을 바꿔도 지연 계산이 맞게)
  const wf = path.join(path.dirname(new URL(import.meta.url).pathname), '../../../.github/workflows/news.yml');
  const cronM = ex(wf) ? cronMinutes((fs.readFileSync(wf, 'utf8').match(/cron: '([^']+)'/) ?? [])[1] ?? '') : null;
  const mins = cronM ?? [7];
  const runs = assignRunSlots(raw7, mins);
  const rs = runStats(runs, Date.now(), mins.length);
  wj(path.join(out, 'state/news/items.json'), kept);
  wj(path.join(out, 'state/news/runs.json'), runs);
  wj(path.join(out, 'state/news/universe.json'), uni);
  wj(path.join(out, 'data/m6/cards.json'), { 수집시각: nowIso(), 기준일: new Date().toISOString().slice(0, 10), 출처: '공식 발표·공시·언론 RSS(카드별 출처·등급)', 규칙버전: (newsRules as any).version, cards, 일정: (econCal as any).events, FRED고지: 'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.' });
  return { 최근24시간_실행수: rs.실행수, 예상실행수: rs.예상, 실행률: rs.실행률, 건너뛴예정시각: rs.건너뜀, 최근지연_최대분: rs.최대지연분, 지연측정: `예정 시각(news.yml cron, 매시 ${mins.join('·')}분${cronM ? '' : ' — cron을 읽지 못해 기본값'}) 대비 워크플로 첫 단계 시작 시각, 직전 24시간 최대값(실측). 예약 후 러너 배정까지의 대기는 포함되지만, GitHub가 아예 건너뛴 시각은 지연이 아니라 건너뜀으로 셉니다` };
}

// ───────── 봉인(암호화)·해제 ─────────
async function key() { const k = process.env.DATA_KEY; if (!k) throw new Error('DATA_KEY 비밀값이 없습니다'); return importDataKey(k); }
function walk(d: string, base = d): string[] { return ls(d).filter((f) => f !== '.git').flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')]; }); }
async function seal(src: string, dst: string) {
  const k = await key();
  const plain = new Set(publishCfg.plaintext);
  for (const rel of walk(src)) {
    const o = JSON.parse(fs.readFileSync(path.join(src, rel), 'utf8'));
    wj(path.join(dst, rel), plain.has(rel) ? o : await sealData(k, rel, o));
  }
}
async function unseal(src: string, dst: string) {
  if (!ex(src)) return;
  const k = await key();
  let bad = 0;
  for (const rel of walk(src)) {
    if (!rel.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(src, rel), 'utf8'));
      wj(path.join(dst, rel), isEnvelope(o) ? await openData(k, o, rel) : o);
    } catch { bad++; log(`해제 실패(건너뜀): ${rel}`); }
  }
  if (bad) process.stdout.write(`::warning::직전 데이터 ${bad}개 파일을 풀지 못했습니다. DATA_KEY를 바꿨다면 해당 모듈은 처음부터 다시 쌓입니다.\n`);
}

// ───────── 공시 발췌 ─────────
function excerpts(raw: string) {
  for (const t of ls(path.join(raw, 'sec'))) {
    const d = path.join(raw, 'sec', t);
    if (ex(path.join(d, '10k.html'))) { const x = extractItem1(htmlToText(fs.readFileSync(path.join(d, '10k.html'), 'utf8'))); if (x) fs.writeFileSync(path.join(d, 'item1.txt'), x); }
    if (ex(path.join(d, 'def14a.html'))) wj(path.join(d, 'proxy.json'), extractProxy(htmlToText(fs.readFileSync(path.join(d, 'def14a.html'), 'utf8'))));
  }
}

function writeStatus(out: string, name: 'us' | 'kr' | 'news', st: Status, extra: Record<string, unknown> = {}, raw?: string) {
  // 파이썬 수집 단계의 실패(사유만, URL·키 없음)도 합친다
  for (const f of (raw ? rj<Status['실패']>(path.join(raw, 'collect_failures.json')) : null) ?? []) fail(st, f.모듈, f.대상, f.사유);
  wj(path.join(out, `data/status/${name}.json`), { ...st, ...extra });
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case 'market-status': process.stdout.write(JSON.stringify(marketDayStatus(a[1] ? new Date(a[1]) : new Date(), a[0] as Market)) + '\n'); break;
    case 'unseal': await unseal(a[0], a[1]); break;
    case 'seal': await seal(a[0], a[1]); break;
    case 'excerpts': excerpts(a[0]); break;
    case 'mdd-freq': { // 로컬 엑셀 비교용: 연중 MDD%(음수) 목록 → 공용 빈도표 함수 결과
      const mdds = JSON.parse(fs.readFileSync(a[0], 'utf8')) as number[];
      const st = mdds.map((m, i) => ({ 연도: i, 기준일: '', 기준가: 1, 완결: true, '상승률%': 0, '낙폭%': m, 'MDD%': m, '수익률%': 0, MDD_고점일: '', MDD_저점일: '' }));
      process.stdout.write(JSON.stringify(frequencyTable(st)) + '\n'); break;
    }
    case 'numcheck': {
      const r = checkNumbers(fs.readFileSync(a[0], 'utf8'), fs.readFileSync(a[1], 'utf8'));
      process.stdout.write(JSON.stringify({ ...summarizeFindings(r), 상세: r.filter((x) => x.상태 !== '허용') }) + '\n'); break;
    }
    case 'build-us': {
      const [raw, prev, out] = a;
      const st = newStatus('daily-us', 'US');
      const uni = rj<UniItem[]>(path.join(raw, 'universe.json')) ?? rj<UniItem[]>(path.join(prev, 'state/us/universe.json')) ?? [];
      if (!uni.length) fail(st, '유니버스', '전체', '유니버스 해석 실패');
      st.기준일 = buildM3(raw, prev, out, uni, 'us', st);
      const brk = buildSharedUs(raw, prev, out, st);
      buildM1(raw, prev, out, uni, st, brk);
      buildM2(raw, prev, out, uni, 'us', st);
      wj(path.join(out, 'state/us/universe.json'), uni);
      writeStatus(out, 'us', st, { 모듈: ['M1', 'M2(미국)', 'M3(미국·ETF·BTC)'], 요약대기열: rj(path.join(raw, 'summaries_status.json')) }, raw);
      log(`완료: 성공 ${JSON.stringify(st.성공)}, 실패 ${st.실패.length}건`);
      break;
    }
    case 'build-kr': {
      const [raw, prev, out] = a;
      const st = newStatus('daily-kr', 'KR');
      const uni = rj<UniItem[]>(path.join(raw, 'universe.json')) ?? rj<UniItem[]>(path.join(prev, 'state/kr/universe.json')) ?? [];
      st.기준일 = buildM3(raw, prev, out, uni, 'kr', st);
      buildM2(raw, prev, out, uni, 'kr', st);
      const r = rj(path.join(raw, 'rates_kr.json')) ?? rj(path.join(prev, 'data/shared/kr/rates.json'));
      if (r) wj(path.join(out, 'data/shared/kr/rates.json'), { 수집시각: nowIso(), 기준일: (r as any).KR10Y?.date ?? null, ...(r as object) }); else fail(st, '공유', '국내 국채 10년', '수집 실패');
      wj(path.join(out, 'state/kr/universe.json'), uni);
      if (!ex(path.join(out, 'state/kr/kospi_cache.json'))) { const c = rj(path.join(prev, 'state/kr/kospi_cache.json')); if (c) wj(path.join(out, 'state/kr/kospi_cache.json'), c); }
      // 유니버스 밖 국내 종목 즉시 분석(M2)용 공개 종목코드→DART 고유번호 표
      const kc = rj<{ listed?: { stock_code: string; corp_code: string; name_ko: string }[] }>(path.join(out, 'state/kr/kospi_cache.json'));
      if (kc?.listed) wj(path.join(out, 'data/shared/kr/corp_codes.json'), Object.fromEntries(kc.listed.map((x) => [x.stock_code, { corp: x.corp_code, name: x.name_ko }])));
      writeStatus(out, 'kr', st, { 모듈: ['M2(국내)', 'M3(국내)'], 수급: '제공 안 됨(KRX 약관상 자동 수집 금지)' }, raw);
      log(`완료: 성공 ${JSON.stringify(st.성공)}, 실패 ${st.실패.length}건`);
      break;
    }
    case 'build-news': {
      const [raw, prev, out] = a;
      const st = newStatus('news', 'US');
      st.기준일 = new Date().toISOString().slice(0, 10);
      const runs = buildNews(raw, prev, out, st);
      writeStatus(out, 'news', st, { 실행기록: runs }, raw);
      log(`완료: 카드 생성, 실패 ${st.실패.length}건`);
      break;
    }
    case 'merge-status': {
      const d = a[0];
      const parts = Object.fromEntries((['us', 'kr', 'news'] as const).map((n) => [n, rj(path.join(d, `data/status/${n}.json`))]));
      wj(path.join(d, 'data/_status.json'), { 생성시각UTC: nowIso(), ...parts });
      break;
    }
    default: process.stderr.write('사용법: cli.mjs <market-status|unseal|seal|excerpts|numcheck|build-us|build-kr|build-news> ...\n'); process.exit(2);
  }
}
void universeCfg;
main().catch((e) => { process.stderr.write(`[calc] 실패: ${String((e as Error).message).replace(/https?:\/\/\S+/g, '[URL]')}\n`); process.exit(1); });
