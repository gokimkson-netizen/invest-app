// 홈: 오늘의 긴급·높음 뉴스 상위 3개, 관심종목 요약, 무한매수법 오늘 주문 계획 요약, 데이터 상태(결론을 맨 위에)
import { Card, Disclaimer, Loading, Note, useAsync, Badge } from '../components/ui';
import { loadData } from '../lib/data';
import { personal } from '../lib/store';
import { useSignal } from '../lib/signal';
import { applyWatchlist, type NewsCard } from '@core/news/news';
import { plan } from '@core/infinite/core';
import { pct, fmt, kst } from '../lib/format';
import { useStatus } from '../components/StatusBar';
import { ExtLink } from '../lib/safe';

export function Home() {
  const p = useSignal(personal);
  const news = useAsync(() => loadData<{ cards: NewsCard[] }>('m6/cards.json'), [p.dataKey]);
  const us = useAsync(() => loadData<any>('m3/us/index.json'), [p.dataKey]);
  const kr = useAsync(() => loadData<any>('m3/kr/index.json'), [p.dataKey]);
  const m1 = useAsync(() => loadData<any>('m1/index.json'), [p.dataKey]);
  const st = useStatus();
  const top = news.data ? applyWatchlist(news.data.cards, new Set(p.watchlist)).filter((c) => c.중요도 === '긴급' || c.중요도 === '높음').slice(0, 3) : [];
  const rows = [...(us.data?.rows ?? []), ...(kr.data?.rows ?? [])];
  const m1by = new Map<string, any>((m1.data?.rows ?? []).map((r: any) => [r.ticker, r]));
  const plans = (['TQQQ', 'SOXL'] as const).map((s) => ({ s, r: p.m4[s] ? plan(p.m4[s]!, p.m4.rules, { 기준일: '', 전일종가: rows.find((x) => x.ticker === s)?.현재가 ?? null }, { user: p.m4.opts?.[s] }) : null }));
  const fails = st.data ? (st.data.us?.실패?.length ?? 0) + (st.data.kr?.실패?.length ?? 0) + (st.data.news?.실패?.length ?? 0) : null;
  return (
    <>
      {!p.dataKey && <Note kind="warn">데이터 키가 없어 시세·뉴스를 볼 수 없습니다. <a href="#/settings">설정</a>에서 데이터 키를 입력하세요.</Note>}
      <Card title="오늘의 중대 뉴스(긴급·높음 상위 3개)">
        <Loading s={news} />
        {news.data && !top.length && <p class="muted">오늘 긴급·높음 뉴스 없음</p>}
        <ul class="list">{top.map((c) => <li><Badge cls={`lv-${c.중요도}`}>{c.중요도}</Badge> {c.내관심 && <Badge cls="mine">내 관심종목</Badge>} <ExtLink href={c.대표.url}>{c.대표.title}</ExtLink> <span class="muted">{c.대표.source} · {kst(c.대표.published)}</span></li>)}</ul>
        <a href="#/news">중대 뉴스 전체 보기</a>
      </Card>
      <Card title="관심종목 요약">
        {!p.watchlist.length && <p class="muted">관심종목이 없습니다. MDD·버핏 분석 화면에서 ☆를 눌러 추가하세요(이 기기와 동기화 저장소에만 저장).</p>}
        {!!p.watchlist.length && <table class="t"><thead><tr><th>종목</th><th>현재가</th><th>52주 고점 대비</th><th>M1</th><th>기준일</th></tr></thead><tbody>
          {p.watchlist.map((t) => { const r = rows.find((x) => x.ticker === t); const b = m1by.get(t); return <tr><td><a href={`#/mdd/${encodeURIComponent(t)}`}>{r?.name ?? t}</a></td><td>{fmt(r?.현재가)}</td><td>{pct(r?.현재낙폭_52w)}</td><td>{b ? b.판정 : '범위 밖'}</td><td>{r?.기준일 ?? '-'}</td></tr>; })}
        </tbody></table>}
      </Card>
      <Card title="무한매수법 오늘 주문 계획">
        {plans.map(({ s, r }) => <p><b>{s}</b>: {r ? (r.상태 === '정상' && r.정보 ? `${r.정보.구간} · 회차 ${Math.round(r.정보.회차 * 1000) / 1000}` : r.메시지) : '원금·기록 미입력'}{r && r.주문.length ? ` — 주문 ${r.주문.length}건` : ''}</p>)}
        <p class="muted">계산 결과이며 주문은 사용자가 직접 또는 별도 자동매매 프로그램에서 실행합니다.</p>
      </Card>
      <Card title="데이터 상태">
        {st.data ? <p>미국 기준일 {st.data.us?.기준일 ?? '-'} · 국내 기준일 {st.data.kr?.기준일 ?? '-'} · 뉴스 수집 {kst(st.data.news?.수집시각UTC)} · 실패 {fails}건</p> : <Loading s={st} />}
        {st.data?.us?.요약대기열 && <p class="muted">공시 AI 요약 대기 {st.data.us.요약대기열.대기}건(하루 상한 {st.data.us.요약대기열.하루상한}건씩 이어서 처리)</p>}
      </Card>
      <Disclaimer />
    </>
  );
}
