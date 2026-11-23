// 암호화 공용 모듈(Web Crypto 표준 API만 사용 — 브라우저·Node 22 공용).
// 1) 데이터 봉투(D18): 배치가 DATA_KEY(AES-256-GCM)로 암호화한 공개 JSON을 브라우저가 푼다. AAD = 파일 경로.
// 2) 동기화 봉투(3-7): 사용자 암호 → PBKDF2-SHA256(≥600,000회, salt1) → HKDF 기본키(내보낼 수 없음)
//    → 업로드마다 새 salt2로 HKDF → AES-GCM 키, 새 IV. 기본키는 non-extractable CryptoKey로 기기에 보관 가능.
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(u: Uint8Array): string { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); }
export function unb64(s: string): Uint8Array { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
export const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ───── 데이터 봉투 ─────
export interface DataEnvelope { v: 1; alg: 'A256GCM'; iv: string; ct: string; path: string; z?: 'gzip' }
export const isEnvelope = (x: unknown): x is DataEnvelope => !!x && typeof x === 'object' && (x as DataEnvelope).alg === 'A256GCM' && typeof (x as DataEnvelope).ct === 'string';

export async function importDataKey(base64Key: string): Promise<CryptoKey> {
  const raw = unb64(base64Key.trim());
  if (raw.length !== 32) throw new Error('데이터 키는 32바이트(base64)여야 합니다');
  return subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function pipe(u: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([u as BlobPart]).stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** 압축(gzip) 후 암호화 — 암호문은 압축되지 않으므로 먼저 압축한다 */
export async function sealData(key: CryptoKey, path: string, obj: unknown, gzip = true): Promise<DataEnvelope> {
  const iv = rand(12);
  let body: Uint8Array = enc.encode(JSON.stringify(obj));
  if (gzip) body = await pipe(body, new CompressionStream('gzip'));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(path) as BufferSource }, key, body as BufferSource));
  return { v: 1, alg: 'A256GCM', iv: b64(iv), ct: b64(ct), path, ...(gzip ? { z: 'gzip' as const } : {}) };
}
export async function openData<T = unknown>(key: CryptoKey, env: DataEnvelope, expectPath: string): Promise<T> {
  if (env.path !== expectPath) throw new Error('파일 경로 불일치');
  let pt: Uint8Array = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource, additionalData: enc.encode(env.path) as BufferSource }, key, unb64(env.ct) as BufferSource));
  if (env.z === 'gzip') pt = await pipe(pt, new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(pt)) as T;
}

// ───── 동기화 봉투 ─────
export const PBKDF2_ITER = 600_000;
export interface SyncEnvelope { v: 1; kdf: 'PBKDF2-SHA256+HKDF-SHA256'; iter: number; salt1: string; salt2: string; iv: string; ct: string }

export async function deriveBaseKey(password: string, salt1: Uint8Array, iter = PBKDF2_ITER): Promise<CryptoKey> {
  if (iter < PBKDF2_ITER) throw new Error(`PBKDF2 반복 횟수는 ${PBKDF2_ITER}회 이상이어야 합니다`);
  const pw = await subtle().importKey('raw', enc.encode(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt1 as BufferSource, iterations: iter }, pw, 256);
  return subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']); // non-extractable
}
async function fileKey(base: CryptoKey, salt2: Uint8Array): Promise<CryptoKey> {
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt2 as BufferSource, info: enc.encode('invest-app-sync-v1') as BufferSource }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealSync(base: CryptoKey, salt1: Uint8Array, obj: unknown, iter = PBKDF2_ITER): Promise<SyncEnvelope> {
  const salt2 = rand(16), iv = rand(12);
  const k = await fileKey(base, salt2);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, enc.encode(JSON.stringify(obj)) as BufferSource));
  return { v: 1, kdf: 'PBKDF2-SHA256+HKDF-SHA256', iter, salt1: b64(salt1), salt2: b64(salt2), iv: b64(iv), ct: b64(ct) };
}
export async function openSync<T = unknown>(base: CryptoKey, env: SyncEnvelope): Promise<T> {
  const k = await fileKey(base, unb64(env.salt2));
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(env.iv) as BufferSource }, k, unb64(env.ct) as BufferSource);
  return JSON.parse(dec.decode(pt)) as T;
}

/** 내보내기 파일 암호(선택) — 동기화와 같은 방식, 파일마다 새 salt1 */
export async function sealWithPassword(password: string, obj: unknown): Promise<SyncEnvelope> {
  const salt1 = rand(16);
  return sealSync(await deriveBaseKey(password, salt1), salt1, obj);
}
export async function openWithPassword<T = unknown>(password: string, env: SyncEnvelope): Promise<T> {
  return openSync<T>(await deriveBaseKey(password, unb64(env.salt1), env.iter), env);
}

export function newDataKeyBase64(): string { return b64(rand(32)); }
