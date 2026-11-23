// 화면 상단 데이터 상태: 오래된 데이터(2거래일 초과) 빨간 경고, 실패 수, 휴장 표시(4-2·4-3)
import { isStale, marketDayStatus } from '@core/common/calendar';
import { useAsync } from './ui';
import { loadData } from '../lib/data';
import { kst } from '../lib/format';

export function useStatus() { return useAsync(() => loadData<any>('_status.json'), []); }

export function StatusBar() {
  const s = useStatus();
  if (s.loading) return null;
  if (!s.data) return <div class="statusbar err" role="alert" data-testid="status">데이터 상태를 불러오지 못했습니다 — 배치가 아직 실행되지 않았을 수 있습니다</div>;
  const now = new Date();
  const us = s.data.us, kr = s.data.kr, news = s.data.news;
  const staleUs = us && isStale(us.기준일, now, 'US'), staleKr = kr && isStale(kr.기준일, now, 'KR');
  const fails = (us?.실패?.length ?? 0) + (kr?.실패?.length ?? 0) + (news?.실패?.length ?? 0);
  const hUs = marketDayStatus(now, 'US'), hKr = marketDayStatus(now, 'KR');
  return (
    <div class={`statusbar ${staleUs || staleKr || !us || !kr ? 'err' : ''}`} data-testid="status">
      {(staleUs || !us) && <strong role="alert">⚠ 미국 데이터가 오래됨(기준일 {us?.기준일 ?? '없음'}) — 예약 실행이 꺼졌는지 README '배치가 멈췄을 때'를 확인하세요. </strong>}
      {(staleKr || !kr) && <strong role="alert">⚠ 국내 데이터가 오래됨(기준일 {kr?.기준일 ?? '없음'}). </strong>}
      <span>미국 기준일 <b data-testid="base-us">{us?.기준일 ?? '-'}</b>{hUs.휴장 ? ` (오늘 휴장: ${hUs.사유})` : ''} · 국내 기준일 <b data-testid="base-kr">{kr?.기준일 ?? '-'}</b>{hKr.휴장 ? ` (오늘 휴장: ${hKr.사유})` : ''} · 수집 {kst(us?.수집시각UTC)} · 실패 {fails}건</span>
    </div>
  );
}
