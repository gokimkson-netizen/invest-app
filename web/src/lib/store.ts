// 앱 상태: 개인 데이터(동기화 대상)와 기기 전용 값(동기화 안 함)을 나눈다.
import { signal, type Signal } from './signal';
import { idbGet, idbSet } from './db';
import type { PositionState, RuleFile, UserOptions } from '@core/infinite/core';
import type { Buy, M5Rules } from '@core/m5/position';

export interface Research { id: string; 제목: string; 목적: string; 조건: string; 방법: string; 결과: string; 팀장검수: string; 날짜: string; 공개승인: boolean }
/** 동기화 대상(3-7): 관심종목, M4 기록·규칙, M5 포지션·연구, 설정, Worker 접근 토큰, 데이터 키 */
export interface Personal {
  v: 1; 수정시각: string; /** 마지막으로 수정한 기기 이름(기록용) */ 기기: string;
  watchlist: string[];
  m4: { TQQQ: PositionState | null; SOXL: PositionState | null; rules: RuleFile | null; /** 문서가 범위만 주거나 개수를 정하지 않은 값(사용자 입력) */ opts?: { TQQQ?: UserOptions; SOXL?: UserOptions } };
  m5: { 총자산: number | null; 매수내역: Buy[]; 대기자산: number | null; rules: M5Rules | null; research: Research[] };
  /** deviceName은 예전 버전 호환용(읽기만). 기기 이름은 Local.deviceName(기기 전용) */
  settings: { theme: 'auto' | 'light' | 'dark'; deviceName?: string };
  workerToken: string | null;
  dataKey: string | null;
}
/** 기기 전용(동기화·기본 내보내기 제외): Gemini 키, PAT */
export interface Local { deviceName: string; geminiKey: string | null; pat: string | null; syncRepo: string | null; patExpires: string | null; lastSha: string | null; dirty: boolean; lastSync: string | null; syncError: string | null }

export const emptyPersonal = (): Personal => ({
  v: 1, 수정시각: new Date(0).toISOString(), 기기: '', watchlist: [],
  m4: { TQQQ: null, SOXL: null, rules: null }, m5: { 총자산: null, 매수내역: [], 대기자산: null, rules: null, research: [] },
  settings: { theme: 'auto' }, workerToken: null, dataKey: null,
});
export const EPOCH = new Date(0).toISOString();
export const emptyLocal = (): Local => ({ deviceName: '', geminiKey: null, pat: null, syncRepo: null, patExpires: null, lastSha: null, dirty: false, lastSync: null, syncError: null });

export const personal: Signal<Personal> = signal(emptyPersonal());
export const local: Signal<Local> = signal(emptyLocal());
export const ready = signal(false);

const listeners: (() => void)[] = [];
export const onPersonalChange = (f: () => void) => listeners.push(f);

export async function loadStores() {
  personal.value = { ...emptyPersonal(), ...((await idbGet<Personal>('personal')) ?? {}) };
  local.value = { ...emptyLocal(), ...((await idbGet<Local>('local')) ?? {}) };
  // 예전 버전: 기기 이름이 동기화 대상(settings)에 있었음 → 기기 전용으로 옮김
  if (!local.value.deviceName && personal.value.settings.deviceName) { local.value = { ...local.value, deviceName: personal.value.settings.deviceName }; await idbSet('local', local.value); }
  ready.value = true;
}
export async function updatePersonal(f: (p: Personal) => Personal, opts: { fromSync?: boolean } = {}) {
  const n = f(structuredClone(personal.value));
  if (!opts.fromSync) n.수정시각 = new Date().toISOString();
  delete n.settings.deviceName; // 기기 이름은 동기화하지 않음
  if (!opts.fromSync) n.기기 = local.value.deviceName; // 이 기기에서 고쳤으면 이 기기 이름(없으면 빈 값). 동기화로 받은 데이터는 보낸 기기 이름 유지
  personal.value = n;
  await idbSet('personal', n);
  if (!opts.fromSync) { await updateLocal((l) => ({ ...l, dirty: true })); listeners.forEach((x) => x()); }
}
export async function updateLocal(f: (l: Local) => Local) { const n = f({ ...local.value }); local.value = n; await idbSet('local', n); }
