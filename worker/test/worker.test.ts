import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { handle, KINDS, safeEqual, DailyCounter, type Env } from '../src/index';

const ORIGIN = 'https://me.github.io';
const SECRETS = { ACCESS_TOKEN: 'tok-' + 'x'.repeat(30), SEC_USER_AGENT: 'Kim relay-alias@example.com', DART_KEY: 'dartkey1234567890', STOOQ_APIKEY: 'stooqkey99', TIINGO_TOKEN: 'tiingotoken77' };

function makeEnv(cap = 5, rl = { ip: true, all: true, sec: true }) {
  const store = new Map<string, DailyCounter>();
  const ok = (v: boolean) => ({ limit: async () => ({ success: v }) });
  const env: Env = {
    ...SECRETS, ALLOWED_ORIGIN: ORIGIN, DAILY_CAP: String(cap), RL_IP: ok(rl.ip), RL_ALL: ok(rl.all), RL_SEC: ok(rl.sec),
    COUNTER: {
      idFromName: (n: string) => n,
      get: (id: unknown) => {
        const k = String(id);
        if (!store.has(k)) { const m = new Map<string, number>(); store.set(k, new DailyCounter({ storage: { get: async (x) => m.get(x), put: async (x, v) => { m.set(x, v); } } })); }
        return { fetch: () => store.get(k)!.fetch() };
      },
    },
  };
  return env;
}
class MemCache { m = new Map<string, Response>(); async match(r: Request) { const x = this.m.get(r.url); return x ? x.clone() : undefined; } async put(r: Request, res: Response) { this.m.set(r.url, res.clone()); } }
const req = (path: string, h: Record<string, string> = {}) => new Request(`https://relay.workers.dev${path}`, { headers: { Origin: ORIGIN, 'X-Access-Token': SECRETS.ACCESS_TOKEN, ...h } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(async (u: string) => new Response(JSON.stringify({ ok: true, u: 'hidden' }), { status: 200, headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock); });

describe('중계 Worker(10절 30번)', () => {
  it('허용되지 않은 데이터 종류 거부', async () => { expect((await handle(req('/v1/anything?x=1'), makeEnv(), null)).status).toBe(404); });
  it('임의 URL 중계 거부(오픈 프록시 아님)', async () => {
    for (const p of ['/v1/sec_doc?cik=0000320193&acc=0000320193-25-000079&doc=../../x.htm', '/v1/sec_sub?cik=0000320193&url=https://evil.com', '/https://evil.com', '/v1/price_stooq?sym=https://evil.com']) {
      const r = await handle(req(p), makeEnv(), null);
      expect([400, 404]).toContain(r.status);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('토큰 없는 요청·틀린 토큰 거부', async () => {
    expect((await handle(req('/v1/sec_tickers', { 'X-Access-Token': '' }), makeEnv(), null)).status).toBe(401);
    expect((await handle(req('/v1/sec_tickers', { 'X-Access-Token': 'wrong' }), makeEnv(), null)).status).toBe(401);
  });
  it('다른 Origin 거부, CORS 허용 출처는 자기 Pages 하나', async () => {
    expect((await handle(req('/v1/sec_tickers', { Origin: 'https://evil.com' }), makeEnv(), null)).status).toBe(403);
    const r = await handle(req('/v1/sec_tickers'), makeEnv(), null);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
  it('전체 일일 상한 초과 시 거부', async () => {
    const env = makeEnv(2);
    expect((await handle(req('/v1/sec_sub?cik=0000000001'), env, null)).status).toBe(200);
    expect((await handle(req('/v1/sec_sub?cik=0000000002'), env, null)).status).toBe(200);
    const r = await handle(req('/v1/sec_sub?cik=0000000003'), env, null);
    expect(r.status).toBe(429); expect((await r.json() as any).error).toBe('DAILY_CAP');
  });
  it('IP별·SEC 속도 제한', async () => {
    expect((await handle(req('/v1/sec_tickers'), makeEnv(5, { ip: false, all: true, sec: true }), null)).status).toBe(429);
    expect((await handle(req('/v1/sec_tickers'), makeEnv(5, { ip: true, all: true, sec: false }), null)).status).toBe(429);
  });
  it('같은 종목·같은 날 요청은 캐시 응답', async () => {
    const env = makeEnv(), c = new MemCache() as unknown as Cache;
    await handle(req('/v1/sec_facts?cik=0000320193'), env, c);
    const r2 = await handle(req('/v1/sec_facts?cik=0000320193'), env, c);
    expect(r2.headers.get('X-Cache')).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('응답에 비밀값이 없음(원 출처 오류 포함), SEC User-Agent는 헤더로만', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('boom', { status: 500 }));
    const r = await handle(req('/v1/dart_list?corp=00126380'), makeEnv(), null);
    const body = await r.text();
    for (const v of Object.values(SECRETS)) expect(body).not.toContain(v);
    for (const [k, v] of r.headers) for (const s of Object.values(SECRETS)) { expect(v).not.toContain(s); void k; }
    await handle(req('/v1/sec_tickers'), makeEnv(), null);
    const call = fetchMock.mock.calls.at(-1)!;
    expect(call[1].headers['User-Agent']).toBe(SECRETS.SEC_USER_AGENT);
  });
  it('원본을 파싱하지 않고 그대로 전달', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('Date,Open,High,Low,Close,Volume\n2026-11-20,1,2,0.5,1.5,100', { status: 200, headers: { 'Content-Type': 'text/csv' } }));
    const r = await handle(req('/v1/price_stooq?sym=aapl.us'), makeEnv(), null);
    expect(await r.text()).toContain('2026-11-20,1,2,0.5,1.5,100');
  });
  it('상한 초과 상황에서도 일일 배치는 정상: 배치는 Worker를 거치지 않고 별도 키를 쓴다', () => {
    const batchSrc = ['batch/run.py', 'batch/collectors/misc.py', 'batch/collectors/sec.py', 'batch/collectors/prices.py', 'batch/collectors/universe.py'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(batchSrc).not.toMatch(/workers\.dev|worker_url|X-Access-Token/);
    expect(batchSrc).toContain('OPENDART_KEY'); // 배치 = GitHub Secrets OPENDART_KEY, Worker = 비밀값 DART_KEY(별도 발급)
    expect(fs.readFileSync('worker/src/index.ts', 'utf8')).not.toContain('OPENDART_KEY');
  });
  it('토큰 비교·종류 목록', () => {
    expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('', '')).toBe(false);
    expect(Object.keys(KINDS).sort()).toEqual(['dart_acct', 'dart_list', 'price_stooq', 'price_tiingo', 'sec_doc', 'sec_facts', 'sec_sub', 'sec_tickers']);
  });
});
