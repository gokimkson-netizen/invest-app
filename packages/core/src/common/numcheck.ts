// 10절 7번: LLM 출력 숫자 검사. 숫자 정규화(억·조·만·%·쉼표·날짜) 후 입력과 대조한다.
//  허용      : 입력값 그대로이거나 단위 환산·반올림한 값
//  확인 필요 : 입력값 두 개에서 나눗셈 등으로 파생된 비율
//  오류      : 근거 없는 숫자

export type NumStatus = '허용' | '확인 필요' | '오류';
export interface NumFinding { 원문: string; 값: number | string; 상태: NumStatus; 설명: string }

const UNIT: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3, B: 1e9, M: 1e6, K: 1e3, billion: 1e9, million: 1e6, trillion: 1e12 };
const MONEY_UNIT: Record<string, number> = { 백만원: 1e6, 백만USD: 1e6, 천원: 1e3, 원: 1, USD: 1, 억원: 1e8 };

function collect(x: unknown, nums: number[], strs: string[]): void {
  if (x === null || x === undefined) return;
  if (typeof x === 'number') { if (Number.isFinite(x)) nums.push(x); return; }
  if (typeof x === 'string') {
    strs.push(x);
    // 문자열 안 숫자(공식 요약·제목의 수치)도 입력 근거로 인정
    for (const m of x.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) { const v = parseFloat(m[0].replace(/,/g, '')); if (Number.isFinite(v)) nums.push(v); }
    return;
  }
  if (Array.isArray(x)) { x.forEach((v) => collect(v, nums, strs)); return; }
  if (typeof x === 'object') Object.values(x as Record<string, unknown>).forEach((v) => collect(v, nums, strs));
}

function stripStructure(text: string): string {
  return text
    .replace(/^#{1,6}\s*\d+(\.\d+)*\.?/gm, '')           // "## 8." 같은 머리말 번호
    .replace(/^\s*\d+[.)]\s+/gm, '')                      // 목록 번호
    .replace(/https?:\/\/\S+/g, '')                        // URL
    .replace(/\b(?:G|Gate\s?)\d\b/g, '')                   // 관문 이름 G1~G9
    .replace(/\b[A-Z]{2,}\d+\b/g, '')                      // 티커·코드 (예: CET1, ROE10 는 제외)
    .replace(/\bCET1\b|\bK-ICS\b|\b10-K\b|\b8-K\b|\b13F(-HR)?\b|\bForm\s?4\b|\bDEF\s?14A\b|\b13D\b|\b13G\b|\bS&P\s?500\b/gi, '');
}

const COUNTER = /^(가지|개|번|회|문장|단계|줄|위|차|명|건|종목|년|개월|일|분기|배)/;

export function extractNumbers(text: string): { raw: string; value: number | string; decimals: number; kind: 'num' | 'pct' | 'date' | 'year' | 'count' }[] {
  const t = stripStructure(text);
  const out: ReturnType<typeof extractNumbers> = [];
  const used: [number, number][] = [];
  const mark = (s: number, e: number) => used.push([s, e]);
  const isUsed = (s: number) => used.some(([a, b]) => s >= a && s < b);
  // 날짜
  for (const m of t.matchAll(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})|(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)) {
    const y = m[1] ?? m[4], mo = m[2] ?? m[5], d = m[3] ?? m[6];
    out.push({ raw: m[0], value: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, decimals: 0, kind: 'date' }); mark(m.index!, m.index! + m[0].length);
  }
  // 연도(FY2025, 2025년)
  for (const m of t.matchAll(/(?:FY\s?)?((?:19|20)\d{2})(?=년|\b)/g)) {
    if (isUsed(m.index!)) continue;
    out.push({ raw: m[0], value: +m[1], decimals: 0, kind: 'year' }); mark(m.index!, m.index! + m[0].length);
  }
  // 조·억 복합 (예: 3조 2,000억)
  for (const m of t.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*조\s*(\d[\d,]*(?:\.\d+)?)\s*억/g)) {
    if (isUsed(m.index!)) continue;
    const v = parseFloat(m[1].replace(/,/g, '')) * 1e12 + parseFloat(m[2].replace(/,/g, '')) * 1e8;
    out.push({ raw: m[0], value: v, decimals: -8, kind: 'num' }); mark(m.index!, m.index! + m[0].length);
  }
  for (const m of t.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(%p|%|조|억|만|천|trillion|billion|million|[BMK](?![a-zA-Z]))?/g)) {
    if (isUsed(m.index!)) continue;
    const numStr = m[1].replace(/,/g, '');
    if (!/\d/.test(numStr)) continue;
    const dec = numStr.includes('.') ? numStr.split('.')[1].length : 0;
    let v = parseFloat(numStr);
    const u = m[2];
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
    if (u === '%' || u === '%p') { out.push({ raw: m[0], value: v, decimals: dec, kind: 'pct' }); continue; }
    if (u && UNIT[u]) { v *= UNIT[u]; out.push({ raw: m[0], value: v, decimals: dec - Math.log10(UNIT[u]), kind: 'num' }); continue; }
    if (!u && COUNTER.test(after) && Math.abs(v) <= 100 && dec === 0) { out.push({ raw: m[0], value: v, decimals: 0, kind: 'count' }); continue; }
    out.push({ raw: m[0], value: v, decimals: dec, kind: 'num' });
  }
  return out;
}

function near(a: number, b: number, decimals: number): boolean {
  const tol = 0.5 * Math.pow(10, -decimals) + 1e-9 * Math.max(1, Math.abs(b));
  return Math.abs(a - b) <= tol;
}

export function checkNumbers(text: string, input: unknown, opts: { unit?: string; allowCounts?: boolean } = {}): NumFinding[] {
  const nums: number[] = [], strs: string[] = [];
  collect(input, nums, strs);
  const unitMul = opts.unit ? MONEY_UNIT[opts.unit] ?? 1 : 1;
  const cand = new Set<number>();
  for (const v of nums) { cand.add(v); cand.add(-v); cand.add(v * unitMul); cand.add(v * 100); cand.add(v / 100); }
  const candArr = [...cand];
  const joined = strs.join('\n');
  const base = nums.filter((v) => v !== 0 && Math.abs(v) < 1e16).slice(0, 600);
  const findings: NumFinding[] = [];
  for (const tok of extractNumbers(text)) {
    if (tok.kind === 'date') {
      const ok = joined.includes(tok.value as string);
      findings.push({ 원문: tok.raw, 값: tok.value, 상태: ok ? '허용' : '오류', 설명: ok ? '입력 날짜' : '입력에 없는 날짜' });
      continue;
    }
    const v = tok.value as number;
    if (tok.kind === 'year') {
      const ok = nums.includes(v) || joined.includes(String(v));
      findings.push({ 원문: tok.raw, 값: v, 상태: ok ? '허용' : '오류', 설명: ok ? '입력 연도' : '입력에 없는 연도' });
      continue;
    }
    if (tok.kind === 'count' && opts.allowCounts !== false) { findings.push({ 원문: tok.raw, 값: v, 상태: '허용', 설명: '개수 표현' }); continue; }
    const dec = Math.max(tok.decimals, -12);
    if (candArr.some((c) => near(v, c, dec))) {
      findings.push({ 원문: tok.raw, 값: v, 상태: '허용', 설명: '입력값(단위 환산·반올림 포함)' });
      continue;
    }
    // 파생 비율 탐색: a/b, a/b×100, (a−b)/b×100
    let derived = false;
    outer: for (const a of base) for (const b of base) {
      if (a === b) continue;
      const r = a / b;
      if (near(v, r, dec) || near(v, r * 100, dec) || near(v, (r - 1) * 100, dec)) { derived = true; break outer; }
    }
    findings.push({ 원문: tok.raw, 값: v, 상태: derived ? '확인 필요' : '오류', 설명: derived ? '입력값에서 파생된 비율로 보임' : '근거 없는 숫자' });
  }
  return findings;
}

export function summarizeFindings(f: NumFinding[]): { 오류: number; 확인필요: number; 허용: number } {
  return { 오류: f.filter((x) => x.상태 === '오류').length, 확인필요: f.filter((x) => x.상태 === '확인 필요').length, 허용: f.filter((x) => x.상태 === '허용').length };
}
