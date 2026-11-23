// 공개 데이터 읽기: 자기 Pages의 JSON만 읽는다(3-3 ①). 암호화된 파일(D18)은 데이터 키로 푼다.
import { importDataKey, openData, isEnvelope } from '@core/common/crypto';
import { personal } from './store';

export class DataError extends Error { constructor(public code: 'NO_KEY' | 'NOT_FOUND' | 'DECRYPT' | 'NETWORK', msg: string) { super(msg); } }
let keyCache: { b64: string; key: CryptoKey } | null = null;
const mem = new Map<string, Promise<unknown>>();

async function key(): Promise<CryptoKey> {
  const b64 = personal.value.dataKey;
  if (!b64) throw new DataError('NO_KEY', '데이터 키가 없습니다 — 설정에서 데이터 키를 입력하세요');
  if (keyCache?.b64 !== b64) keyCache = { b64, key: await importDataKey(b64) };
  return keyCache.key;
}
export function clearDataCache() { mem.clear(); }

/** rel 예: 'm3/us/index.json' → ./data/m3/us/index.json (AAD = 'data/m3/us/index.json') */
export function loadData<T = any>(rel: string): Promise<T> {
  const k = `${personal.value.dataKey ?? ''}|${rel}`;
  if (!mem.has(k)) {
    const p = (async () => {
      let r: Response;
      try { r = await fetch(`./data/${rel}`, { cache: 'no-cache' }); } catch { throw new DataError('NETWORK', '데이터를 불러오지 못했습니다'); }
      if (!r.ok) throw new DataError('NOT_FOUND', '데이터 없음(아직 배치가 실행되지 않았거나 수집 실패)');
      const j = await r.json();
      if (!isEnvelope(j)) return j as T;
      try { return await openData<T>(await key(), j, `data/${rel}`); } catch (e) { if (e instanceof DataError) throw e; throw new DataError('DECRYPT', '데이터 키가 맞지 않습니다'); }
    })();
    p.catch(() => mem.delete(k));
    mem.set(k, p);
  }
  return mem.get(k) as Promise<T>;
}
export const symFile = (t: string) => t.replace(/[^A-Za-z0-9._-]/g, '_');
