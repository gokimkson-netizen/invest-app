// M4 무한매수법 계산기 — 계산·기록·모니터링만(주문 실행 없음). 규칙 값은 사용자가 불러온 규칙 파일(IndexedDB·암호화 동기화)에만 있다.
import { useState } from 'preact/hooks';
import { Card, Note, Disclaimer, useAsync } from '../components/ui';
import { personal, updatePersonal } from '../lib/store';
import { useSignal } from '../lib/signal';
import { loadData, symFile } from '../lib/data';
import { fmt } from '../lib/format';
import { newState, applyFills, avgCost, plan, validateRuleFile, setRound, settleDay, newCycle, migrateState, SPLITS, type Symbol, type RuleFile, type Fill, type UserOptions, type PlanResult } from '@core/infinite/core';

const FIXED = '계산 결과이며 주문은 사용자가 직접 또는 별도 자동매매 프로그램에서 실행합니다.';
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function Settle({ r, onSave }: { r: PlanResult; onSave: (fills: Fill[]) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState(() => r.주문.map((o) => ({ on: false, 수량: String(o.수량), 가격: o.가격 != null ? String(o.가격) : '' })));
  const [err, setErr] = useState<string | null>(null);
  const [day, setDay] = useState(today);
  return (
    <form data-testid="m4-settle" onSubmit={(e) => {
      e.preventDefault();
      try {
        const fills: Fill[] = r.주문.flatMap((o, i) => rows[i]?.on ? [{ 일자: day, 구분: o.구분, 수량: +rows[i].수량, 가격: +rows[i].가격, 역할: o.역할 }] : []);
        for (const f of fills) if (!(f.수량 > 0) || !(f.가격 > 0)) throw new Error('체결 수량과 실제 체결가(LOC·MOC는 그날 종가)를 입력하세요');
        onSave(fills); setErr(null);
      } catch (x: any) { setErr(x.message); }
    }}>
      <p class="small">체결된 주문에 표시하고 실제 체결 수량·가격을 넣은 뒤 저장하면 평단·보유·잔금·회차가 규칙대로 갱신됩니다. 아무것도 체결되지 않았으면 표시 없이 저장하세요.</p>
      <label>체결일 <input type="date" value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} /></label>
      <table class="t"><tbody>{r.주문.map((o, i) => (
        <tr><td><label><input type="checkbox" aria-label={`${o.종류} 체결`} checked={rows[i]?.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: (e.target as HTMLInputElement).checked } : x)))} /> {o.종류}</label></td>
          <td><input type="number" step="any" aria-label={`${o.종류} 체결 수량`} value={rows[i]?.수량} onInput={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, 수량: (e.target as HTMLInputElement).value } : x)))} /></td>
          <td><input type="number" step="any" aria-label={`${o.종류} 체결가`} placeholder="체결가" value={rows[i]?.가격} onInput={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, 가격: (e.target as HTMLInputElement).value } : x)))} /></td></tr>
      ))}</tbody></table>
      <button type="submit">체결 결과 저장(다음 회차로)</button>
      {err && <Note kind="err">{err}</Note>}
    </form>
  );
}

function Sym({ s, rules }: { s: Symbol; rules: RuleFile | null }) {
  const p = useSignal(personal);
  const raw = p.m4[s];
  const st = raw ? migrateState(raw) : null;
  const sym = useAsync(() => loadData<any>(`m3/us/sym/${symFile(s)}.json`), [p.dataKey]);
  const bars: [string, number][] = sym.data?.bars ?? [];
  const close = bars.length ? bars[bars.length - 1][1] : null;
  const opts: UserOptions = p.m4.opts?.[s] ?? {};
  const [cap, setCap] = useState('');
  const [f, setF] = useState<{ 구분: '매수' | '매도'; 수량: string; 가격: string; 일자: string }>({ 구분: '매수', 수량: '', 가격: '', 일자: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState<string | null>(null);
  const [ver, setVer] = useState(0);
  const save = (n: typeof raw) => updatePersonal((x) => ({ ...x, m4: { ...x.m4, [s]: n } }));
  const setOpt = (k: keyof UserOptions, v: number | null) => updatePersonal((x) => ({ ...x, m4: { ...x.m4, opts: { ...x.m4.opts, [s]: { ...x.m4.opts?.[s], [k]: v } } } }));
  if (!st) return (
    <Card title={`${s} (원금 독립, ${SPLITS}분할)`}>
      <form class="row" onSubmit={(e) => { e.preventDefault(); if (+cap > 0) void save(newState(s, +cap)); }}><input type="number" aria-label={`${s} 원금`} placeholder="원금(달러)" value={cap} onInput={(e) => setCap((e.target as HTMLInputElement).value)} /><button type="submit">시작</button></form>
    </Card>
  );
  const r = plan(st, rules, { 기준일: sym.data?.기준일 ?? '', 전일종가: close, 최근종가: bars.slice(-30).map((b) => b[1]) }, { user: opts });
  const i = r.정보;
  const ended = st.보유수량 === 0 && st.회차 === 0 && st.체결.length > 0 && st.체결[st.체결.length - 1].구분 === '매도';
  return (
    <Card title={`${s} (원금 독립, ${SPLITS}분할 · 사이클 ${st.사이클})`}>
      <p data-testid={`m4-state-${s}`}>모드 <b>{st.모드}</b>{st.모드 === '리버스' ? ` ${st.리버스일차}일차` : ''} · 회차 T {fmt(st.회차, 6)} / {st.분할수} · 원금 {fmt(st.원금)} · 잔금 {fmt(st.잔금)} · 보유 {fmt(st.보유수량, 4)}주 · 평단 {fmt(avgCost(st))} · 전일 종가 {fmt(close)} ({sym.data?.기준일 ?? '-'})</p>
      <div class="filters">
        <label>첫 매수 할증률(%) <input type="number" step="any" aria-label={`${s} 첫 매수 할증률`} value={opts['첫매수할증%'] ?? ''} onChange={(e) => setOpt('첫매수할증%', num((e.target as HTMLInputElement).value))} /></label>
        <label>사다리 개수 <input type="number" min="0" step="1" aria-label={`${s} 사다리 개수`} value={opts.사다리개수 ?? ''} onChange={(e) => setOpt('사다리개수', num((e.target as HTMLInputElement).value))} /></label>
      </div>
      <p class="small muted">첫 매수 할증률은 규칙 파일의 범위 안에서, 사다리 개수는 문서에 정해져 있지 않아 직접 정합니다(기본값 없음).</p>
      <h3>오늘 넣을 주문 계획</h3>
      {r.상태 === '정상' && i && <p data-testid={`m4-info-${s}`}>구간 <b>{i.구간}</b> · 1회매수금 {fmt(i['1회매수금'])} · 별% {i['별%'] != null ? fmt(i['별%'], 4) + '%' : '-'} · 별지점 {fmt(i.별지점)} · 매수점 {fmt(i.매수점)}</p>}
      {r.상태 === '정상' ? <>
        <table class="t" data-testid={`m4-orders-${s}`}><thead><tr><th>종류</th><th>주문</th><th>구분</th><th>가격</th><th>수량</th><th>규칙ID</th></tr></thead><tbody>{r.주문.map((o) => <tr><td>{o.종류}</td><td>{o.주문유형}</td><td>{o.구분}</td><td>{o.가격 == null ? '시장가(종가)' : fmt(o.가격)}</td><td>{fmt(o.수량, 4)}</td><td>{o.규칙ID}</td></tr>)}</tbody></table>
        {i?.참고.map((n) => <p class="small muted">{n}</p>)}
        <p class="small">증권사가 주문을 거부하면 규칙 문서의 예외 대응 절차를 따르세요(앱은 계산하지 않음).</p>
        <h3>체결 결과 입력</h3>
        <Settle key={`${ver}-${st.체결.length}-${r.주문.length}`} r={r} onSave={(fills) => { try { void save(settleDay(st, rules!, r, fills)); setVer(ver + 1); setErr(null); } catch (x: any) { setErr(x.message); } }} />
      </> : <Note kind="warn"><span data-testid={`m4-plan-${s}`}>{r.메시지}</span></Note>}
      {ended && <Card title="사이클 종료 — 새 사이클 원금">
        <p class="small">복리(잔금 전체)·단리(처음 원금) 중 직접 고르세요.</p>
        <div class="row"><button onClick={() => save(newCycle(st, st.잔금))}>잔금 {fmt(st.잔금)}으로 시작</button><button onClick={() => save(newCycle(st, st.원금))}>원금 {fmt(st.원금)}으로 시작</button></div>
      </Card>}
      <details><summary>수동 기록·수정(규칙 갱신 없이)</summary>
        <form class="filters" onSubmit={(e) => { e.preventDefault(); try { const fill: Fill = { 일자: f.일자, 구분: f.구분, 수량: +f.수량, 가격: +f.가격, 역할: 'manual' }; void save(applyFills(st, [fill])); setErr(null); setF({ ...f, 수량: '', 가격: '' }); } catch (x: any) { setErr(x.message); } }}>
          <select value={f.구분} onChange={(e) => setF({ ...f, 구분: (e.target as HTMLSelectElement).value as any })}><option>매수</option><option>매도</option></select>
          <input type="date" value={f.일자} onInput={(e) => setF({ ...f, 일자: (e.target as HTMLInputElement).value })} />
          <input type="number" step="any" placeholder="수량" value={f.수량} onInput={(e) => setF({ ...f, 수량: (e.target as HTMLInputElement).value })} />
          <input type="number" step="any" placeholder="가격" value={f.가격} onInput={(e) => setF({ ...f, 가격: (e.target as HTMLInputElement).value })} />
          <button type="submit">기록</button>
        </form>
        <label>회차 직접 수정 <input type="number" step="any" value={st.회차} onChange={(e) => { try { void save(setRound(st, +(e.target as HTMLInputElement).value)); } catch (x: any) { setErr(x.message); } }} /></label>
      </details>
      {err && <Note kind="err">{err}</Note>}
      <details><summary>체결 기록 {st.체결.length}건</summary><ul>{st.체결.map((x) => <li>{x.일자} {x.구분} {x.수량}주 @ {x.가격}{x.역할 && x.역할 !== 'manual' ? ` (${x.역할})` : ''}</li>)}</ul></details>
      <button class="danger" onClick={() => confirm2(() => save(null))}>이 종목 기록 초기화</button>
    </Card>
  );
}
function confirm2(f: () => void) { if (window.confirm('정말 초기화할까요? 되돌릴 수 없습니다.')) f(); }

export function Infinite() {
  const p = useSignal(personal);
  const [msg, setMsg] = useState<string[] | null>(null);
  const onFile = async (file: File) => {
    try {
      const j = JSON.parse(await file.text()) as RuleFile;
      const v = validateRuleFile(j, { allowDummy: false });
      if (!v.ok) { setMsg(v.errors); return; } // 스키마 검증을 통과한 경우에만 저장
      await updatePersonal((x) => ({ ...x, m4: { ...x.m4, rules: j } }));
      setMsg(['규칙 파일 저장됨']);
    } catch { setMsg(['JSON 파일이 아닙니다']); }
  };
  return (
    <>
      <Note kind="warn">{FIXED}</Note>
      <Card title="규칙 파일(무한매수법 V4.0)">
        {p.m4.rules ? <p data-testid="m4-rules">버전 {p.m4.rules.버전} · 작성일 {p.m4.rules.작성일} · 규칙 {p.m4.rules.규칙.length}개 <button onClick={() => updatePersonal((x) => ({ ...x, m4: { ...x.m4, rules: null } }))}>삭제</button></p> : <p data-testid="m4-norules"><b>규칙 미입력 — 무한매수법 문서 필요</b></p>}
        <label>규칙 파일 불러오기 <input type="file" data-testid="m4-rules-file" accept="application/json,.json" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void onFile(f); }} /></label>
        {msg && <Note kind={msg[0] === '규칙 파일 저장됨' ? 'info' : 'err'}><span data-testid="m4-rules-msg">{msg.map((m) => <div>{m}</div>)}</span></Note>}
        <p class="muted">규칙 파일(infinite_v4.rules.json)은 문서를 보고 만든 비공개 파일입니다. 이 기기 IndexedDB와 암호화 동기화에만 저장됩니다. 계산 엔진(Core)의 입력·출력 스키마는 docs/infinite-core-schema.md에 있습니다.</p>
      </Card>
      <Sym s="TQQQ" rules={p.m4.rules} />
      <Sym s="SOXL" rules={p.m4.rules} />
      <Disclaimer text={FIXED} />
    </>
  );
}
