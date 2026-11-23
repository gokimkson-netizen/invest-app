// 원본 응답 파서 — 배치(Node)와 브라우저(즉시 분석: Worker가 원본을 그대로 전달)가 공용으로 쓴다(3-6·3-8절).
// DOMParser가 없는 Node에서도 돌도록 정규식 기반으로 구현한다.
import type { Bar } from '../mdd/mdd';
import type { InfoRow } from '../sec/berkshire';
import type { NewsItem } from '../news/news';

// ───── 가격 ─────
/** Stooq CSV: Date,Open,High,Low,Close,Volume */
export function parseStooqCsv(csv: string): { bars: Bar[]; error: string | null } {
  const t = csv.trim();
  if (!t || /^</.test(t) || /Exceeded the daily hits limit/i.test(t)) return { bars: [], error: /Exceeded/i.test(t) ? 'Stooq 일일 한도 초과' : 'CSV 아님(API 키 필요 또는 오류 페이지)' };
  if (/^No data/i.test(t)) return { bars: [], error: '데이터 없음(출처 미지원 종목)' };
  const lines = t.split(/\r?\n/);
  const head = lines[0].toLowerCase().split(',');
  const iD = head.indexOf('date'), iC = head.indexOf('close'), iH = head.indexOf('high'), iL = head.indexOf('low'), iV = head.indexOf('volume');
  if (iD < 0 || iC < 0) return { bars: [], error: 'CSV 머리글 형식 오류' };
  const bars: Bar[] = [];
  for (const ln of lines.slice(1)) {
    const p = ln.split(',');
    const c = parseFloat(p[iC]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p[iD]) || !Number.isFinite(c) || c <= 0) continue;
    const b: Bar = { d: p[iD], c };
    if (iH >= 0 && Number.isFinite(+p[iH])) b.h = +p[iH];
    if (iL >= 0 && Number.isFinite(+p[iL])) b.l = +p[iL];
    if (iV >= 0 && Number.isFinite(+p[iV])) b.v = +p[iV];
    bars.push(b);
  }
  bars.sort((a, b) => a.d.localeCompare(b.d));
  return { bars, error: bars.length ? null : '데이터 없음' };
}

/** Tiingo EOD JSON: 수정주가(adjClose 등) 사용(D3) */
export function parseTiingo(json: unknown): { bars: Bar[]; error: string | null } {
  if (!Array.isArray(json)) return { bars: [], error: (json as { detail?: string })?.detail ? 'Tiingo 오류 응답' : 'JSON 배열 아님' };
  const bars: Bar[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const d = String(r.date ?? '').slice(0, 10), c = Number(r.adjClose);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(c > 0)) continue;
    bars.push({ d, c, h: Number(r.adjHigh) || undefined, l: Number(r.adjLow) || undefined, v: Number(r.adjVolume) || undefined });
  }
  bars.sort((a, b) => a.d.localeCompare(b.d));
  return { bars, error: bars.length ? null : '데이터 없음' };
}

/** 증분 병합: 같은 날짜는 새 값으로 교체. 수정주가는 과거가 바뀔 수 있으므로 겹치는 구간에 차이가 크면 전체 재수집 필요 신호 */
export function mergeBars(old: Bar[], neu: Bar[]): { bars: Bar[]; needFull: boolean } {
  if (!old.length) return { bars: neu, needFull: false };
  const m = new Map(old.map((b) => [b.d, b]));
  let needFull = false;
  for (const b of neu) {
    const o = m.get(b.d);
    if (o && Math.abs(o.c - b.c) / o.c > 0.002) needFull = true; // 분할·배당 조정으로 과거가 바뀜
    m.set(b.d, b);
  }
  return { bars: [...m.values()].sort((a, b) => a.d.localeCompare(b.d)), needFull };
}

// ───── 공시 원문 ─────
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#160': ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–' };
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : ' '; }
      return ENT[e.toLowerCase()] ?? ' ';
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** 10-K Item 1(Business) 본문 앞부분. 목차의 'Item 1.'을 건너뛰기 위해 가장 긴 Item1~Item1A 구간을 고른다 */
export function extractItem1(text: string, maxChars = 6000): string | null {
  const re = /item\s*1\.?\s*(?:—|-|:)?\s*business/gi;
  const starts = [...text.matchAll(re)].map((m) => m.index!);
  let best: [number, number] | null = null;
  for (const s of starts) {
    const rest = text.slice(s);
    const e = rest.search(/item\s*1a\.?\s*(?:—|-|:)?\s*risk\s*factors/i);
    const len = e < 0 ? Math.min(rest.length, 200000) : e;
    if (!best || len > best[1]) best = [s, len];
  }
  if (!best || best[1] < 500) return null;
  return text.slice(best[0], best[0] + Math.min(best[1], maxChars)).trim();
}

/** 국내 사업보고서 'II. 사업의 내용' 앞부분 */
export function extractKrBusiness(text: string, maxChars = 6000): string | null {
  const i = text.search(/II\.\s*사업의\s*내용/);
  if (i < 0) return null;
  const rest = text.slice(i);
  const e = rest.search(/III\.\s*재무에\s*관한\s*사항/);
  return rest.slice(0, Math.min(e < 0 ? rest.length : e, maxChars)).trim();
}

/** DEF 14A에서 지분·보수 관련 부분 발췌 */
export function extractProxy(text: string, maxEach = 3000): { 지분: string | null; 보수: string | null } {
  const pick = (re: RegExp) => {
    const ms = [...text.matchAll(re)].map((m) => m.index!);
    if (!ms.length) return null;
    const s = ms.length > 1 ? ms[1] : ms[0]; // 첫 번째는 목차일 가능성
    return text.slice(s, s + maxEach).trim();
  };
  return { 지분: pick(/security\s+ownership\s+of\s+certain\s+beneficial\s+owners/gi), 보수: pick(/compensation\s+discussion\s+and\s+analysis/gi) };
}

// ───── 13F 정보표 XML ─────
const tag = (s: string, t: string) => { const m = s.match(new RegExp(`<(?:\\w+:)?${t}>([\\s\\S]*?)</(?:\\w+:)?${t}>`, 'i')); return m ? m[1].trim() : null; };
export function parse13FInfoTable(xml: string): InfoRow[] {
  const rows: InfoRow[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const b = m[1];
    const amt = tag(b, 'shrsOrPrnAmt') ?? '';
    rows.push({
      nameOfIssuer: tag(b, 'nameOfIssuer') ?? '', titleOfClass: tag(b, 'titleOfClass') ?? '', cusip: (tag(b, 'cusip') ?? '').toUpperCase(),
      value: Number(tag(b, 'value') ?? 0), sshPrnamt: Number(tag(amt, 'sshPrnamt') ?? 0), sshPrnamtType: tag(amt, 'sshPrnamtType') ?? undefined,
      putCall: tag(b, 'putCall'),
    });
  }
  return rows;
}
/** 13F 표지: 비밀 취급(confidential treatment) 표시 */
export function parse13FCover(xml: string): { period: string | null; confidential: boolean } {
  const p = tag(xml, 'periodOfReport');
  const iso = p && /^\d{2}-\d{2}-\d{4}$/.test(p) ? `${p.slice(6)}-${p.slice(0, 2)}-${p.slice(3, 5)}` : p;
  const conf = /<(?:\w+:)?confidentialOmitted>\s*(true|Y)\s*</i.test(xml) || /isConfidentialOmitted>\s*true/i.test(xml);
  return { period: iso, confidential: conf };
}
/** Form 4 XML → 거래 요약 */
export function parseForm4(xml: string): { 거래일: string | null; 주식수: number; 가격: number | null; ticker: string | null }[] {
  const ticker = tag(xml, 'issuerTradingSymbol');
  const out = [];
  for (const m of xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)) {
    const b = m[1];
    const d = tag(tag(b, 'transactionDate') ?? '', 'value');
    const sh = Number(tag(tag(b, 'transactionShares') ?? '', 'value') ?? 0);
    const pr = tag(tag(b, 'transactionPricePerShare') ?? '', 'value');
    const code = tag(tag(b, 'transactionAcquiredDisposedCode') ?? '', 'value');
    out.push({ 거래일: d, 주식수: code === 'D' ? -sh : sh, 가격: pr ? Number(pr) : null, ticker });
  }
  return out;
}

// ───── RSS·Atom ─────
const cdata = (s: string | null) => (s ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
export function parseFeed(xml: string, src: { id: string; 이름: string; domain: string; grade: 'A' | 'B' | 'C'; kind: NewsItem['kind']; market: NewsItem['market']; summary_allowed?: boolean }): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = htmlToText(cdata(tag(b, 'title')));
    let link = cdata(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const date = cdata(tag(b, 'pubDate')) || cdata(tag(b, 'updated')) || cdata(tag(b, 'published')) || cdata(tag(b, 'dc:date'));
    const t = Date.parse(date);
    if (!title || !link || !/^https?:\/\//.test(link) || !Number.isFinite(t)) continue;
    const summary = src.summary_allowed ? htmlToText(cdata(tag(b, 'description') ?? tag(b, 'summary'))).slice(0, 500) || null : null;
    items.push({ id: `${src.id}:${hash(link)}`, title: title.slice(0, 300), summary, source: src.이름, domain: src.domain, grade: src.grade, url: link, published: new Date(t).toISOString(), kind: src.kind, market: src.market });
  }
  return items;
}

/** DART list.json → NewsItem(공시) */
export function parseDartList(json: unknown, uniByCode: Record<string, string>): NewsItem[] {
  const list = (json as { list?: Record<string, string>[] })?.list ?? [];
  return list.filter((r) => uniByCode[r.stock_code]).map((r) => ({
    id: `dart:${r.rcept_no}`, title: `${r.corp_name} ${r.report_nm}`.trim(), summary: null, source: 'DART', domain: 'dart.fss.or.kr', grade: 'A' as const,
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`,
    published: `${r.rcept_dt.slice(0, 4)}-${r.rcept_dt.slice(4, 6)}-${r.rcept_dt.slice(6, 8)}T06:30:00Z`, // 접수 시각이 없어 장 마감(15:30 KST) 기준
    kind: 'filing' as const, market: 'KR' as const, tickers: [uniByCode[r.stock_code]],
  }));
}

/** DART 주요계정(fnlttSinglAcnt) → M2 실적 */
export function parseDartAccounts(json: unknown): { 항목: string; 기간: string; 값: number | null; 전년동기: number | null; '증감%': number | null }[] {
  const list = (json as { list?: Record<string, string>[] })?.list ?? [];
  const want: Record<string, string> = { 매출액: '매출', 영업이익: '영업이익', 당기순이익: '순이익' };
  const num = (s?: string) => (s && s !== '-' ? Number(s.replace(/,/g, '')) : null);
  const rows = list.filter((r) => want[r.account_nm] && (r.fs_div === 'CFS' || !list.some((x) => x.fs_div === 'CFS')));
  return rows.map((r) => {
    const cur = num(r.thstrm_amount), prev = num(r.frmtrm_amount);
    return { 항목: want[r.account_nm], 기간: `${r.bsns_year} ${r.reprt_code}`, 값: cur, 전년동기: prev, '증감%': cur !== null && prev ? ((cur - prev) / Math.abs(prev)) * 100 : null };
  });
}

export function hash(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
