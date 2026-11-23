// 자동 동기화(3-7): 비공개 GitHub 저장소 1개 + 종단간 암호화. 저장소에는 암호문만 올라간다.
// 충돌은 Contents API의 sha로 감지(409/422) → 덮어쓰지 않고 사용자가 고른다.
import { deriveBaseKey, openSync, sealSync, unb64, rand, type SyncEnvelope } from '@core/common/crypto';
import { idbGet, idbSet, idbDel } from './db';
import { personal, local, updateLocal, updatePersonal, EPOCH, type Personal } from './store';
import { signal } from './signal';

const FILE = 'invest-sync.json';
export interface Conflict { remote: Personal; remoteSha: string }
export const conflict = signal<Conflict | null>(null);
export const syncMsg = signal<string>('');

function api(path: string, init: RequestInit = {}) {
  const { pat, syncRepo } = local.value;
  return fetch(`https://api.github.com/repos/${syncRepo}/contents/${path}`, { ...init, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) } });
}
const b64u = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64u = (s: string) => new TextDecoder().decode(unb64(s.replace(/\n/g, '')));

async function baseKey(): Promise<{ key: CryptoKey; salt1: Uint8Array } | null> {
  const k = await idbGet<{ key: CryptoKey; salt1: string }>('syncKey');
  return k ? { key: k.key, salt1: unb64(k.salt1) } : null;
}
/** 암호로 기본키 유도. remember=true면 내보낼 수 없는 CryptoKey로 이 기기에 보관 */
export async function setPassword(password: string, remember: boolean): Promise<void> {
  const r = await api(FILE);
  noteExpiry(r);
  if (r.status === 401) { await fail('동기화 토큰 만료 — 새로 발급하세요'); throw new Error('동기화 토큰 만료 — 새로 발급하세요'); }
  if (!r.ok && r.status !== 404) throw new Error(`동기화 저장소 확인 실패(${r.status}) — 암호를 설정하지 않았습니다`); // 새 salt로 갈라지지 않게
  let salt1: Uint8Array;
  if (r.ok) { const env = JSON.parse(unb64u((await r.json()).content)) as SyncEnvelope; salt1 = unb64(env.salt1); }
  else salt1 = rand(16);
  const key = await deriveBaseKey(password, salt1);
  if (r.ok) { // 암호 확인
    const j = await (await api(FILE)).json();
    try { await openSync(key, JSON.parse(unb64u(j.content))); } catch { throw new Error('암호가 맞지 않습니다'); }
  }
  sessionKey = { key, salt1 };
  if (remember) await idbSet('syncKey', { key, salt1: btoa(String.fromCharCode(...salt1)) }); else await idbDel('syncKey');
}
let sessionKey: { key: CryptoKey; salt1: Uint8Array } | null = null;
async function k() { return sessionKey ?? (sessionKey = await baseKey()); }

function noteExpiry(r: Response) {
  const exp = r.headers.get('github-authentication-token-expiration');
  if (exp && exp !== local.value.patExpires) void updateLocal((l) => ({ ...l, patExpires: exp }));
}
async function fail(msg: string) { syncMsg.value = msg; await updateLocal((l) => ({ ...l, syncError: msg })); }

export function syncConfigured() { const l = local.value; return !!(l.pat && l.syncRepo); }

/** 내려받기: 원격이 바뀌었으면 반영(로컬 미전송 변경이 있으면 충돌 화면) */
export async function pull(): Promise<void> {
  if (!syncConfigured()) return;
  const key = await k(); if (!key) { await fail('동기화 암호를 입력하세요'); return; }
  const r = await api(FILE);
  noteExpiry(r);
  if (r.status === 401) { await fail('동기화 토큰 만료 — 새로 발급하세요'); return; }
  if (r.status === 404) { await push(); return; }
  if (!r.ok) { await fail(`동기화 실패(${r.status}) — 로컬 데이터로 계속 동작`); return; }
  const j = await r.json();
  if (j.sha === local.value.lastSha) { await updateLocal((l) => ({ ...l, syncError: null, lastSync: new Date().toISOString() })); return; }
  let remote: Personal;
  try { remote = await openSync<Personal>(key.key, JSON.parse(unb64u(j.content))); } catch { await fail('동기화 파일을 풀 수 없습니다(암호 불일치)'); return; }
  // 이미 동기화한 기기의 미전송 변경, 또는 한 번도 동기화하지 않은 기기에 로컬 데이터가 있으면 조용히 바꾸지 않고 고르게 한다
  const neverSynced = !local.value.lastSha && personal.value.수정시각 !== EPOCH;
  if ((local.value.dirty && local.value.lastSha) || neverSynced) { conflict.value = { remote, remoteSha: j.sha }; return; }
  await updatePersonal(() => remote, { fromSync: true });
  await updateLocal((l) => ({ ...l, lastSha: j.sha, dirty: false, syncError: null, lastSync: new Date().toISOString() }));
}

/** 올리기: 내 데이터만 암호화. Gemini 키·PAT는 Personal에 없으므로 올라가지 않는다 */
export async function push(force?: { sha: string }): Promise<void> {
  if (!syncConfigured()) return;
  const key = await k(); if (!key) { await fail('동기화 암호를 입력하세요'); return; }
  const env = await sealSync(key.key, key.salt1, personal.value);
  const body: Record<string, unknown> = { message: 'sync', content: b64u(JSON.stringify(env)) };
  const sha = force?.sha ?? local.value.lastSha;
  if (sha) body.sha = sha;
  const r = await api(FILE, { method: 'PUT', body: JSON.stringify(body) });
  noteExpiry(r);
  if (r.status === 401) { await fail('동기화 토큰 만료 — 새로 발급하세요'); return; }
  if (r.status === 409 || r.status === 422) { // 다른 기기가 먼저 바꿈 → 덮어쓰지 않음
    const g = await api(FILE); const j = await g.json();
    try { conflict.value = { remote: await openSync<Personal>(key.key, JSON.parse(unb64u(j.content))), remoteSha: j.sha }; } catch { await fail('충돌 파일을 풀 수 없습니다'); }
    return;
  }
  if (!r.ok) { await fail(`동기화 실패(${r.status}) — 로컬 데이터로 계속 동작`); return; }
  const j = await r.json();
  await updateLocal((l) => ({ ...l, lastSha: j.content.sha, dirty: false, syncError: null, lastSync: new Date().toISOString() }));
  syncMsg.value = '동기화됨';
}

export async function resolveConflict(choice: 'local' | 'remote') {
  const c = conflict.value; if (!c) return;
  conflict.value = null;
  if (choice === 'remote') { await updatePersonal(() => c.remote, { fromSync: true }); await updateLocal((l) => ({ ...l, lastSha: c.remoteSha, dirty: false })); }
  else await push({ sha: c.remoteSha });
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function schedulePush() { if (timer) clearTimeout(timer); timer = setTimeout(() => void push(), 2500); }
export function patExpiringSoon(): string | null {
  const e = local.value.patExpires; if (!e) return null;
  const t = Date.parse(e.replace(' UTC', 'Z').replace(' ', 'T'));
  if (!Number.isFinite(t)) return null;
  const days = (t - Date.now()) / 864e5;
  return days < 0 ? '동기화 토큰 만료 — 새로 발급하세요' : days < 7 ? `동기화 토큰이 ${Math.ceil(days)}일 뒤 만료됩니다` : null;
}
