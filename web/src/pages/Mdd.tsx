// M3 MDD 투자참고 — "과거 통계이며 매수·매도 신호가 아닙니다." 통계 정의: docs/mdd-definitions.md
import { useState, useMemo } from 'preact/hooks';
import { Card, Loading, Note, useAsync } from '../components/ui';
import { LineChart } from '../components/Chart';
import { loadData, symFile } from '../lib/data';
import { personal, updatePersonal } from '../lib/store';
import { useSignal } from '../lib/signal';
import { pct, fmt } from '../lib/format';
import { summarize, currentDrawdown, drawdownSeries, backtest, type Bar, type PeakWindow } from '@core/mdd/mdd';

const FIXED = <Note kind="warn"><b>과거 통계이며 매수·매도 신호가 아닙니다.</b> 현재 지수 구성종목으로 과거를 계산하므로 상장폐지·편출 종목이 빠져 결과가 좋게 나올 수 있습니다(생존편향).</Note>;
const unpack = (b: [string, number, number | null, number | null, number | null][]): Bar[] => b.map(([d, c, h, l, v]) => ({ d, c, h: h ?? undefined, l: l ?? undefined, v: v ?? undefined }));

function Detail({ t }: { t: string }) {
  const p = useSignal(personal);
  const mkt = /^\d{6}$/.test(t) ? 'kr' : 'us';
  const s = useAsync(() => loadData<any>(`m3/${mkt}/sym/${symFile(t)}.json`), [t, p.dataKey]);
  const [win, setWin] = useState<string>('52w');
  const [custom, setCustom] = useState('');
  const [bt, setBt] = useState({ 진입낙폭: -30, 청산: '전고점회복', 목표: 50, 손절: '', 수수료bp: 25, 세율: '', 환산: false });
  const fx = useAsync(() => loadData<any>('shared/us/rates.json').then((r) => (r?.DEXKOUS ?? []).map(([d, c]: [string, number]) => ({ d, c }))), [p.dataKey]);
  const bars = useMemo(() => (s.data ? unpack(s.data.bars) : []), [s.data]);
  const market = s.data?.market === 'CRYPTO' ? 'CRYPTO' : s.data?.market === 'KR' ? 'KR' : 'US';
  const sm = useMemo(() => (bars.length ? summarize(bars, market) : null), [bars, market]); // 배치와 같은 공용 모듈로 재계산
  if (!s.data) return <Loading s={s} />;
  const w: PeakWindow = win === 'custom' ? { start: custom || bars[0].d } : (win as PeakWindow);
  const cur = currentDrawdown(bars, w);
  const dds = drawdownSeries(bars);
  const res = bt.환산 && mkt === 'us' && fx.data?.length || !bt.환산 ? backtest(bars, { 진입낙폭: bt.진입낙폭, 청산: bt.청산 === '전고점회복' ? { 종류: '전고점회복' } : { 종류: '목표수익', 목표: bt.목표 }, 손절: bt.손절 === '' ? null : +bt.손절, 수수료bp: bt.수수료bp, 세율: bt.세율 === '' ? null : +bt.세율, 환율: bt.환산 ? fx.data : null }) : null;
  const star = p.watchlist.includes(t);
  return (
    <>
      <h1>{s.data.name}({t}) <button class="star" aria-label="관심종목" onClick={() => updatePersonal((x) => ({ ...x, watchlist: star ? x.watchlist.filter((y) => y !== t) : [...x.watchlist, t] }))}>{star ? '★' : '☆'}</button></h1>
      {FIXED}
      <Card title="결론: 현재 고점 대비 하락률">
        <div class="filters"><label>고점 기간 <select value={win} onChange={(e) => setWin((e.target as HTMLSelectElement).value)}><option value="52w">52주</option><option value="3y">3년</option><option value="5y">5년</option><option value="10y">10년</option><option value="ytd">올해</option><option value="all">전체</option><option value="custom">직접 선택</option></select></label>
          {win === 'custom' && <label>시작일 <input type="date" value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} /></label>}</div>
        {cur && <p class="verdict">고점 {fmt(cur.고점)}({cur.고점일}) 대비 <b>{pct(cur['고점대비하락률%'])}</b> · 현재가 {fmt(cur.현재가)} ({cur.기준일}) · 역대 일별 낙폭 백분위 {pct(cur['역대일별낙폭_백분위%'], 1)} · 최장 수중 기간 {cur.최장수중일수}거래일</p>}
        <p class="muted">데이터 시작일 <b>{s.data.시작일}</b>(종목별로 다름) · 가격: {s.data.가격기준} · 출처 {s.data.출처}({s.data.등급}급{s.data.등급 === 'C' ? ', 확실하지 않음' : ''}) · 기준일 {s.data.기준일}</p>
      </Card>
      <Card title="가격·낙폭 차트"><LineChart xs={bars.map((b) => b.d)} ys={bars.map((b) => b.c)} label="수정주가" /><LineChart xs={dds.map((x) => x.d)} ys={dds.map((x) => x.dd)} label="고점 대비 낙폭(%)" color="var(--down)" fill height={110} /></Card>
      {sm && <Card title={`연간 통계(기준일: ${market === 'CRYPTO' ? '매년 1월 2일' : '시장별 매년 첫 거래일'}, 완결 연도 ${sm.표본연수}년)`}>
        <table class="t"><tbody>
          <tr><td>평균상승률(기준일 대비 연중 최고)</td><td>{pct(sm['평균상승률%'])}</td></tr><tr><td>평균낙폭(기준일 대비 연중 최저)</td><td>{pct(sm['평균낙폭%'])}</td></tr>
          <tr><td>평균MDD(연중 최대 낙폭)</td><td>{pct(sm['평균MDD%'])}</td></tr><tr><td>평균 연간수익률</td><td>{pct(sm['평균수익률%'])}</td></tr>
          <tr><td>중앙값 MDD / 최악 MDD</td><td>{pct(sm['중앙값MDD%'])} / {pct(sm['최악MDD%'])}</td></tr><tr><td>상승 연도 비율</td><td>{pct(sm['상승연도비율%'])}</td></tr>
        </tbody></table>
        <h3>연중 MDD 구간별 빈도표</h3>
        <table class="t"><thead><tr><th>구간</th><th>횟수</th><th>비율</th></tr></thead><tbody>{sm.빈도표.map((r) => <tr><td>{r.구간}</td><td>{r.횟수}</td><td>{pct(r['비율%'], 1)}</td></tr>)}</tbody></table>
        <details><summary>연도별</summary><div class="scroll"><table class="t"><thead><tr><th>연도</th><th>기준일</th><th>상승률</th><th>낙폭</th><th>MDD</th><th>수익률</th><th>비고</th></tr></thead><tbody>{sm.연도별.map((y) => <tr><td>{y.연도}</td><td>{y.기준일}</td><td>{pct(y['상승률%'])}</td><td>{pct(y['낙폭%'])}</td><td>{pct(y['MDD%'])}</td><td>{pct(y['수익률%'])}</td><td>{y.사유 ?? ''}</td></tr>)}</tbody></table></div></details>
      </Card>}
      <Card title="백테스트(과거 데이터 참고)">
        <div class="filters">
          <label>진입: 누적 고점 대비 <input type="number" value={bt.진입낙폭} onInput={(e) => setBt({ ...bt, 진입낙폭: +(e.target as HTMLInputElement).value })} />% 이하</label>
          <label>청산 <select value={bt.청산} onChange={(e) => setBt({ ...bt, 청산: (e.target as HTMLSelectElement).value })}><option value="전고점회복">전고점 회복</option><option value="목표수익">목표 수익</option></select></label>
          {bt.청산 === '목표수익' && <label>목표 +<input type="number" value={bt.목표} onInput={(e) => setBt({ ...bt, 목표: +(e.target as HTMLInputElement).value })} />%</label>}
          <label>손절 <input type="number" placeholder="없음" value={bt.손절} onInput={(e) => setBt({ ...bt, 손절: (e.target as HTMLInputElement).value })} />%</label>
          <label>수수료(편도) <input type="number" value={bt.수수료bp} onInput={(e) => setBt({ ...bt, 수수료bp: +(e.target as HTMLInputElement).value })} />bp</label>
          <label>세율 <input type="number" placeholder="미반영" value={bt.세율} onInput={(e) => setBt({ ...bt, 세율: (e.target as HTMLInputElement).value })} />%</label>
          {mkt === 'us' && <label><input type="checkbox" checked={bt.환산} onChange={(e) => setBt({ ...bt, 환산: (e.target as HTMLInputElement).checked })} /> 원화 환산(FRED DEXKOUS)</label>}
        </div>
        <p class="muted">세율 기본값은 넣지 않았습니다(공식 출처 확인 전). 직접 입력하지 않으면 '세금 미반영'입니다.</p>
        {res ? <table class="t"><tbody>
          <tr><td>전략 누적수익률 / 연환산</td><td>{pct(res['누적수익률%'])} / {pct(res['연환산%'])}</td></tr><tr><td>전략 MDD</td><td>{pct(res['전략MDD%'])}</td></tr>
          <tr><td>단순 보유 누적 / MDD</td><td>{pct(res['단순보유_누적%'])} / {pct(res['단순보유_MDD%'])}</td></tr><tr><td>투자 기간 비율 · 거래 수</td><td>{pct(res['투자기간비율%'], 1)} · {res.거래.length}회</td></tr>
          <tr><td>반영</td><td>수수료 {bt.수수료bp}bp · {res.세금반영 ? `세율 ${bt.세율}%` : '세금 미반영'} · {res.환산 ? '원화 환산' : '원 통화'}</td></tr>
        </tbody></table> : <p class="muted">환율 데이터 없음</p>}
      </Card>
      <p class="disclaimer">투자 권유가 아닌 참고 자료입니다. 과거 통계이며 매수·매도 신호가 아닙니다.</p>
    </>
  );
}

export function Mdd({ arg }: { arg: string }) {
  const p = useSignal(personal);
  const us = useAsync(() => loadData<any>('m3/us/index.json'), [p.dataKey]);
  const kr = useAsync(() => loadData<any>('m3/kr/index.json'), [p.dataKey]);
  const [grp, setGrp] = useState('all');
  const [win, setWin] = useState<'현재낙폭_52w' | '현재낙폭_all'>('현재낙폭_52w');
  const [shown, setShown] = useState(100);
  if (arg) return <><a href="#/mdd">← 목록</a><Detail t={arg} /></>;
  const rows = [...(us.data?.rows ?? []), ...(kr.data?.rows ?? [])]
    .filter((r) => grp === 'all' || (grp === 'watch' ? p.watchlist.includes(r.ticker) : (r.indices ?? []).includes(grp)))
    .sort((a, b) => (a[win] ?? 1e9) - (b[win] ?? 1e9));
  return (
    <>
      <Card title="MDD 투자참고 — 현재 낙폭 큰 순">
        {FIXED}
        <div class="filters">
          <label>대상 <select value={grp} onChange={(e) => { setGrp((e.target as HTMLSelectElement).value); setShown(100); }}><option value="all">전체</option><option value="SP500">S&P500</option><option value="NDX">나스닥100</option><option value="KOSPI">코스피</option><option value="ETF">ETF</option><option value="CRYPTO">BTC</option><option value="watch">내 관심종목</option></select></label>
          <label>고점 기간 <select value={win} onChange={(e) => setWin((e.target as HTMLSelectElement).value as any)}><option value="현재낙폭_52w">52주</option><option value="현재낙폭_all">전체 기간</option></select></label>
        </div>
        <p class="muted">다른 고점 기간(3년·5년·직접 선택)은 종목을 누르면 볼 수 있습니다. 분석 가능한 종목은 유니버스에 있는 종목뿐입니다. 종목을 추가하면 universe.json에 들어가 공개됩니다.</p>
      </Card>
      <Loading s={us} />
      {(us.data || kr.data) && <div class="scroll"><table class="t" data-testid="mdd-table"><thead><tr><th>종목</th><th>고점 대비</th><th>평균MDD</th><th>평균상승률</th><th>표본</th><th>시작일</th><th>기준일</th></tr></thead><tbody>
        {rows.slice(0, shown).map((r) => <tr><td><a href={`#/mdd/${encodeURIComponent(r.ticker)}`}>{r.ticker}</a> <span class="muted">{r.name}</span></td><td>{r.error ? `데이터 없음(${r.error})` : pct(r[win])}</td><td>{pct(r.평균MDD)}</td><td>{pct(r.평균상승률)}</td><td>{r.표본연수 ?? '-'}년</td><td>{r.시작일 ?? '-'}</td><td>{r.기준일 ?? '-'}</td></tr>)}
      </tbody></table></div>}
      {rows.length > shown && <button data-testid="mdd-more" onClick={() => setShown(shown + 100)}>더 보기({shown}/{rows.length})</button>}
      {[us.data?.구성종목출처, kr.data?.구성종목출처].filter(Boolean).map((c: any) => <p class="small muted" data-testid="universe-src">구성종목 출처: {c.링크.map((h: string, i: number) => <>{i ? ' · ' : ''}<a href={h} target="_blank" rel="noopener noreferrer">{i === 0 ? c.출처 : '링크'}</a></>)}{c.라이선스 ? ` (${c.라이선스})` : ''} · {c.등급}급{c.등급 === 'C' ? '(확실하지 않음)' : ''}{c.수집일 ? ` · 수집일 ${c.수집일}` : ''}</p>)}
      {kr.error && <Note kind="warn">국내 데이터: {kr.error}</Note>}
      <p class="disclaimer">투자 권유가 아닌 참고 자료입니다.</p>
    </>
  );
}
