// IndexedDB 키-값 저장소. 개인 데이터는 이 기기에만 저장되고, 동기화는 암호문만 올린다(3-7).
const DB = 'invest-app', STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await open();
  return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const q = f(t.objectStore(STORE)); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });
}
export const idbGet = <T = unknown>(k: string) => tx<T | undefined>('readonly', (s) => s.get(k));
export const idbSet = (k: string, v: unknown) => tx<void>('readwrite', (s) => s.put(v, k));
export const idbDel = (k: string) => tx<void>('readwrite', (s) => s.delete(k));
export const idbKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
export async function idbClearAll() { const d = await open(); await new Promise<void>((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
