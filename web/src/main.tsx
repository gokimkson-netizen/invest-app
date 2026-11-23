import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { loadStores, ready, personal, onPersonalChange } from './lib/store';
import { useSignal } from './lib/signal';
import { pull, schedulePush, syncConfigured, conflict, resolveConflict } from './lib/sync';
import { StatusBar } from './components/StatusBar';
import { Home } from './pages/Home';
import { News, useUrgentBadge } from './pages/News';
import { Buffett } from './pages/Buffett';
import { Report } from './pages/Report';
import { Mdd } from './pages/Mdd';
import { Infinite } from './pages/Infinite';
import { Soxl } from './pages/Soxl';
import { Settings } from './pages/Settings';
import { kst } from './lib/format';

const ROUTES: { id: string; name: string; tab?: boolean }[] = [
  { id: 'home', name: '홈', tab: true }, { id: 'news', name: '중대 뉴스', tab: true }, { id: 'buffett', name: '버핏 분석', tab: true },
  { id: 'report', name: '종목 리포트' }, { id: 'mdd', name: 'MDD', tab: true }, { id: 'infinite', name: '무한매수법' }, { id: 'soxl', name: 'SOXL 연구' }, { id: 'settings', name: '설정' },
];
const parse = () => { const h = location.hash.replace(/^#\/?/, ''); const [id, ...rest] = h.split('/'); return { id: id || 'home', arg: decodeURIComponent(rest.join('/')) }; };


function ConflictDialog() {
  const c = useSignal(conflict);
  if (!c) return null;
  return (
    <div class="modal" role="dialog" aria-label="동기화 충돌" data-testid="conflict">
      <div class="card">
        <h2>동기화 충돌</h2>
        <p>다른 기기가 먼저 데이터를 바꿨습니다. 덮어쓰지 않았습니다. 어느 쪽을 남길지 고르세요.</p>
        <p>이 기기: {kst(personal.value.수정시각)} ({personal.value.기기 || '이름 없음'})<br />다른 기기: {kst(c.remote.수정시각)} ({c.remote.기기 || '이름 없음'})</p>
        <div class="row"><button onClick={() => resolveConflict('local')}>이 기기 데이터 남기기</button><button onClick={() => resolveConflict('remote')}>다른 기기 데이터 받기</button></div>
      </div>
    </div>
  );
}

function App() {
  const [r, setR] = useState(parse());
  const ok = useSignal(ready);
  const p = useSignal(personal);
  const urgent = useUrgentBadge();
  useEffect(() => { const f = () => setR(parse()); f(); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, [ok]);
  useEffect(() => { document.documentElement.dataset.theme = p.settings.theme; }, [p.settings.theme]);
  if (!ok) return <p class="muted">불러오는 중…</p>;
  const page = (() => {
    switch (r.id) {
      case 'news': return <News />; case 'buffett': return <Buffett arg={r.arg} />; case 'report': return <Report arg={r.arg} />; case 'mdd': return <Mdd arg={r.arg} />;
      case 'infinite': return <Infinite />; case 'soxl': return <Soxl />; case 'settings': return <Settings />; case 'more': return <More />; default: return <Home />;
    }
  })();
  const tabs = ROUTES.filter((x) => x.tab);
  return (
    <div class="layout">
      <nav class="side" aria-label="메뉴">{ROUTES.map((x) => <a href={`#/${x.id}`} class={r.id === x.id ? 'on' : ''}>{x.name}{x.id === 'news' && urgent ? <span class="dot" aria-label="새 긴급 뉴스">●</span> : null}</a>)}</nav>
      <main><StatusBar />{page}</main>
      <nav class="tabs" aria-label="하단 탭">
        {tabs.map((x) => <a href={`#/${x.id}`} class={r.id === x.id ? 'on' : ''}>{x.name}{x.id === 'news' && urgent ? <span class="dot" aria-label="새 긴급 뉴스">●</span> : null}</a>)}
        <a href="#/more" class={['more', 'report', 'infinite', 'soxl', 'settings'].includes(r.id) ? 'on' : ''}>더보기</a>
      </nav>
      <ConflictDialog />
    </div>
  );
}
function More() { return <section class="card"><h2>더보기</h2><ul class="links">{ROUTES.filter((x) => !x.tab).map((x) => <li><a href={`#/${x.id}`}>{x.name}</a></li>)}</ul></section>; }

loadStores().then(async () => {
  onPersonalChange(() => syncConfigured() && schedulePush());
  if (syncConfigured()) pull().catch(() => undefined);
});
render(<App />, document.getElementById('app')!);
