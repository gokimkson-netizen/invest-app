// 설정: Gemini 키(이 기기만), 데이터 키, Worker 접근 토큰(첫 기기 1회 → 동기화로 전달), 동기화, 내보내기·가져오기, 전체 삭제
import { useState } from 'preact/hooks';
import { Card, Note } from '../components/ui';
import { personal, local, updatePersonal, updateLocal, emptyPersonal, emptyLocal, type Personal } from '../lib/store';
import { useSignal } from '../lib/signal';
import { idbClearAll } from '../lib/db';
import { clearDataCache } from '../lib/data';
import { setPassword, pull, push, syncMsg, patExpiringSoon } from '../lib/sync';
import { sealWithPassword, newDataKeyBase64, importDataKey } from '@core/common/crypto';
import { kst } from '../lib/format';
import { buildExport, parseImport } from '../lib/backup';

const maskKey = (k: string | null) => (k ? `••••${k.slice(-4)}` : '없음');

export function Settings() {
  const p = useSignal(personal), l = useSignal(local), sm = useSignal(syncMsg);
  const [gk, setGk] = useState(''); const [dk, setDk] = useState(''); const [wt, setWt] = useState('');
  const [repo, setRepo] = useState(l.syncRepo ?? ''); const [pat, setPat] = useState(''); const [pw, setPw] = useState(''); const [pexp, setPexp] = useState(l.patExpires?.slice(0, 10) ?? ''); const [remember, setRemember] = useState(true);
  const [incl, setIncl] = useState(false); const [xpw, setXpw] = useState(''); const [ipw, setIpw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const exp = patExpiringSoon();
  const doExport = async () => {
    const obj = buildExport(p, l, incl);
    const out = xpw ? await sealWithPassword(xpw, obj) : obj;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = `invest-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  const doImport = async (f: File) => {
    try {
      const r = await parseImport(await f.text(), ipw);
      await updatePersonal(() => r.personal);
      if (r.secrets) await updateLocal((x) => ({ ...x, geminiKey: r.secrets!.geminiKey ?? x.geminiKey, pat: r.secrets!.pat ?? x.pat }));
      clearDataCache(); setMsg('가져오기 완료');
    } catch (e: any) { setMsg(`가져오기 실패: ${e?.message ?? '암호가 틀렸거나 파일이 손상됨'}`); }
  };
  return (
    <>
      <Card title="Gemini 키(이 기기에만 저장, 동기화 안 함)">
        <p>현재: {maskKey(l.geminiKey)}</p>
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (gk.trim()) void updateLocal((x) => ({ ...x, geminiKey: gk.trim() })); setGk(''); }}>
          <input type="password" autocomplete="off" aria-label="Gemini 키" placeholder="브라우저용 Gemini 키" value={gk} onInput={(e) => setGk((e.target as HTMLInputElement).value)} /><button type="submit">저장</button>
          <button type="button" onClick={() => updateLocal((x) => ({ ...x, geminiKey: null }))}>삭제</button>
        </form>
        <Note>배치용 키와 <b>다른 Google Cloud 프로젝트</b>에서 만든 키를 쓰세요(무료 한도는 프로젝트 단위). 프로젝트에 결제 계정을 연결하지 마세요. 무료 티어에서는 입력·응답이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어, 이 앱은 개인 데이터를 Gemini에 보내지 않습니다.</Note>
      </Card>
      <Card title="데이터 키(시세·뉴스 복호화, 동기화됨)">
        <p>현재: {maskKey(p.dataKey)}</p>
        <form class="row" onSubmit={async (e) => { e.preventDefault(); try { await importDataKey(dk); await updatePersonal((x) => ({ ...x, dataKey: dk.trim() })); clearDataCache(); setDk(''); setMsg('데이터 키 저장됨'); } catch (x: any) { setMsg(x.message); } }}>
          <input type="password" autocomplete="off" aria-label="데이터 키" placeholder="GitHub Secrets DATA_KEY와 같은 값" value={dk} onInput={(e) => setDk((e.target as HTMLInputElement).value)} /><button type="submit">저장</button>
        </form>
        <button onClick={() => setDk(newDataKeyBase64())}>새 데이터 키 만들기(처음 설정할 때만)</button>
        {dk && <p class="small">새 키를 복사해 GitHub 저장소 Secrets의 <code>DATA_KEY</code>에 넣고, 위 '저장'을 누르세요: <code class="mono">{dk}</code></p>}
      </Card>
      <Card title="중계 서버 접근 토큰(첫 기기에서 한 번, 이후 동기화로 전달)">
        <p>현재: {maskKey(p.workerToken)} · 중계 서버: {__WORKER_URL__ || '미설정(README: Worker 배포)'}</p>
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (wt.trim()) void updatePersonal((x) => ({ ...x, workerToken: wt.trim() })); setWt(''); }}>
          <input type="password" autocomplete="off" aria-label="Worker 토큰" value={wt} onInput={(e) => setWt((e.target as HTMLInputElement).value)} /><button type="submit">저장</button>
        </form>
        <p class="small muted">토큰은 무작위 남용을 늦추는 장치이며 완전한 방어는 아닙니다.</p>
      </Card>
      <Card title="기기 간 자동 동기화(비공개 저장소 + 종단간 암호화)">
        {exp && <Note kind="warn">{exp}</Note>}
        {l.syncError && <Note kind="err" ><span data-testid="sync-error">{l.syncError}</span></Note>}
        <p>마지막 동기화: {kst(l.lastSync)} {sm && `· ${sm}`}</p>
        <form class="filters" onSubmit={async (e) => { e.preventDefault(); try { await updateLocal((x) => ({ ...x, syncRepo: repo.trim(), pat: pat.trim() || x.pat, patExpires: pexp ? pexp : x.patExpires })); if (pw) await setPassword(pw, remember); setPw(''); setPat(''); await pull(); setMsg('동기화 설정 저장'); } catch (x: any) { setMsg(x.message); } }}>
          <label>저장소(owner/name) <input value={repo} placeholder="me/my-invest-sync" onInput={(e) => setRepo((e.target as HTMLInputElement).value)} /></label>
          <label>PAT(이 기기에만) <input type="password" autocomplete="off" placeholder={maskKey(l.pat)} value={pat} onInput={(e) => setPat((e.target as HTMLInputElement).value)} /></label>
          <label>PAT 만료일(직접 입력 — GitHub가 만료 헤더를 안 줄 때 대비) <input type="date" aria-label="PAT 만료일" value={pexp} onInput={(e) => setPexp((e.target as HTMLInputElement).value)} /></label>
          <label>동기화 암호 <input type="password" autocomplete="new-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} /></label>
          <label><input type="checkbox" checked={remember} onChange={(e) => setRemember((e.target as HTMLInputElement).checked)} /> 이 기기에 키 기억(내보낼 수 없는 키로 보관)</label>
          <label>기기 이름(이 기기에만) <input aria-label="기기 이름" value={l.deviceName} onChange={(e) => updateLocal((x) => ({ ...x, deviceName: (e.target as HTMLInputElement).value }))} /></label>
          <button type="submit">저장·동기화</button>
        </form>
        <div class="row"><button onClick={() => pull()}>지금 받기</button><button onClick={() => push()}>지금 올리기</button></div>
        <ul class="small">
          <li>PAT는 fine-grained 토큰으로, 동기화 저장소 1개·Contents 읽기/쓰기 권한만 주고 만료일을 정하세요.</li>
          <li>PAT가 이 브라우저 IndexedDB에 보관됩니다. XSS가 생기면 탈취될 수 있습니다(이 앱은 CSP·새니타이저로 방어).</li>
          <li>PAT가 유출돼도 권한이 저장소 1개로 제한되고, 데이터는 암호문이라 내용이 보이지 않습니다.</li>
          <li>암호를 잊으면 동기화 데이터를 복구할 수 없습니다. 아래 내보내기로 백업하세요.</li>
          <li>Gemini 키와 PAT는 동기화하지 않습니다(기기마다 입력).</li>
        </ul>
      </Card>
      <Card title="백업: 내보내기·가져오기">
        <label><input type="checkbox" checked={incl} onChange={(e) => setIncl((e.target as HTMLInputElement).checked)} /> Gemini 키·PAT도 포함(기본 제외 — 파일이 메신저·클라우드에 남을 수 있음)</label>
        <label>파일 암호(선택) <input type="password" value={xpw} onInput={(e) => setXpw((e.target as HTMLInputElement).value)} /></label>
        <button onClick={doExport}>내보내기</button>
        <hr />
        <label>가져올 파일 암호(암호를 걸었다면) <input type="password" value={ipw} onInput={(e) => setIpw((e.target as HTMLInputElement).value)} /></label>
        <label>가져오기 <input type="file" accept=".json" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void doImport(f); }} /></label>
      </Card>
      <Card title="화면">
        <label>테마 <select value={p.settings.theme} onChange={(e) => updatePersonal((x) => ({ ...x, settings: { ...x.settings, theme: (e.target as HTMLSelectElement).value as any } }))}><option value="auto">자동</option><option value="light">밝게</option><option value="dark">어둡게</option></select></label>
      </Card>
      <Card title="개인 데이터 전체 삭제">
        <button class="danger" onClick={async () => { if (!window.confirm('이 기기의 개인 데이터·키·캐시를 모두 지웁니다. 동기화 저장소는 지우지 않습니다.')) return; await idbClearAll(); personal.value = emptyPersonal(); local.value = emptyLocal(); clearDataCache(); setMsg('삭제됨'); }}>전체 삭제</button>
      </Card>
      {msg && <Note>{msg}</Note>}
      <p class="muted small">빌드 {__BUILD_TIME__}</p>
    </>
  );
}
