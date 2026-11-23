// M1 버핏식 종목 분석. 결론 카드와 관문 판정표는 코드가 렌더링하고, LLM 본문은 A-6 3번 섹션부터(본문 M1 예외 ③).
import { useEffect, useState } from 'preact/hooks';
import { Card, Disclaimer, Loading, Note, Badge, useAsync } from '../components/ui';
import { loadData, symFile } from '../lib/data';
import { relay } from '../lib/relay';
import { callJson, GeminiError } from '../lib/gemini';
import { idbGet, idbSet } from '../lib/db';
import { personal, updatePersonal } from '../lib/store';
import { useSignal } from '../lib/signal';
import { Markdown, ExtLink } from '../lib/safe';
import { fmt, pct, money } from '../lib/format';
import { go } from '../lib/nav';
import { decide, buildLlmInput, LLM_RESPONSE_SCHEMA, validLlmGate, type Config, type LlmJudgement, type Decision, type BuffettInput, type Calc } from '@core/buffett/engine';
import { assembleM1 } from '@core/buffett/assemble';
import { normalizeCompanyFacts, type CompanyFacts } from '@core/sec/facts';
import { berkshireFor, type BerkshireRef } from '@core/sec/berkshire';
import { parseStooqCsv, parseTiingo, htmlToText, extractItem1 } from '@core/parse/parsers';
import { checkNumbers } from '@core/common/numcheck';
import cfgJson from '@config/buffett.json';
import appendixA from '@config/prompts/buffett_appendix_a.md?raw';

const cfg = cfgJson as unknown as Config;

export interface M1Data {
  ticker: string; name: string; 기준일: string; input: BuffettInput; calc: Calc; 즉시분석?: boolean;
  filings: { item1: any; proxy: any }; 버크셔_참고: BerkshireRef | null; memo?: string[];
}
interface LlmResult { 판정: LlmJudgement; report_md: string; raw?: string; error?: string; 숫자검사?: { 원문: string; 상태: string }[]; at: string }

const isLlm = (x: unknown): x is { 판정: LlmJudgement; report_md: string } => {
  const o = x as any;
  return !!o && typeof o.report_md === 'string' && !!o.판정 && validLlmGate(o.판정.G1) && validLlmGate(o.판정.G3) && validLlmGate(o.판정.G6);
};

/** 유니버스 밖 미국 종목 즉시 분석(3-6) — 원본은 Worker가 그대로 전달, 파싱·계산은 공용 TS 모듈 */
export async function instantM1(ticker: string): Promise<M1Data> {
  const T = ticker.toUpperCase();
  const tickers = await relay('sec_tickers', {});
  const ent = Object.values(tickers as Record<string, { ticker: string; cik_str: number; title: string }>).find((v) => v.ticker.toUpperCase() === T.replace('.', '-'));
  if (!ent) throw new Error('SEC 티커 목록에 없는 종목(미국 상장 종목만 지원)');
  const cik = String(ent.cik_str).padStart(10, '0');
  const sub = await relay('sec_sub', { cik });
  const facts = (await relay('sec_facts', { cik })) as CompanyFacts;
  const years = normalizeCompanyFacts(facts).재무_10년;
  let bars = parseStooqCsv(String(await relay('price_stooq', { sym: `${T.toLowerCase().replace('.', '-')}.us` }, 'text').catch(() => ''))).bars, grade: 'B' | 'C' = 'C';
  if (!bars.length) { bars = parseTiingo(await relay('price_tiingo', { t: T.toLowerCase().replace('.', '-') }).catch(() => null)).bars; grade = 'B'; }
  const rates = await loadData<any>('shared/us/rates.json').catch(() => null);
  const brk = await loadData<any>('shared/us/berkshire.json').catch(() => null);
  const a = assembleM1({ ticker: T, name: ent.title, sic: sub.sic, years, bars, dgs10: rates?.DGS10 ?? null, priceGrade: grade }, cfg);
  // 10-K Item 1 원문 발췌(AI 요약 없음 — 즉시 분석은 브라우저 키로 요약하지 않음)
  let item1: string | null = null, meta: any = null;
  const r = sub.filings?.recent; const i = r ? r.form.indexOf('10-K') : -1;
  if (i >= 0) {
    meta = { accession: r.accessionNumber[i], filed: r.filingDate[i], url: `https://www.sec.gov/Archives/edgar/data/${+cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}` };
    try { item1 = extractItem1(htmlToText(String(await relay('sec_doc', { cik, acc: r.accessionNumber[i], doc: r.primaryDocument[i] }, 'text')))); } catch { item1 = null; }
  }
  const last = bars[bars.length - 1];
  const cus = (brk?.보유요약 ?? []).filter((x: any) => x.ticker === T).map((x: any) => x.cusip);
  const berk = brk ? berkshireFor({ cusips: cus, usListed: true, cur: brk.cur, prev: brk.prev, lastClose: last ? { d: last.d, c: last.c } : null, quarterBars: bars, form4: (brk.form4 ?? []).filter((f: any) => f.ticker === T), mappingGrade: cus.length ? brk.cusipMap?.[cus[0]]?.grade ?? 'C' : 'C' }) : null; // 배치와 같은 입력(분기 범위는 berkshireFor가 고름)
  return { ticker: T, name: ent.title, 기준일: a.inp.기준일, input: a.inp, calc: a.calc, 즉시분석: true,
    filings: { item1: { 발췌: item1, 요약: null, 요약표시: 'AI 요약 없음(원문 발췌만)', 등급: 'A', ...meta }, proxy: { 발췌: null, 요약: null, 요약표시: '즉시 분석에서는 제공 안 됨' } }, 버크셔_참고: berk };
}

async function runLlm(d: M1Data): Promise<LlmResult> {
  const input = buildLlmInput(d.input, d.calc, d.버크셔_참고);
  const withFilings = { ...input, 공시발췌: { 사업설명: d.filings.item1?.발췌 ?? null, 사업설명_AI요약: d.filings.item1?.요약 ?? null, 경영진_지분_보수: d.filings.proxy?.발췌 ?? null } };
  try {
    const o = await callJson(appendixA, withFilings, LLM_RESPONSE_SCHEMA, isLlm);
    const nums = checkNumbers(o.report_md, withFilings, { unit: d.input.단위 }).filter((x) => x.상태 !== '허용');
    return { ...o, 숫자검사: nums, at: new Date().toISOString() };
  } catch (e) {
    // 형식 오류(재요청 1회 후) → 해당 관문 '판단불가', 본문은 '원문 + 형식 오류'
    if (e instanceof GeminiError && e.code === 'FORMAT') return { 판정: {}, report_md: '', raw: e.raw, error: '형식 오류', at: new Date().toISOString() };
    throw e;
  }
}

function Conclusion({ d, dec }: { d: M1Data; dec: Decision }) {
  const c = d.calc, cur = d.input.종목.통화;
  return (
    <Card title="1. 결론" cls="conclusion">
      {dec.정량만 && <Note kind="info">정량 관문만 판정됨(G2·G4·G5) — 'AI 분석 실행'을 누르면 G1·G3·G6 판정 후 결정표를 확정합니다.</Note>}
      <p class="verdict" data-testid="m1-verdict">판정: <b>{dec.정량만 ? '정량 관문만 판정됨(G2·G4·G5)' : dec.판정}</b>{!dec.정량만 && <> — 확신도: <b>{dec.확신도}</b></>}</p>
      {!dec.정량만 && <p>결정 근거: 결정표 {dec.결정표_줄}번 줄 ({dec.사유})</p>}
      <p>주당 내재가치(보수~기본): {money(c.가치평가.보수.주당내재가치, cur)} ~ {money(c.가치평가.기본.주당내재가치, cur)} / 현재 주가 {money(d.input.시장데이터.주가, cur)}({d.기준일} 종가) / 안전마진 {pct(c['안전마진%_기본'])}{!dec.정량만 && <> (요구 {dec['요구안전마진%'] === null ? '-' : dec['요구안전마진%'] + '%'})</>}</p>
      {!dec.정량만 && dec.주당_매수검토가격 !== null && <p data-testid="m1-buyprice">주당 매수검토가격: <b>{money(dec.주당_매수검토가격, cur)}</b></p>}
      {dec.경고.map((w) => <Note kind="warn">{w}</Note>)}
    </Card>
  );
}

function GateTable({ dec }: { dec: Decision }) {
  const names: Record<string, string> = { G1: '능력범위', G2: '해자', G3: '수익 일관성', G4: '자본효율', G5: '재무건전성', G6: '경영진', G7: '오너 어닝', G8: '내재가치', G9: '안전마진' };
  return (
    <Card title="2. 관문별 판정표">
      <table class="t" data-testid="gate-table"><thead><tr><th>관문</th><th>판정</th><th>핵심 근거</th><th>등급</th></tr></thead><tbody>
        {Object.entries(dec.관문).map(([k, g]) => <tr><td>{k} {names[k]}</td><td><Badge cls={`g-${g.상태}`}>{g.상태}</Badge></td><td>{g.근거}</td><td>{String(g.등급)}</td></tr>)}
      </tbody></table>
    </Card>
  );
}

function Details({ d }: { d: M1Data }) {
  const c = d.calc, ys = d.input.재무_10년;
  return (
    <Card title="상세(코드 계산값)">
      <h3>핵심 재무 10년(단위: {d.input.단위}, 출처 SEC EDGAR, A급)</h3>
      <div class="scroll"><table class="t"><thead><tr><th>연도</th><th>매출</th><th>매출총이익률</th><th>영업이익률</th><th>ROE</th><th>ROIC</th><th>오너어닝(보수)</th><th>부채비율</th><th>희석주식수</th></tr></thead><tbody>
        {ys.map((y, i) => <tr><td>{y.연도}</td><td>{fmt(y.매출 as number, 0)}</td><td>{pct(c.매출총이익률_연도별[i])}</td><td>{pct(c.영업이익률_연도별[i])}</td><td>{pct(c.ROE_연도별[i])}</td><td>{pct(c.ROIC_연도별[i])}</td><td>{fmt(c.오너어닝_연도별.보수[i], 0)}</td><td>{pct(c.부채비율_연도별[i])}</td><td>{fmt((y.희석주식수 ?? y.보통주_유통주식수) as number, 0)}</td></tr>)}
      </tbody></table></div>
      <h3>가치평가 시나리오(운영 기준 가정 — 판정에는 보수·기본만 사용)</h3>
      <table class="t"><thead><tr><th>시나리오</th><th>g1</th><th>g</th><th>r</th><th>주당 내재가치</th></tr></thead><tbody>
        {(['보수', '기본', '낙관'] as const).map((k) => <tr><td>{k}</td><td>{pct(c.가치평가[k].성장률)}</td><td>{pct(c.가치평가[k].영구성장률)}</td><td>{pct(c.가치평가[k].할인율)}</td><td>{fmt(c.가치평가[k].주당내재가치)}</td></tr>)}
      </tbody></table>
      <p>민감도(기본): 할인율 +1%p {fmt(c.민감도_주당내재가치['할인율+1%p'])} / −1%p {fmt(c.민감도_주당내재가치['할인율-1%p'])} / 성장률 +2%p {fmt(c.민감도_주당내재가치['성장률+2%p'])} / −2%p {fmt(c.민감도_주당내재가치['성장률-2%p'])}</p>
      <p>교차 점검(참고): 오너어닝수익률 {pct(c['오너어닝수익률%'])} vs 국채10년 {pct(d.input.시장데이터.국채10년_금리)}({d.input.시장데이터.금리_기준일 ?? '-'}) · PER 10년 위치 {pct(c['PER_10년위치%'])} · PBR 10년 위치 {pct(c['PBR_10년위치%'])}</p>
      <p>유보이익 시총증가배수(참고, 판정 미사용): {fmt(c.유보이익_시총증가배수)} · 10년 희석률 {pct(c['희석률_10년%'])}</p>
      <h3>검산 플래그·데이터 한계</h3>
      <ul>{c.검산플래그.map((f) => <li>{f.항목}: {f.상태} — {f.설명}</li>)}{(d.memo ?? []).map((m) => <li>{m}</li>)}{!c.검산플래그.length && !d.memo?.length && <li>없음</li>}</ul>
    </Card>
  );
}

function Filings({ d }: { d: M1Data }) {
  const f = d.filings;
  const box = (title: string, x: any) => (
    <div class="filing"><h3>{title} {x?.url && <ExtLink href={x.url}>원문</ExtLink>} <Badge>{x?.요약표시 ?? 'AI 요약 없음'}</Badge></h3>
      {x?.요약 && <><p><b>AI 요약</b>(원문 등급 {x.등급}, AI 요약): {x.요약}</p>{x.요약검사?.오류 > 0 && <Note kind="warn">요약에 원문에 없는 숫자가 있음 — 원문과 비교하세요</Note>}</>}
      {x?.발췌 ? <details><summary>원문 발췌 보기(A급)</summary><pre class="excerpt">{typeof x.발췌 === 'string' ? x.발췌 : [x.발췌.지분, x.발췌.보수].filter(Boolean).join('\n\n')}</pre></details> : <p class="muted">원문 발췌 없음</p>}
    </div>
  );
  return <Card title="공시 원문·요약">{box('사업설명(10-K Item 1)', f.item1)}{box('경영진·지분(DEF 14A)', f.proxy)}</Card>;
}

function Berkshire({ b }: { b: BerkshireRef | null }) {
  const p = useSignal(personal);
  const sh = useAsync(() => loadData<any>('shared/us/berkshire.json').catch(() => null), [p.dataKey]);
  const sched: { 양식: string; 제출일: string; 원문: string }[] = sh.data?.대량보유공시 ?? [];
  const st = !b ? '데이터 없음' : b.보유여부 === true ? '보유' : b.보유여부 === false ? '미보유(최신 13F 기준)' : b.확인불가_사유 === '13F대상아님' ? '13F 대상 아님 — 확인 불가' : b.확인불가_사유 === '비밀취급' ? '비밀 취급 종목 존재 — 보유 여부 확인 불가' : '확인 불가';
  return (
    <Card title="11. [참고] 버크셔 해서웨이 보유 현황 — 판정에 반영하지 않음">
      <table class="t"><tbody>
        <tr><td>보유 여부</td><td data-testid="brk-hold">{st}</td><td>13F 기준일 {b?.['13F_기준일'] ?? '-'} (제출일 {b?.['13F_제출일'] ?? '-'})</td></tr>
        <tr><td>보유 주식 수 · 분기 변화</td><td>{fmt(b?.보유주식수, 0)}주 ({b?.변화구분 ?? '-'}, {fmt(b?.주식수_변화, 0)}주)</td><td>A</td></tr>
        <tr><td>13F 평가액 · 비중</td><td>{fmt(b?.['13F_평가액'], 0)}달러 · 13F 신고 주식 총액 대비 {pct(b?.['13F_포트폴리오비중%'])}</td><td>분기 말 가격 기준, A</td></tr>
        <tr><td>현재 추정 평가액</td><td>{fmt(b?.현재추정평가액, 0)}달러 ({b?.현재추정평가액_기준일 ?? '-'})</td><td>분기 말 이후 매매 없다고 가정한 추정치</td></tr>
        <tr><td>추정 매수가 범위</td><td>{b?.추정매수가범위 ? `${fmt(b.추정매수가범위.하단)} ~ ${fmt(b.추정매수가범위.상단)}달러 (${b.추정매수가범위.대상분기})` : '-'}</td><td>추측입니다 — 분기 중 주가 범위</td></tr>
        <tr><td>최근 지분 공시</td><td>{b?.최근내부자공시?.length ? b.최근내부자공시.map((f) => `${f.양식} ${f.거래일} ${fmt(f.주식수, 0)}주`).join(', ') : '없음'}</td><td>A</td></tr>
        <tr><td>최근 90일 대량보유 공시(13D/13G)</td><td data-testid="brk-13dg">{sched.length ? sched.map((f, i) => <>{i ? ', ' : ''}<ExtLink href={f.원문}>{`${f.양식} ${f.제출일}`}</ExtLink></>) : '없음'}</td><td>대상 회사·수량은 자동 해석하지 않음 — 원문 확인</td></tr>
        <tr><td>비밀 취급 표시</td><td>{b?.비밀취급_표시 ? '있음 — 공개되지 않은 종목이 있음' : '없음'}</td><td>CUSIP→티커 매핑 {b?.매핑등급 ?? 'C'}급</td></tr>
      </tbody></table>
      <ul class="small">
        <li>13F는 분기 말 하루의 보유 내역이며, 분기 말 후 최대 45일 뒤 공개됩니다. 현재 보유 여부와 다를 수 있습니다.</li>
        <li>현금·국채·공매도와 미국 거래소에 상장되지 않은 주식은 13F에 포함되지 않습니다.</li>
        <li>2026년 1월부터 CEO는 그렉 에이블이며, 일부 종목은 다른 투자 매니저의 몫일 수 있습니다. 버핏 본인의 판단으로 단정할 수 없습니다.</li>
        <li>주식 분할: 13F 주식 수는 분기 말 기준이고 이후 분할은 보정하지 않습니다. 분기 말 이후 분할이 있었다면 "현재 추정 평가액"은 틀립니다.</li>
        <li>주식 클래스: 같은 회사의 다른 클래스(예: A주·B주)는 CUSIP이 달라 따로 집계되며, 이 종목에 연결된 CUSIP만 합칩니다(CUSIP→티커 연결은 이름 대조라 확실하지 않음).</li>
        <li>이 정보는 이 종목의 판정에 반영되지 않았습니다.</li>
      </ul>
    </Card>
  );
}

function Detail({ ticker }: { ticker: string }) {
  const p = useSignal(personal);
  const [mode, setMode] = useState<'batch' | 'instant'>('batch');
  const s = useAsync<M1Data>(async () => {
    if (/^\d{6}$/.test(ticker) || /\.(KS|KQ)$/i.test(ticker)) throw new Error('국내 종목은 버핏 분석 범위가 아닙니다');
    try { return await loadData<M1Data>(`m1/sym/${symFile(ticker)}.json`); }
    catch (e: any) { if (e?.code === 'NOT_FOUND') { setMode('instant'); return instantM1(ticker); } throw e; }
  }, [ticker, p.dataKey]);
  const [llm, setLlm] = useState<LlmResult | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const cacheKey = s.data ? `m1:${s.data.ticker}:${s.data.기준일}` : '';
  useEffect(() => { setLlm(null); if (cacheKey) void idbGet<LlmResult>(cacheKey).then((x) => x && setLlm(x)); }, [cacheKey]);
  if (!s.data) return s.error?.includes('국내') ? <Note kind="info">국내 종목은 버핏 분석 범위가 아닙니다.</Note> : <Loading s={s} />;
  const d = s.data;
  const dec = decide(d.input, d.calc, cfg, llm && !llm.error ? llm.판정 : llm?.error ? ({} as LlmJudgement) : null, llm?.report_md);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await runLlm(d); await idbSet(cacheKey, r); setLlm(r); } catch (e: any) { setErr(e?.message ?? String(e)); }
    setBusy(false);
  };
  const star = p.watchlist.includes(d.ticker);
  return (
    <>
      <h1># {d.name}({d.ticker}) 버핏식 분석 — 기준일 {d.기준일} (통화: {d.input.종목.통화}) <button class="star" aria-label="관심종목" onClick={() => updatePersonal((x) => ({ ...x, watchlist: star ? x.watchlist.filter((t) => t !== d.ticker) : [...x.watchlist, d.ticker] }))}>{star ? '★' : '☆'}</button></h1>
      {mode === 'instant' && <Note>유니버스 밖 즉시 분석 — 공시 AI 요약 없음(원문 발췌만), 뉴스 제공 안 됨. 종목을 universe.json에 넣지 않았으므로 공개되지 않습니다.</Note>}
      <Conclusion d={d} dec={dec} />
      <GateTable dec={dec} />
      <div class="row"><button disabled={busy} onClick={run} data-testid="m1-run">{busy ? 'AI 분석 중…' : llm ? '다시 분석' : 'AI 분석 실행(G1·G3·G6)'}</button></div>
      {err && <Note kind="err">{err}</Note>}
      {llm?.error && <Card title="LLM 응답"><Note kind="err">원문 + 형식 오류 — G1·G3·G6는 판단불가로 처리했습니다.</Note><pre class="excerpt">{llm.raw ?? ''}</pre></Card>}
      {llm && !llm.error && <Card title="보고서 본문(AI 작성, 3번 섹션부터)">
        {!!llm.숫자검사?.length && <Note kind="warn">숫자 검사: {llm.숫자검사.map((n) => `${n.원문}(${n.상태})`).join(', ')}</Note>}
        <Markdown md={llm.report_md} />
      </Card>}
      <Details d={d} />
      <Filings d={d} />
      <Berkshire b={d.버크셔_참고} />
      <Disclaimer text="※ 본 분석은 워런 버핏이 공개한 투자 원칙을 프로그램 규칙으로 옮긴 참고 자료입니다. 버핏 본인의 판단이나 투자 권유가 아니며, A-7절 운영 기준은 이 프로그램이 정한 값입니다." />
    </>
  );
}

export function Buffett({ arg }: { arg: string }) {
  const p = useSignal(personal);
  const idx = useAsync(() => loadData<{ rows: any[]; 수집시각: string }>('m1/index.json'), [p.dataKey]);
  const [q, setQ] = useState('');
  if (arg) return <><a href="#/buffett">← 목록</a><Detail ticker={arg} /></>;
  const rows = (idx.data?.rows ?? []).filter((r) => !q || r.ticker.includes(q.toUpperCase()) || (r.name ?? '').toUpperCase().includes(q.toUpperCase()));
  return (
    <>
      <Card title="버핏식 종목 분석">
        <Note>일일 분석 대상은 나스닥100 + S&P500 구성종목입니다. 분석 가능한 종목은 유니버스에 있는 종목뿐입니다. 종목을 추가하면 universe.json에 들어가 공개됩니다. 목록에 없는 미국 종목은 '즉시 분석'(중계 서버)으로 볼 수 있습니다.</Note>
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (q) go('buffett', q.toUpperCase()); }}>
          <input aria-label="종목 검색" placeholder="티커 검색(예: AAPL)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <button type="submit">분석</button>
        </form>
      </Card>
      <Loading s={idx} />
      {idx.data && <div class="scroll"><table class="t"><thead><tr><th>종목</th><th>판정</th><th>G2</th><th>G4</th><th>G5</th><th>안전마진(기본)</th><th>기준일</th></tr></thead><tbody>
        {rows.slice(0, 300).map((r) => <tr><td><a href={`#/buffett/${encodeURIComponent(r.ticker)}`}>{r.ticker}</a> <span class="muted">{r.name}</span></td><td>{r.error ? `데이터 없음(${r.error})` : r.판정}</td><td>{r.G2 ?? '-'}</td><td>{r.G4 ?? '-'}</td><td>{r.G5 ?? '-'}</td><td>{pct(r['안전마진%'])}</td><td>{r.기준일 ?? '-'}</td></tr>)}
      </tbody></table></div>}
      {!!q && idx.data && !rows.length && <p>목록에 없습니다. <button onClick={() => go('buffett', q.toUpperCase())}>즉시 분석</button> {/^\d{6}$/.test(q) && '— 국내 종목은 버핏 분석 범위가 아닙니다'}</p>}
      <Disclaimer />
    </>
  );
}
