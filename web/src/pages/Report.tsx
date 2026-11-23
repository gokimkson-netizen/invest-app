// M2 일일 종목 리포트 — 근거는 코드가 모으고(기준일·출처·등급), LLM은 근거만으로 글을 쓴다.
import { useEffect, useState } from 'preact/hooks';
import { Card, Disclaimer, Loading, Note, useAsync } from '../components/ui';
import { loadData, symFile } from '../lib/data';
import { relay } from '../lib/relay';
import { callJson, GeminiError } from '../lib/gemini';
import { idbGet, idbSet } from '../lib/db';
import { personal } from '../lib/store';
import { useSignal } from '../lib/signal';
import { Markdown, ExtLink } from '../lib/safe';
import { fmt } from '../lib/format';
import { go } from '../lib/nav';
import { priceEvidence, earningsEvidence, M2_SYSTEM, M2_SCHEMA, type Evidence } from '@core/m2/report';
import { latestEarnings } from '@core/sec/facts';
import { parseStooqCsv, parseTiingo, parseDartList, parseDartAccounts } from '@core/parse/parsers';
import { checkNumbers } from '@core/common/numcheck';
import type { NewsCard } from '@core/news/news';

interface M2Data { ticker: string; name: string; 기준일: string | null; 주가: Evidence[]; 실적: Evidence[]; 공시: { 날짜: string; 제목: string; url: string; 등급: string }[]; 수급: { 상태: string; 사유: string }; 뉴스?: string; 뉴스목록?: { 날짜: string; 제목: string; 출처: string; 등급: string; url: string }[]; 즉시분석?: boolean }

async function instantM2(t: string): Promise<M2Data> {
  const kr = /^\d{6}$/.test(t);
  if (kr) {
    const bars = parseStooqCsv(String(await relay('price_stooq', { sym: `${t}.kr` }, 'text').catch(() => ''))).bars;
    const map = await loadData<Record<string, { corp: string; name: string }>>('shared/kr/corp_codes.json').catch(() => ({} as Record<string, { corp: string; name: string }>));
    const c = map[t];
    let 실적: Evidence[] = [], 공시: M2Data['공시'] = [];
    if (c) {
      const y = new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0);
      for (const r of ['11014', '11012', '11013', '11011']) { const j = await relay('dart_acct', { corp: c.corp, year: String(y), reprt: r }).catch(() => null); if (j?.status === '000') { 실적 = parseDartAccounts(j).flatMap((e) => [{ 항목: `${e.항목} ${e.기간}`, 수치: e.값, 기준일: null, 출처: 'OpenDART', 등급: 'A' }, { 항목: `${e.항목} 전년 대비 증감% ${e.기간}`, 수치: e['증감%'], 기준일: null, 출처: 'OpenDART', 등급: 'A' }]); break; } }
      const l = await relay('dart_list', { corp: c.corp }).catch(() => null);
      if (l) 공시 = parseDartList(l, { [t]: t }).map((n) => ({ 날짜: n.published.slice(0, 10), 제목: n.title, url: n.url, 등급: 'A' }));
    }
    return { ticker: t, name: c?.name ?? t, 기준일: bars[bars.length - 1]?.d ?? null, 주가: priceEvidence(bars, { 출처: 'Stooq', 등급: 'C' }), 실적, 공시, 수급: { 상태: '제공 안 됨', 사유: '유니버스 밖 국내 종목은 배치 데이터가 없음(KRX 수급은 약관상 미구현)' }, 뉴스: '즉시 분석에서는 뉴스 제공 안 됨', 즉시분석: true };
  }
  const T = t.toUpperCase();
  const tickers = await relay('sec_tickers', {});
  const ent = Object.values(tickers as Record<string, any>).find((v: any) => v.ticker.toUpperCase() === T.replace('.', '-')) as any;
  let bars = parseStooqCsv(String(await relay('price_stooq', { sym: `${T.toLowerCase().replace('.', '-')}.us` }, 'text').catch(() => ''))).bars, src = { 출처: 'Stooq', 등급: 'C' };
  if (!bars.length) { bars = parseTiingo(await relay('price_tiingo', { t: T.toLowerCase().replace('.', '-') }).catch(() => null)).bars; src = { 출처: 'Tiingo', 등급: 'B' }; }
  let 실적: Evidence[] = [], 공시: M2Data['공시'] = [];
  if (ent) {
    const cik = String(ent.cik_str).padStart(10, '0');
    const f = await relay('sec_facts', { cik }).catch(() => null);
    if (f) 실적 = earningsEvidence(latestEarnings(f), { 출처: 'SEC EDGAR', 등급: 'A', 기준일: bars[bars.length - 1]?.d ?? null });
    const sub = await relay('sec_sub', { cik }).catch(() => null);
    const r = sub?.filings?.recent; const cut = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    if (r) for (let i = 0; i < r.form.length && i < 60; i++) if (r.filingDate[i] >= cut) 공시.push({ 날짜: r.filingDate[i], 제목: r.form[i], url: `https://www.sec.gov/Archives/edgar/data/${+cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`, 등급: 'A' });
  }
  return { ticker: T, name: ent?.title ?? T, 기준일: bars[bars.length - 1]?.d ?? null, 주가: priceEvidence(bars, src), 실적, 공시, 수급: { 상태: '제공 안 됨', 사유: '미국 종목은 수급을 제공하지 않음' }, 뉴스: '즉시 분석에서는 뉴스 제공 안 됨', 즉시분석: true };
}

const isRep = (x: unknown): x is { report_md: string } => !!x && typeof (x as any).report_md === 'string';

function EvTable({ ev }: { ev: Evidence[] }) {
  return <table class="t"><thead><tr><th>항목</th><th>수치</th><th>기준일</th><th>출처·등급</th></tr></thead><tbody>{ev.map((e) => <tr><td>{e.항목}</td><td>{typeof e.수치 === 'number' ? fmt(e.수치) : e.수치 ?? `데이터 없음${e.비고 ? `(${e.비고})` : ''}`}</td><td>{e.기준일 ?? '-'}</td><td>{e.출처} · {e.등급}{e.등급 === 'C' ? ' (확실하지 않음)' : ''}</td></tr>)}</tbody></table>;
}

export function Report({ arg }: { arg: string }) {
  const p = useSignal(personal);
  const [q, setQ] = useState('');
  const s = useAsync<M2Data | null>(async () => {
    if (!arg) return null;
    const mkt = /^\d{6}$/.test(arg) ? 'kr' : 'us';
    let d: M2Data;
    try { d = await loadData<M2Data>(`m2/${mkt}/sym/${symFile(arg)}.json`); } catch (e: any) { if (e?.code === 'NOT_FOUND') return instantM2(arg); throw e; }
    // 뉴스: 배치 M6 카드 중 이 종목과 코드가 매칭한 것(제목·출처·등급)
    const m6 = await loadData<{ cards: NewsCard[] }>('m6/cards.json').catch(() => null);
    d.뉴스목록 = (m6?.cards ?? []).filter((c) => c.관련종목.includes(d.ticker)).slice(0, 10).map((c) => ({ 날짜: c.대표.published.slice(0, 10), 제목: c.대표.title, 출처: c.대표.source, 등급: c.대표.grade, url: c.대표.url }));
    return d;
  }, [arg, p.dataKey]);
  const [rep, setRep] = useState<{ md: string; warn: string[] } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = s.data ? `m2:${s.data.ticker}:${s.data.기준일}` : '';
  useEffect(() => { setRep(null); if (key) void idbGet<{ md: string; warn: string[] }>(key).then((x) => x && setRep(x)); }, [key]);
  const run = async () => {
    if (!s.data) return;
    setBusy(true); setErr(null);
    const input = { 종목: s.data.name, 티커: s.data.ticker, 기준일: s.data.기준일, 주가: s.data.주가, 실적: s.data.실적, 공시: s.data.공시, 수급: s.data.수급, 뉴스: s.data.뉴스목록 ?? s.data.뉴스 ?? null };
    try {
      const o = await callJson(M2_SYSTEM, input, M2_SCHEMA, isRep);
      const warn = checkNumbers(o.report_md, input).filter((x) => x.상태 !== '허용').map((x) => `${x.원문}(${x.상태})`);
      const r = { md: o.report_md, warn }; await idbSet(key, r); setRep(r);
    } catch (e) { setErr(e instanceof GeminiError ? e.message : String(e)); }
    setBusy(false);
  };
  return (
    <>
      <Card title="일일 종목 리포트">
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (q) go('report', q.trim()); }}>
          <input aria-label="종목" placeholder="티커 또는 6자리 종목코드" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <button type="submit">보기</button>
        </form>
        {!!p.watchlist.length && <p>관심종목: {p.watchlist.map((t) => <a class="chip" href={`#/report/${encodeURIComponent(t)}`}>{t}</a>)}</p>}
      </Card>
      {arg && <Loading s={s} />}
      {s.data && <>
        <Card title={`${s.data.name}(${s.data.ticker}) — 기준일 ${s.data.기준일 ?? '-'}`}>
          {s.data.즉시분석 && <Note>유니버스 밖 즉시 분석 — {s.data.뉴스}</Note>}
          <div class="row"><button disabled={busy} onClick={run}>{busy ? '작성 중…' : rep ? '다시 작성' : 'AI 리포트 작성'}</button></div>
          {err && <Note kind="err">{err}</Note>}
          {rep && <>{!!rep.warn.length && <Note kind="warn">숫자 검사: {rep.warn.join(', ')}</Note>}<Markdown md={rep.md} /></>}
        </Card>
        <Card title="근거: 주가"><EvTable ev={s.data.주가} /></Card>
        <Card title="근거: 실적">{s.data.실적.length ? <EvTable ev={s.data.실적} /> : <p class="muted">데이터 없음</p>}</Card>
        <Card title="근거: 최근 7일 공시">{s.data.공시.length ? <ul>{s.data.공시.map((d) => <li>{d.날짜} <ExtLink href={d.url}>{d.제목}</ExtLink> ({d.등급})</li>)}</ul> : <p class="muted">없음</p>}</Card>
        <Card title="근거: 뉴스(제목·출처·등급)">{s.data.뉴스목록?.length ? <ul>{s.data.뉴스목록.map((n) => <li>{n.날짜} <ExtLink href={n.url}>{n.제목}</ExtLink> — {n.출처}({n.등급}급{n.등급 === 'C' ? ', 확실하지 않음' : ''})</li>)}</ul> : <p class="muted">{s.data.뉴스 ?? '관련 뉴스 없음'}</p>}</Card>
        <Card title="근거: 수급"><p>{s.data.수급.상태} — {s.data.수급.사유}</p></Card>
      </>}
      <Disclaimer />
    </>
  );
}
