// 무료 중계 Worker 호출(3-6). 주소는 빌드 변수로 고정(설정 화면에서 입력하지 않음). 토큰은 헤더로.
import { personal } from './store';
export class RelayError extends Error { constructor(public code: 'NO_URL' | 'NO_TOKEN' | 'LIMIT' | 'AUTH' | 'UPSTREAM' | 'NETWORK', msg: string) { super(msg); } }
export const LIMIT_MSG = '오늘 즉시 분석 한도 초과';

export async function relay(kind: string, params: Record<string, string>, as: 'json' | 'text' = 'json'): Promise<any> {
  if (!__WORKER_URL__) throw new RelayError('NO_URL', '중계 서버 주소가 설정되지 않았습니다(README: Worker 배포)');
  const tok = personal.value.workerToken;
  if (!tok) throw new RelayError('NO_TOKEN', '설정에서 Worker 접근 토큰을 입력하세요');
  let r: Response;
  try { r = await fetch(`${__WORKER_URL__}/v1/${kind}?${new URLSearchParams(params)}`, { headers: { 'X-Access-Token': tok } }); }
  catch { throw new RelayError('LIMIT', `${LIMIT_MSG} 또는 중계 서버 연결 실패 — 처음 설정했다면 worker/wrangler.toml의 ALLOWED_ORIGIN이 이 사이트 주소(${location.origin})와 같은지 확인하세요(README 6단계)`); } // Error 1027은 CORS 헤더 없이 와서 네트워크 오류로 보인다
  const ct = r.headers.get('Content-Type') ?? '';
  if (!r.ok) {
    if (/1027/.test(await r.clone().text().catch(() => '')) || r.status === 429) throw new RelayError('LIMIT', LIMIT_MSG);
    if (r.status === 401) throw new RelayError('AUTH', 'Worker 접근 토큰이 틀렸습니다');
    throw new RelayError('UPSTREAM', `원 출처 응답 오류(${r.status})`);
  }
  if (as === 'text') return r.text();
  if (!ct.includes('json')) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
  return r.json();
}
