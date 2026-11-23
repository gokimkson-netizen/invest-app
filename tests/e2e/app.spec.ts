import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';

const KEY = () => JSON.parse(fs.readFileSync('tests/.fixture_key.json', 'utf8')).key as string;
const TABS = ['home', 'news', 'buffett', 'report', 'mdd', 'infinite', 'soxl', 'settings', 'more', 'buffett/TST', 'mdd/TST', 'mdd/005930', 'report/TST'];

/** 개인 데이터를 IndexedDB에 직접 넣는다(설정 화면 입력과 같은 결과) */
async function seed(page: Page, personal: Record<string, unknown> = {}, local: Record<string, unknown> = {}) {
  await page.goto('/index.html');
  await page.evaluate(async ([p, l]) => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('invest-app', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const put = (k: string, v: unknown) => new Promise<void>((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); });
    const base = { v: 1, 수정시각: new Date(0).toISOString(), 기기: '', watchlist: [], m4: { TQQQ: null, SOXL: null, rules: null }, m5: { 총자산: null, 매수내역: [], 대기자산: null, rules: null, research: [] }, settings: { theme: 'auto' }, workerToken: null, dataKey: null };
    await put('personal', { ...base, ...p });
    await put('local', { geminiKey: null, pat: null, syncRepo: null, patExpires: null, lastSha: null, dirty: false, lastSync: null, syncError: null, ...l });
  }, [personal, local] as const);
  await page.reload(); // 저장소를 다시 읽도록 새로 불러온다
}
function watchConsole(page: Page) { const errs: string[] = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e))); return errs; }

for (const vp of [{ width: 360, height: 800 }, { width: 1280, height: 800 }]) {
  test(`10-1 모든 탭이 ${vp.width}×${vp.height}에서 가로 스크롤 없음·콘솔 오류 0건`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errs = watchConsole(page);
    await seed(page, { dataKey: KEY(), watchlist: ['TST'] });
    for (const t of TABS) {
      await page.goto(`/index.html#/${t}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(150);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(sw, `${t} 가로 스크롤`).toBeLessThanOrEqual(iw);
    }
    expect(errs).toEqual([]);
  });
}

test('10-2 _status.json 기준일·수집 시각이 화면에 보임', async ({ page }) => {
  await seed(page, { dataKey: KEY() });
  const st = JSON.parse(fs.readFileSync('tests/.fixture_site/data/_status.json', 'utf8'));
  await page.goto('/index.html#/home');
  await expect(page.getByTestId('base-us')).toHaveText(st.us.기준일);
  await expect(page.getByTestId('base-kr')).toHaveText(st.kr.기준일);
});

test('10-16 XSS: 악성 뉴스 제목·LLM 응답이 실행되지 않음, CSP meta 존재', async ({ page }) => {
  await seed(page, { dataKey: KEY() }, { geminiKey: 'g-test' });
  await page.route('https://generativelanguage.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ 한줄요약: '<img src=x onerror="window.__xss=1">', 중요도이유: '<script>window.__xss=1</script>', 왜중요한가: '', 누구에게영향: '', 확인된사실: [], 아직모르는것: [], 용어풀이: [{ 용어: '<svg onload=window.__xss=1>', 설명: 'x' }], 언급종목: [], 언급업종: [] }) }] } }] }) }));
  await page.goto('/index.html#/news');
  await expect(page.getByTestId('news-card').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.goto('/index.html#/buffett/TST');
  await page.reload(); // 뉴스 해설 대기열을 비우고 시작
  await page.route('https://generativelanguage.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ 판정: { G1: { 상태: '통과', 근거: 'x', 등급: 'A' }, G3: { 상태: '통과', 근거: 'x', 등급: 'A', 원인: '해당없음' }, G6: { 상태: '통과', 근거: 'x', 등급: 'A' } }, report_md: '## 3. 사업 요약\n<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>[링크](javascript:window.__xss=1)' }) }] } }] }) }));
  await page.getByTestId('m1-run').click();
  await expect(page.locator('.md h2')).toHaveText('3. 사업 요약', { timeout: 20_000 }); // 순차 호출 간격(무료 한도 대비) 때문에 대기
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(await page.locator('.md script, .md img, .md a[href^="javascript"]').count()).toBe(0);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toMatch(/connect-src 'self' https:\/\/generativelanguage\.googleapis\.com https:\/\/api\.github\.com https:\/\/relay\.test$|connect-src 'self' https:\/\/generativelanguage\.googleapis\.com https:\/\/api\.github\.com https:\/\/relay\.test;/);
});

test('10-24·25 M6: 모든 카드에 원문 링크·7개 항목, LLM 실패 시 규칙 기반 정보만 표시', async ({ page }) => {
  await seed(page, { dataKey: KEY() }, { geminiKey: 'g-test' });
  await page.route('https://generativelanguage.googleapis.com/**', (r) => r.fulfill({ status: 500, body: 'err' }));
  await page.goto('/index.html#/news');
  const cards = page.getByTestId('news-card');
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeGreaterThan(2);
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i);
    expect(await c.locator('ol.newsitems > li').count()).toBe(7);
    expect(await c.locator('a[href^="https://"]', { hasText: '원문' }).count()).toBeGreaterThan(0);
    await expect(c.getByText('뉴스 해설은 AI가 작성한 참고 자료이며 투자 권유가 아닙니다. 원문을 확인하세요.')).toBeVisible();
  }
  await expect(page.getByText('규칙 기반 정보만 표시합니다').first()).toBeVisible();
  await expect(page.getByTestId('news-meta')).toContainText('최근 지연');
});

test('10-24b M6: AI 해설 본문에 카드 목록 밖 종목명이 나오면 검사 경고(유니버스 = 공개 M3 목록)', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page, { dataKey: KEY() }, { geminiKey: 'g-test' });
  const ex = { 한줄요약: '연준이 금리를 내렸다', 중요도이유: '긴급 규칙', 왜중요한가: 'Testco Inc 같은 기업의 자금 조달 비용이 바뀐다', 누구에게영향: '대출이 있는 사람', 확인된사실: ['금리 인하 발표'], 아직모르는것: ['추가 인하'], 용어풀이: [], 언급종목: [], 언급업종: [] };
  await page.route('https://generativelanguage.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ex) }] } }] }) }));
  await page.goto('/index.html#/news');
  await expect(page.getByText(/본문에 목록 밖 종목: Testco Inc/).first()).toBeVisible({ timeout: 40_000 });
});

test('10-26 M6: 내 관심종목 표시는 브라우저에서만, Gemini 요청에 관심종목 정보 없음', async ({ page }) => {
  const bodies: string[] = [];
  await seed(page, { dataKey: KEY(), watchlist: ['TST', 'SOXL'] }, { geminiKey: 'g-test' });
  await page.route('https://generativelanguage.googleapis.com/**', async (r) => { bodies.push(r.request().postData() ?? ''); await r.fulfill({ status: 500, body: 'x' }); });
  await page.goto('/index.html#/news');
  await expect(page.locator('.badge.mine').first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) { expect(b).not.toContain('SOXL'); expect(b).not.toContain('내관심'); expect(b).not.toContain('watchlist'); }
  const raw = fs.readFileSync('tests/.fixture_site/data/m6/cards.json', 'utf8');
  expect(raw).not.toContain('내관심');
});

test('10-12 Gemini 429 → 재시도 반복 없음, 안내 문구', async ({ page }) => {
  let calls = 0;
  await seed(page, { dataKey: KEY() }, { geminiKey: 'g-test' });
  await page.route('https://generativelanguage.googleapis.com/**', (r) => { calls++; return r.fulfill({ status: 429, body: '{}' }); });
  await page.goto('/index.html#/buffett/TST');
  await page.getByTestId('m1-run').click();
  await expect(page.getByText('무료 한도 초과 — 태평양시 자정(KST 16~17시)에 초기화')).toBeVisible();
  await page.waitForTimeout(800);
  expect(calls).toBe(1);
});

test('10-15 M1: 모의 LLM 판정 → 브라우저 코드가 G9·결정표 확정 / JSON 오류 → 판단불가', async ({ page }) => {
  await seed(page, { dataKey: KEY() }, { geminiKey: 'g-test' });
  let calls = 0;
  await page.route('https://generativelanguage.googleapis.com/**', (r) => { calls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ 판정: { G1: { 상태: '통과', 근거: '이해 가능', 등급: 'A' }, G3: { 상태: '통과', 근거: '적자 없음', 등급: 'A', 원인: '해당없음' }, G6: { 상태: '조건부', 근거: '희석', 등급: 'A' } }, report_md: '## 3. 사업 요약\n본문' }) }] } }] }) }); });
  await page.goto('/index.html#/buffett/TST');
  await expect(page.getByTestId('m1-verdict')).toContainText('정량 관문만 판정됨');
  await page.getByTestId('m1-run').click();
  await expect(page.getByTestId('m1-verdict')).toContainText('관심 종목(가격 대기)');
  await expect(page.getByText('요구 35%').first()).toBeVisible(); // 조건부 1개 → 35%
  await expect(page.getByTestId('m1-buyprice')).toBeVisible();
  expect(calls).toBe(1);
  // JSON 형식 오류 → 전체 1회 재요청 후 판단불가
  await page.unroute('https://generativelanguage.googleapis.com/**');
  calls = 0;
  await page.route('https://generativelanguage.googleapis.com/**', (r) => { calls++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"판정": 깨진 JSON' }] } }] }) }); });
  await page.getByTestId('m1-run').click();
  await expect(page.getByText('원문 + 형식 오류')).toBeVisible({ timeout: 30_000 }); // 순차 호출 간격 대기
  await expect(page.getByTestId('gate-table')).toContainText('G1 능력범위판단불가');
  expect(calls).toBe(2);
});

test('10-9 M4: 규칙 파일이 없는 기기에서는 계산 결과가 출력되지 않음', async ({ page }) => {
  await seed(page, { dataKey: KEY(), m4: { TQQQ: { 종목: 'TQQQ', 원금: 10000, 분할수: 40, 회차: 0, 누적매수금: 0, 보유수량: 0, 체결: [] }, SOXL: null, rules: null } });
  await page.goto('/index.html#/infinite');
  await expect(page.getByTestId('m4-norules')).toContainText('규칙 미입력 — 무한매수법 문서 필요');
  await expect(page.getByTestId('m4-plan-TQQQ')).toContainText('규칙 미입력 — 무한매수법 문서 필요');
  expect(await page.locator('th', { hasText: '규칙ID' }).count()).toBe(0);
});

test('10-9b M4: 규칙 파일(로컬 private/에 있을 때만) 불러오기 → 주문 계획 → 체결 저장 → 회차 갱신', async ({ page }) => {
  const rf = 'private/infinite_v4.rules.json';
  test.skip(!fs.existsSync(rf), '규칙 파일은 비공개 — 로컬에서만 실행');
  await seed(page, { dataKey: KEY() });
  await page.goto('/index.html#/infinite');
  await page.getByTestId('m4-rules-file').setInputFiles(rf);
  await expect(page.getByTestId('m4-rules-msg')).toHaveText('규칙 파일 저장됨');
  await page.getByLabel('TQQQ 원금').fill('20000');
  await page.getByRole('button', { name: '시작' }).first().click();
  await expect(page.getByTestId('m4-plan-TQQQ')).toContainText('할증률');          // 범위 안 값을 직접 입력해야 계산
  const r = JSON.parse(fs.readFileSync(rf, 'utf8')).규칙.find((x: any) => x.종류 === 'FIRST_BUY');
  await page.getByLabel('TQQQ 첫 매수 할증률').fill(String(r['할증최소%'])); await page.getByLabel('TQQQ 첫 매수 할증률').blur();
  await page.getByLabel('TQQQ 사다리 개수').fill('2'); await page.getByLabel('TQQQ 사다리 개수').blur();
  await expect(page.getByTestId('m4-orders-TQQQ').locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('첫 매수 체결', { exact: true }).check();
  await page.getByTestId('m4-settle').first().getByLabel('첫 매수 체결가').fill('44');
  await page.getByRole('button', { name: '체결 결과 저장(다음 회차로)' }).first().click();
  await expect(page.getByTestId('m4-state-TQQQ')).not.toContainText('회차 T 0 /');
  await expect(page.getByTestId('m4-info-TQQQ')).toContainText('전반전');
  await expect(page.getByTestId('m4-plan-SOXL')).toHaveCount(0);                  // SOXL은 원금 미입력(카드만)
});

test('10-10b M5: 규칙 파일 형식 검사, 조건에 맞는 구간을 모두 표시(고르지 않음)', async ({ page }) => {
  await seed(page, { dataKey: KEY() });
  await page.goto('/index.html#/soxl');
  await expect(page.getByTestId('m5-rules')).toHaveText('규칙 미입력');
  await page.getByTestId('m5-rules-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ 확정: false, 분할매수: [{ 'SOXX낙폭이하%': 20, 매수금액: 1 }], 매도구간: [] })) });
  await expect(page.getByTestId('m5-rules-err')).toContainText('-100~0');
  await expect(page.getByTestId('m5-rules')).toHaveText('규칙 미입력');
  const ok = { 확정: false, 분할매수: [{ 'SOXX낙폭이하%': -10, 매수금액: 7 }, { 'SOXX낙폭이하%': -30, 매수금액: 8 }, { 'SOXX낙폭이하%': -50, 매수금액: 9 }], 매도구간: [] };
  await page.getByTestId('m5-rules-file').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ok)) });
  await expect(page.getByTestId('m5-rules')).toHaveText('규칙 미확정(참고) — 조건에 맞는 구간 2개'); // 픽스처 SOXX 전체 기간 낙폭 약 -38%
  await expect(page.getByTestId('m5-bands').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('m5-dd-basis')).toContainText('전체 기간');
  await expect(page.getByTestId('m5-dd-basis')).toContainText('-38.');
});

test('10-10 M5: 100% 초과 경고(M5 자금만)', async ({ page }) => {
  await seed(page, { dataKey: KEY(), m4: { TQQQ: { 종목: 'TQQQ', 원금: 999999, 분할수: 40, 회차: 0, 누적매수금: 0, 보유수량: 0, 체결: [] }, SOXL: null, rules: null }, m5: { 총자산: 1000, 매수내역: [{ 일자: '2026-11-01', 가격: 30, 수량: 40 }], 대기자산: 0, rules: null, research: [] } });
  await page.goto('/index.html#/soxl');
  await expect(page.getByTestId('m5-warn').first()).toContainText('100%를 넘었습니다');
  await expect(page.getByTestId('m5-rules')).toHaveText('규칙 미입력');
  await expect(page.getByTestId('m5-empty')).toBeVisible();
});

// ───── 자동 동기화(10-11·34): 모의 GitHub Contents API, 두 브라우저 프로필 ─────
function mockGithub(ctx: BrowserContext, store: { content: string | null; sha: number; puts: string[]; expire?: boolean }) {
  return ctx.route('https://api.github.com/**', async (r) => {
    const req = r.request();
    if (store.expire) return r.fulfill({ status: 401, body: '{"message":"Bad credentials"}' });
    if (req.method() === 'GET') return store.content ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: `s${store.sha}`, content: store.content }) }) : r.fulfill({ status: 404, body: '{}' });
    const b = JSON.parse(req.postData() ?? '{}');
    if (store.content && b.sha !== `s${store.sha}`) return r.fulfill({ status: 409, body: '{"message":"conflict"}' });
    store.content = b.content; store.sha++; store.puts.push(Buffer.from(b.content, 'base64').toString('utf8'));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: `s${store.sha}` } }) });
  });
}
async function setupSync(page: Page, pw: string) {
  await page.goto('/index.html#/settings');
  await page.getByPlaceholder('me/my-invest-sync').fill('me/sync');
  await page.locator('input[autocomplete="new-password"]').fill(pw);
  await page.getByPlaceholder('없음').first().fill('pat-test');
  await page.getByRole('button', { name: '저장·동기화' }).click();
  await expect(page.getByText('동기화 설정 저장')).toBeVisible({ timeout: 20_000 });
}

test('10-11 자동 동기화: A 변경 → B 반영, 저장소에는 암호문만, 동시 수정 시 충돌 화면', async ({ browser }) => {
  test.setTimeout(120_000);
  const store = { content: null as string | null, sha: 0, puts: [] as string[] };
  const A = await browser.newContext(), B = await browser.newContext();
  await mockGithub(A, store); await mockGithub(B, store);
  const pa = await A.newPage(), pb = await B.newPage();
  await seed(pa, { dataKey: KEY() }, { geminiKey: 'g-secret-A', deviceName: '기기A' });
  await seed(pb, { dataKey: KEY() }, { geminiKey: 'g-secret-B', deviceName: '기기B' });
  await setupSync(pa, '동기화암호123');
  // A: 관심종목 추가 → 자동 업로드
  await pa.goto('/index.html#/mdd/TST');
  await pa.getByRole('button', { name: '관심종목' }).click();
  await expect.poll(() => store.puts.length, { timeout: 15_000 }).toBeGreaterThan(1);
  for (const p of store.puts) { expect(p).not.toContain('TST'); expect(p).not.toContain('g-secret'); expect(p).not.toContain('pat-test'); expect(JSON.parse(p).kdf).toBe('PBKDF2-SHA256+HKDF-SHA256'); }
  // B: 같은 암호로 받기 → 반영
  await setupSync(pb, '동기화암호123');
  await pb.goto('/index.html#/home');
  await expect(pb.getByRole('link', { name: 'Testco Inc', exact: true })).toBeVisible({ timeout: 15_000 });
  // 동시 수정: B가 먼저 올림 → A는 예전 sha로 올리다 409 → 충돌 화면
  await pb.goto('/index.html#/mdd/SOXL'); await pb.getByRole('button', { name: '관심종목' }).click();
  await expect.poll(() => store.puts.length, { timeout: 15_000 }).toBeGreaterThan(2);
  await pa.goto('/index.html#/mdd/TQQQ'); await pa.getByRole('button', { name: '관심종목' }).click();
  await expect(pa.getByTestId('conflict')).toBeVisible({ timeout: 15_000 });
  await expect(pa.getByTestId('conflict')).toContainText('(기기B)');           // 다른 기기 = 마지막 수정 기기
  await pb.goto('/index.html#/settings');
  await expect(pb.getByLabel('기기 이름')).toHaveValue('기기B');               // 받기를 해도 내 기기 이름은 그대로
  for (const p of store.puts) expect(p).not.toContain('deviceName');
  await A.close(); await B.close();
});

test('10-11b 한 번도 동기화하지 않은 기기에 로컬 데이터가 있으면 첫 받기에서 조용히 덮어쓰지 않고 충돌 화면', async ({ browser }) => {
  test.setTimeout(120_000);
  const store = { content: null as string | null, sha: 0, puts: [] as string[] };
  const A = await browser.newContext(), C = await browser.newContext();
  await mockGithub(A, store); await mockGithub(C, store);
  const pa = await A.newPage(), pc = await C.newPage();
  await seed(pa, { dataKey: KEY() }, { deviceName: '기기A' });
  await seed(pc, { dataKey: KEY(), watchlist: ['SOXL'], 수정시각: '2026-11-20T00:00:00.000Z' }, { deviceName: '기기C' });
  await setupSync(pa, '암호xyz');
  await pa.goto('/index.html#/mdd/TST'); await pa.getByRole('button', { name: '관심종목' }).click();
  await expect.poll(() => store.puts.length, { timeout: 15_000 }).toBeGreaterThan(1);
  await pc.goto('/index.html#/settings');
  await pc.getByPlaceholder('me/my-invest-sync').fill('me/sync');
  await pc.locator('input[autocomplete="new-password"]').fill('암호xyz');
  await pc.getByPlaceholder('없음').first().fill('pat-test');
  await pc.getByRole('button', { name: '저장·동기화' }).click();
  await expect(pc.getByTestId('conflict')).toBeVisible({ timeout: 20_000 });
  await pc.getByRole('button', { name: '이 기기 데이터 남기기' }).click();
  await expect.poll(() => store.puts.length, { timeout: 15_000 }).toBeGreaterThan(2);
  await pc.goto('/index.html#/mdd/SOXL');
  await expect(pc.getByRole('button', { name: '관심종목' })).toHaveText('★');
  await A.close(); await C.close();
});

test('10-34 동기화 PAT 만료 → 앱은 로컬로 정상 동작, 안내 표시', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext();
  const store = { content: null as string | null, sha: 0, puts: [] as string[], expire: false };
  await mockGithub(ctx, store);
  const page = await ctx.newPage();
  await seed(page, { dataKey: KEY(), watchlist: ['TST'] });
  await setupSync(page, '동기화암호123');          // 암호·PAT 정상 설정(암호 미설정 분기를 타지 않게)
  await expect.poll(() => store.puts.length, { timeout: 15_000 }).toBeGreaterThan(0);
  store.expire = true;                               // 이후 GitHub API는 401
  await page.getByRole('button', { name: '지금 받기' }).click();
  await expect(page.getByTestId('sync-error')).toHaveText('동기화 토큰 만료 — 새로 발급하세요');
  await page.goto('/index.html#/home');
  await expect(page.getByRole('link', { name: 'Testco Inc', exact: true })).toBeVisible();
  // 암호 재설정 시에도 401이면 새 salt로 갈라지지 않고 같은 안내
  await page.goto('/index.html#/settings');
  await page.locator('input[autocomplete="new-password"]').fill('다른암호');
  await page.getByRole('button', { name: '저장·동기화' }).click();
  await expect(page.getByTestId('sync-error')).toHaveText('동기화 토큰 만료 — 새로 발급하세요');
  await ctx.close();
});

test('10-34b PAT 만료일 직접 입력 → 7일 이내면 미리 안내, 지나면 만료 안내', async ({ browser }) => {
  const ctx = await browser.newContext();
  const store = { content: null as string | null, sha: 0, puts: [] as string[] };
  await mockGithub(ctx, store);
  const page = await ctx.newPage();
  await seed(page, { dataKey: KEY() });
  await page.goto('/index.html#/settings');
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await page.getByPlaceholder('me/my-invest-sync').fill('me/sync');
  await page.getByPlaceholder('없음').first().fill('pat-test');
  await page.getByLabel('PAT 만료일').fill(soon);
  await page.locator('input[autocomplete="new-password"]').fill('암호');
  await page.getByRole('button', { name: '저장·동기화' }).click();
  await expect(page.getByText(/동기화 토큰이 [34]일 뒤 만료됩니다/)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('PAT 만료일').fill('2020-01-01');
  await page.getByRole('button', { name: '저장·동기화' }).click();
  await expect(page.locator('.note').filter({ hasText: '동기화 토큰 만료 — 새로 발급하세요' }).first()).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

// ───── 즉시 분석(10-35·30): 모의 Worker ─────
test('10-35 유니버스 밖 미국 종목 M1 즉시 분석이 배치 공개 JSON(금리·13F)을 재사용해 끝까지 산출, 국내는 범위 외', async ({ page }) => {
  const facts = JSON.parse(fs.readFileSync('tests/.fixture_site_work/raw_us/sec/TST/facts.json', 'utf8'));
  const csv = fs.readFileSync('tests/.fixture_site_work/raw_us/prices_src/us/TST.csv', 'utf8');
  const seen: string[] = [];
  await seed(page, { dataKey: KEY(), workerToken: 'tok' });
  await page.route('https://relay.test/**', (r) => {
    const u = new URL(r.request().url()); seen.push(u.pathname);
    expect(r.request().headers()['x-access-token']).toBe('tok');
    const body = u.pathname.endsWith('sec_tickers') ? { 0: { ticker: 'ZZZ', cik_str: 7, title: 'Zzz Corp' } }
      : u.pathname.endsWith('sec_sub') ? { sic: '7372', filings: { recent: { form: [], accessionNumber: [], filingDate: [], primaryDocument: [] } } }
      : u.pathname.endsWith('sec_facts') ? facts : null;
    if (u.pathname.endsWith('price_stooq')) return r.fulfill({ status: 200, contentType: 'text/csv', body: csv });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/index.html#/buffett/ZZZ');
  await expect(page.getByText('유니버스 밖 즉시 분석')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('gate-table')).toContainText('G2 해자통과');
  await expect(page.getByText(/국채10년 4\.2%/)).toBeVisible();      // 배치 공개 금리 재사용
  await expect(page.getByTestId('brk-hold')).toHaveText('미보유(최신 13F 기준)'); // 배치 공개 13F 재사용
  expect(seen.some((s) => s.includes('rates') || s.includes('13F'))).toBe(false);
  await page.goto('/index.html#/buffett/000660');
  await expect(page.getByText('국내 종목은 버핏 분석 범위가 아닙니다')).toBeVisible();
});

test('10-30 Worker 한도 초과(Error 1027) → "오늘 즉시 분석 한도 초과"', async ({ page }) => {
  await seed(page, { dataKey: KEY(), workerToken: 'tok' });
  await page.route('https://relay.test/**', (r) => r.fulfill({ status: 429, contentType: 'text/html', body: '<html>Error 1027: This website has been temporarily rate limited</html>' }));
  await page.goto('/index.html#/buffett/QQQZ');
  await expect(page.getByText(/오늘 즉시 분석 한도 초과/)).toBeVisible({ timeout: 15_000 });
});

test('10-31 즉시 분석과 일일 배치의 계산 결과 일치(고정 픽스처, Node vs 브라우저, 상대오차 1e-9)', async ({ page }) => {
  const node = JSON.parse(fs.readFileSync('tests/.parity/node.json', 'utf8'));
  await page.goto('about:blank'); // 앱 CSP 밖에서 같은 공용 모듈 번들 실행
  await page.addScriptTag({ path: 'tests/.parity/browser.js' });
  const br = await page.evaluate(() => (window as any).__parity());
  const flat = (o: any, p = ''): [string, number][] => Object.entries(o ?? {}).flatMap(([k, v]) => (typeof v === 'number' ? [[p + k, v]] : v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [])) as [string, number][];
  const a = new Map(flat(node)), b = new Map(flat(br));
  expect(a.size).toBeGreaterThan(50);
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  for (const [k, v] of a) { const w = b.get(k)!; expect(Math.abs(v - w) <= 1e-9 * Math.max(1, Math.abs(v), Math.abs(w)), `${k}: ${v} vs ${w}`).toBe(true); }
});
