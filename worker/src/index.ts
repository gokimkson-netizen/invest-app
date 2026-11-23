// 무료 중계 서버(Cloudflare Workers Free, D8, 3-6절)
// 역할: 유니버스 밖 종목의 공개 데이터를 '파싱하지 않고 그대로' 전달(CPU 10ms 한도). 파싱·계산은 브라우저 공용 TS 모듈.
// 남용 방지: 허용된 데이터 종류만(임의 URL 중계 금지), 접근 토큰, Origin 확인, IP별·전체 분당 제한, 전체 일일 상한(Durable Object), 같은 요청 캐시.
// 비밀값(SEC 이메일, Worker 전용 OpenDART 키, Stooq·Tiingo 키, 접근 토큰)은 Worker 비밀값에만 두고 응답·로그에 넣지 않는다.

export interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }
export interface Env {
  ACCESS_TOKEN: string; SEC_USER_AGENT: string; DART_KEY?: string; STOOQ_APIKEY?: string; TIINGO_TOKEN?: string;
  ALLOWED_ORIGIN: string; DAILY_CAP?: string;
  RL_IP: RateLimit; RL_ALL: RateLimit; RL_SEC: RateLimit;
  COUNTER: DurableObjectNamespace;
}
interface DurableObjectNamespace { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request | string): Promise<Response> } }

type Kind = { 출처: 'sec' | 'dart' | 'stooq' | 'tiingo'; params: Record<string, RegExp>; optional?: Record<string, RegExp>; url: (p: Record<string, string>, env: Env) => string | null; headers?: (env: Env) => Record<string, string> };

const CIK = /^\d{10}$/, CORP = /^\d{8}$/;
export const KINDS: Record<string, Kind> = {
  sec_tickers: { 출처: 'sec', params: {}, url: () => 'https://www.sec.gov/files/company_tickers.json' },
  sec_sub: { 출처: 'sec', params: { cik: CIK }, url: (p) => `https://data.sec.gov/submissions/CIK${p.cik}.json` },
  sec_facts: { 출처: 'sec', params: { cik: CIK }, url: (p) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${p.cik}.json` },
  sec_doc: {
    출처: 'sec', params: { cik: CIK, acc: /^\d{10}-\d{2}-\d{6}$/, doc: /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(htm|html|xml|txt)$/ },
    url: (p) => `https://www.sec.gov/Archives/edgar/data/${+p.cik}/${p.acc.replace(/-/g, '')}/${p.doc}`,
  },
  dart_list: { 출처: 'dart', params: { corp: CORP }, url: (p, e) => (e.DART_KEY ? `https://opendart.fss.or.kr/api/list.json?crtfc_key=${e.DART_KEY}&corp_code=${p.corp}&page_count=50&bgn_de=${ymd(-7)}` : null) },
  dart_acct: {
    출처: 'dart', params: { corp: CORP, year: /^20\d{2}$/, reprt: /^(11011|11012|11013|11014)$/ },
    url: (p, e) => (e.DART_KEY ? `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${e.DART_KEY}&corp_code=${p.corp}&bsns_year=${p.year}&reprt_code=${p.reprt}` : null),
  },
  price_stooq: { 출처: 'stooq', params: { sym: /^[a-z0-9-]{1,12}(\.[a-z]{2})?$/ }, url: (p, e) => (e.STOOQ_APIKEY ? `https://stooq.com/q/d/l/?s=${p.sym}&i=d&apikey=${e.STOOQ_APIKEY}` : null) },
  price_tiingo: { 출처: 'tiingo', params: { t: /^[a-z0-9-]{1,10}$/ }, url: (p) => `https://api.tiingo.com/tiingo/daily/${p.t}/prices?startDate=1960-01-01`, headers: (e): Record<string, string> => (e.TIINGO_TOKEN ? { Authorization: `Token ${e.TIINGO_TOKEN}` } : {}) },
};

function ymd(days: number) { const d = new Date(Date.now() + days * 864e5); return d.toISOString().slice(0, 10).replace(/-/g, ''); }

function cors(env: Env, origin: string | null): Record<string, string> {
  return origin && origin === env.ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, Vary: 'Origin', 'Access-Control-Allow-Headers': 'X-Access-Token', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600' } : { Vary: 'Origin' };
}
function err(env: Env, origin: string | null, status: number, code: string, msg: string) {
  return new Response(JSON.stringify({ error: code, message: msg }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(env, origin) } });
}

/** 길이 비교에서도 시간 차이가 덜 나게 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
  return d === 0;
}

export async function handle(req: Request, env: Env, cache: Cache | null): Promise<Response> {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: origin === env.ALLOWED_ORIGIN ? 204 : 403, headers: cors(env, origin) });
  if (req.method !== 'GET') return err(env, origin, 405, 'METHOD', 'GET만 허용');
  // Origin 확인(위조 가능하므로 이것만 믿지 않는다)
  if (origin && origin !== env.ALLOWED_ORIGIN) return err(env, origin, 403, 'ORIGIN', '허용되지 않은 출처');
  if (!safeEqual(req.headers.get('X-Access-Token') ?? '', env.ACCESS_TOKEN ?? '')) return err(env, origin, 401, 'TOKEN', '접근 토큰이 없거나 틀림');
  const u = new URL(req.url);
  const m = u.pathname.match(/^\/v1\/([a-z_]+)$/);
  const kind = m ? KINDS[m[1]] : undefined;
  if (!kind) return err(env, origin, 404, 'KIND', '허용되지 않은 데이터 종류(임의 URL 중계 안 함)');
  const p: Record<string, string> = {};
  for (const k of u.searchParams.keys()) if (!(k in kind.params)) return err(env, origin, 400, 'PARAM', `허용되지 않은 파라미터: ${k.slice(0, 20)}`);
  for (const [k, re] of Object.entries(kind.params)) {
    const v = u.searchParams.get(k) ?? '';
    if (!re.test(v)) return err(env, origin, 400, 'PARAM', `형식 오류: ${k}`);
    p[k] = v;
  }
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await env.RL_IP.limit({ key: ip })).success) return err(env, origin, 429, 'RATE_IP', '요청이 너무 잦음(잠시 후 다시)');
  if (!(await env.RL_ALL.limit({ key: 'all' })).success) return err(env, origin, 429, 'RATE_ALL', '요청이 너무 잦음(전체)');

  const day = new Date().toISOString().slice(0, 10);
  const ckey = new Request(`https://cache.invalid/${m![1]}?${new URLSearchParams(Object.entries(p).sort()).toString()}&d=${day}`);
  if (cache) { const hit = await cache.match(ckey); if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors(env, origin))) r.headers.set(k, v); r.headers.set('X-Cache', 'HIT'); return r; } }

  // 전체 일일 상한(외부 출처 한도보다 충분히 낮게) — Durable Object 카운터(KV는 쓰기 한도가 작아 쓰지 않음)
  const cap = Number(env.DAILY_CAP ?? '2000');
  const stub = env.COUNTER.get(env.COUNTER.idFromName(day));
  const cnt = await (await stub.fetch('https://counter/inc')).json() as { n: number };
  if (cnt.n > cap) return err(env, origin, 429, 'DAILY_CAP', '오늘 즉시 분석 한도 초과');
  if (kind.출처 === 'sec' && !(await env.RL_SEC.limit({ key: 'sec' })).success) return err(env, origin, 429, 'RATE_SEC', 'SEC 속도 제한 보호(잠시 후 다시)');

  const target = kind.url(p, env);
  if (!target) return err(env, origin, 503, 'CONFIG', '중계 서버에 해당 출처 비밀값이 설정되지 않음');
  const headers: Record<string, string> = { ...(kind.headers?.(env) ?? {}) };
  if (kind.출처 === 'sec') headers['User-Agent'] = env.SEC_USER_AGENT;
  let up: Response;
  try { up = await fetch(target, { headers }); } catch { return err(env, origin, 502, 'UPSTREAM', '원 출처 연결 실패'); }
  if (!up.ok) return err(env, origin, up.status === 429 ? 429 : 502, 'UPSTREAM', `원 출처 응답 ${up.status}`);
  const res = new Response(up.body, { status: 200, headers: { 'Content-Type': up.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', ...cors(env, origin) } });
  if (cache) await cache.put(ckey, res.clone());
  return res;
}

export class DailyCounter {
  constructor(private state: { storage: { get(k: string): Promise<number | undefined>; put(k: string, v: number): Promise<void> } }) {}
  async fetch(): Promise<Response> {
    const n = ((await this.state.storage.get('n')) ?? 0) + 1;
    await this.state.storage.put('n', n);
    return new Response(JSON.stringify({ n }), { headers: { 'Content-Type': 'application/json' } });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await handle(req, env, (globalThis as unknown as { caches?: { default: Cache } }).caches?.default ?? null); }
    catch { return err(env, req.headers.get('Origin'), 500, 'INTERNAL', '내부 오류'); } // 예외 메시지(키 포함 가능)는 내보내지 않음
  },
};
