import { emptyPersonal, type Personal } from './store';
import { openWithPassword, type SyncEnvelope } from '@core/common/crypto';
/** 내보내기: Gemini 키와 PAT는 기본으로 빠진다(포함하려면 사용자가 따로 선택, 7절) */
export function buildExport(p: Personal, l: { geminiKey: string | null; pat: string | null }, includeSecrets: boolean) {
  return { 종류: 'invest-app-backup', v: 1, 내보낸시각: new Date().toISOString(), personal: p, ...(includeSecrets ? { 기기비밀값: { geminiKey: l.geminiKey, pat: l.pat } } : {}) };
}
/** 가져오기: 암호화된 파일이면 암호로 풀고, 백업 형식인지 확인한 뒤 Personal과(선택 시) 기기 비밀값을 돌려준다 */
export async function parseImport(text: string, password: string): Promise<{ personal: Personal; secrets: { geminiKey: string | null; pat: string | null } | null }> {
  let j = JSON.parse(text);
  if (j?.kdf) {
    if (!password) throw new Error('암호가 걸린 파일입니다 — 파일 암호를 입력하세요');
    try { j = await openWithPassword(password, j as SyncEnvelope); } catch { throw new Error('암호가 틀렸거나 파일이 손상됨'); }
  }
  if (j?.종류 !== 'invest-app-backup') throw new Error('백업 파일이 아닙니다');
  return { personal: { ...emptyPersonal(), ...j.personal }, secrets: j.기기비밀값 ?? null };
}
