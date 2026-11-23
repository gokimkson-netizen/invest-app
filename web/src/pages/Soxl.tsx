// M5 SOXL 낙폭 매수 연구 — 연구 기록(빈 화면으로 시작, D16), 포지션 현황, 100% 검사(M5 자금만, D2), 운용 규칙표(미확정)
import { useState } from 'preact/hooks';
import { Card, Note, Disclaimer, useAsync } from '../components/ui';
import { personal, updatePersonal, type Research } from '../lib/store';
import { useSignal } from '../lib/signal';
import { loadData } from '../lib/data';
import { fmt, pct } from '../lib/format';
import { m5Status, todayBand, validateM5Rules } from '@core/m5/position';

const blank = (): Research => ({ id: crypto.randomUUID(), 제목: '', 목적: '', 조건: '', 방법: '', 결과: '', 팀장검수: '', 날짜: new Date().toISOString().slice(0, 10), 공개승인: false });

export function Soxl() {
  const p = useSignal(personal);
  const soxl = useAsync(() => loadData<any>('m3/us/sym/SOXL.json'), [p.dataKey]);
  const soxx = useAsync(() => loadData<any>('m3/us/sym/SOXX.json'), [p.dataKey]);
  const [edit, setEdit] = useState<Research | null>(null);
  const [rmsg, setRmsg] = useState<string[]>([]); const [fmsg, setFmsg] = useState<string | null>(null);
  const [buy, setBuy] = useState({ 일자: new Date().toISOString().slice(0, 10), 가격: '', 수량: '' });
  const m = p.m5;
  const last = soxl.data?.bars?.[soxl.data.bars.length - 1]?.[1] ?? null;
  const peak = soxl.data ? Math.max(...soxl.data.bars.map((b: any) => b[1])) : null;
  const st = m5Status({ 총자산: m.총자산 ?? 0, 매수내역: m.매수내역, 대기자산: m.대기자산, 현재가: last, 전고점: peak });
  const soxxDD = soxx.data?.현재낙폭?.all?.['고점대비하락률%'] ?? null;
  const band = todayBand(m.rules, soxxDD);
  const set5 = (f: (x: typeof m) => typeof m) => updatePersonal((x) => ({ ...x, m5: f(x.m5) }));
  return (
    <>
      <Card title="포지션 현황(M5 자금만 계산 — 무한매수법 원금 합산 안 함)">
        <div class="filters">
          <label>M5 총자산 <input type="number" value={m.총자산 ?? ''} onChange={(e) => set5((x) => ({ ...x, 총자산: +(e.target as HTMLInputElement).value || null }))} /></label>
          <label>대기자산 <input type="number" value={m.대기자산 ?? ''} onChange={(e) => set5((x) => ({ ...x, 대기자산: +(e.target as HTMLInputElement).value || null }))} /></label>
        </div>
        {st.경고.map((w) => <Note kind={w.includes('100%') ? 'err' : 'warn'}><span data-testid="m5-warn">{w}</span></Note>)}
        <table class="t"><tbody>
          <tr><td>총 매수금 / 투입 비율</td><td>{fmt(st.총매수금)} / {pct(st['투입비율%'])}</td></tr>
          <tr><td>평단 · 보유</td><td>{fmt(st.평단)} · {fmt(st.보유수량, 4)}주</td></tr>
          <tr><td>평가손익</td><td>{fmt(st.평가손익)} ({pct(st['평가손익률%'])}) · 현재가 {fmt(last)} ({soxl.data?.기준일 ?? '-'})</td></tr>
          <tr><td>SOXL 전고점 대비 현재 낙폭</td><td>{pct(st['전고점대비낙폭%'])}</td></tr>
        </tbody></table>
        <form class="filters" onSubmit={(e) => { e.preventDefault(); if (+buy.가격 > 0 && +buy.수량 > 0) void set5((x) => ({ ...x, 매수내역: [...x.매수내역, { 일자: buy.일자, 가격: +buy.가격, 수량: +buy.수량 }] })); }}>
          <input type="date" value={buy.일자} onInput={(e) => setBuy({ ...buy, 일자: (e.target as HTMLInputElement).value })} />
          <input type="number" step="any" placeholder="매수가" value={buy.가격} onInput={(e) => setBuy({ ...buy, 가격: (e.target as HTMLInputElement).value })} />
          <input type="number" step="any" placeholder="수량" value={buy.수량} onInput={(e) => setBuy({ ...buy, 수량: (e.target as HTMLInputElement).value })} />
          <button type="submit">매수 기록</button>
        </form>
        <details><summary>매수 내역 {m.매수내역.length}건</summary><ul>{m.매수내역.map((b, i) => <li>{b.일자} {b.수량}주 @ {b.가격} <button onClick={() => set5((x) => ({ ...x, 매수내역: x.매수내역.filter((_, j) => j !== i) }))}>삭제</button></li>)}</ul></details>
        <p><a href="#/mdd/SOXX">SOXX 낙폭 통계</a> · <a href="#/mdd/SOXL">SOXL 낙폭 통계</a></p>
      </Card>
      <Card title="운용 규칙표">
        <p data-testid="m5-rules"><b>{band.상태}</b></p>
        <p class="small" data-testid="m5-dd-basis">판단 기준: SOXX <b>전체 기간(데이터 시작일 {soxx.data?.시작일 ?? '-'}부터) 최고 종가 대비</b> 현재 낙폭 {pct(soxxDD)} · 고점 {soxx.data?.현재낙폭?.all?.고점일 ?? '-'} · 기준일 {soxx.data?.기준일 ?? '-'} · 종가(수정주가) 기준. 다른 고점 기간을 쓰려면 규칙 확정 때 정해야 합니다.</p>
        {!!band.구간.length && <ul data-testid="m5-bands">{band.구간.map((b) => <li>SOXX {b['SOXX낙폭이하%']}% 이하 구간 · 매수금액 {fmt(b.매수금액)}</li>)}</ul>}
        {m.rules && <details><summary>입력된 규칙({m.rules.확정 ? '확정' : '미확정'})</summary><pre class="small">{JSON.stringify(m.rules, null, 2)}</pre></details>}
        <label>규칙 파일 불러오기(JSON) <input type="file" accept=".json" data-testid="m5-rules-file" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; let j: unknown; try { j = JSON.parse(await f.text()); } catch { setRmsg(['JSON 형식이 아닙니다']); return; } const v = validateM5Rules(j); if (v.rules) { await set5((x) => ({ ...x, rules: v.rules })); setRmsg([]); } else setRmsg(v.errors); }} /></label>
        {m.rules && <button onClick={() => set5((x) => ({ ...x, rules: null }))}>규칙 지우기</button>}
        {!!rmsg.length && <Note kind="err"><span data-testid="m5-rules-err">규칙 파일을 받아들이지 않았습니다: {rmsg.join(' / ')}</span></Note>}
        <p class="muted">최종 운용 규칙은 아직 미확정입니다. 앱은 규칙 값을 정하거나 기본값을 넣지 않습니다. 형식: 확정(true/false), 분할매수(목록: SOXX낙폭이하% -100~0, 매수금액 양수), 매도구간(목록: 조건 글자, 매도비율% 0 초과 100 이하), 손절(조건 글자 또는 null), 대기자산비율%(0~100 또는 null). 값은 모두 직접 정합니다. 조건에 맞는 구간이 여러 개면 모두 보여주며 어느 것을 실행할지는 고르지 않습니다.</p>
      </Card>
      <Card title="연구 기록">
        {!m.research.length && <p class="muted" data-testid="m5-empty">아직 연구 기록이 없습니다. 새 연구를 작성하세요.</p>}
        <ul class="list">{m.research.map((r) => <li><button class="linklike" onClick={() => setEdit(r)}>{r.제목 || "(제목 없음)"}</button> · {r.날짜} {r.공개승인 && '· 공개 승인됨'}</li>)}</ul>
        <button onClick={() => setEdit(blank())}>새 연구 작성</button>
        <label> 파일 불러오기 <input type="file" accept=".json" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { const j = JSON.parse(await f.text()); const arr = (Array.isArray(j) ? j : [j]).filter((x) => x && typeof x.제목 === 'string').map((x) => ({ ...blank(), ...x, 공개승인: false })); await set5((x) => ({ ...x, research: [...x.research, ...arr] })); } catch { setFmsg('JSON 형식이 아닙니다'); } }} /></label>
        {fmsg && <Note kind="err">{fmsg}</Note>}
        {edit && <form class="research" onSubmit={(e) => { e.preventDefault(); void set5((x) => ({ ...x, research: [...x.research.filter((y) => y.id !== edit.id), edit] })); setEdit(null); }}>
          {(['제목', '목적', '조건', '방법', '결과', '팀장검수'] as const).map((k) => <label>{k === '팀장검수' ? '팀장 검수 결과' : k}<textarea value={edit[k]} onInput={(e) => setEdit({ ...edit, [k]: (e.target as HTMLTextAreaElement).value })} /></label>)}
          <label>날짜 <input type="date" value={edit.날짜} onInput={(e) => setEdit({ ...edit, 날짜: (e.target as HTMLInputElement).value })} /></label>
          <label><input type="checkbox" checked={edit.공개승인} onChange={(e) => setEdit({ ...edit, 공개승인: (e.target as HTMLInputElement).checked })} /> 이 기록을 공개 저장소에 올리는 것을 승인(건별). 앱은 자동으로 올리지 않으며, 승인한 기록만 '공개용 내보내기'로 파일을 받을 수 있습니다.</label>
          <div class="row"><button type="submit">저장</button><button type="button" onClick={() => setEdit(null)}>취소</button>
            {edit.공개승인 && <button type="button" onClick={() => download(`research-${edit.날짜}.json`, edit)}>공개용 내보내기</button>}
            <button type="button" class="danger" onClick={() => { void set5((x) => ({ ...x, research: x.research.filter((y) => y.id !== edit.id) })); setEdit(null); }}>삭제</button></div>
        </form>}
      </Card>
      <Disclaimer />
    </>
  );
}
function download(name: string, obj: unknown) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); a.download = name; a.click(); }
