// Gemini(브라우저용 키, 사용자 입력, 이 기기에만 저장). 응답은 JSON 스키마 모드로 받는다.
// - 형식 오류면 전체 1회만 재요청(M1·M2·M6 공통)
// - 429면 재시도를 반복하지 않고 안내(한도는 프로젝트 단위, 태평양시 자정 초기화)
// - 개인 데이터(M4·M5, 관심종목 목록, 보유 여부, '내 관심종목' 여부)는 절대 보내지 않는다(6절)
import llm from '@config/llm.json';
import { local } from './store';

export class GeminiError extends Error { constructor(public code: 'NO_KEY' | 'QUOTA' | 'FORMAT' | 'HTTP' | 'NETWORK', msg: string, public raw?: string) { super(msg); } }
export const QUOTA_MSG = '무료 한도 초과 — 태평양시 자정(KST 16~17시)에 초기화';
let last = 0;
let chain: Promise<unknown> = Promise.resolve();

/** 호출 사이에 간격을 두고 순차 호출(무료 티어 분당 한도 대비) */
function queued<T>(f: () => Promise<T>): Promise<T> {
  const run = async () => { const wait = last + llm.browser_min_interval_ms - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); try { return await f(); } finally { last = Date.now(); } };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

async function once(system: string, input: unknown, schema: object): Promise<{ parsed: unknown; text: string }> {
  const key = local.value.geminiKey;
  if (!key) throw new GeminiError('NO_KEY', 'Gemini 키가 없습니다 — 설정에서 입력하세요');
  let r: Response;
  try {
    r = await fetch(llm.endpoint.replace('{model}', llm.model), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { temperature: llm.temperature, responseMimeType: 'application/json', responseSchema: schema },
      }),
    });
  } catch { throw new GeminiError('NETWORK', 'Gemini에 연결하지 못했습니다'); }
  if (r.status === 429) throw new GeminiError('QUOTA', QUOTA_MSG);
  if (!r.ok) throw new GeminiError('HTTP', `Gemini 오류(${r.status})`);
  const j = await r.json().catch(() => null) as any;
  const text: string = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  try { return { parsed: JSON.parse(text), text }; } catch { throw new GeminiError('FORMAT', '응답 형식 오류', text); }
}

export async function callJson<T>(system: string, input: unknown, schema: object, validate: (x: unknown) => x is T): Promise<T> {
  return queued(async () => {
    let lastRaw = '';
    for (let i = 0; i < 2; i++) { // 최초 + 재요청 1회
      try {
        const { parsed, text } = await once(system, input, schema);
        lastRaw = text;
        if (validate(parsed)) return parsed;
      } catch (e) {
        if (e instanceof GeminiError && e.code === 'FORMAT') { lastRaw = e.raw ?? ''; continue; }
        throw e;
      }
    }
    throw new GeminiError('FORMAT', '응답 형식 오류(재요청 1회 후에도 실패)', lastRaw);
  });
}
