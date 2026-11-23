// M1 입력 조립 — 배치(일일)와 브라우저(즉시 분석)가 같은 함수를 쓴다(3-8, 10절 31번).
import { computeCalc, judgeQuant, decide, type BuffettInput, type Config, type FinYear, type Grade } from './engine';
import { attachMarket, sicToType } from '../sec/facts';
import type { Bar } from '../mdd/mdd';

export interface AssembleArgs {
  ticker: string; name: string; sector?: string; sic?: string | number | null;
  years: (FinYear & { 기말일: string })[]; bars: Bar[]; dgs10: { value: number; date: string } | null; priceGrade: Grade;
}
export function assembleM1(a: AssembleArgs, cfg: Config) {
  const years = a.years.map((y) => ({ ...y }));
  attachMarket(years, a.bars);
  const L = years[years.length - 1];
  const last = a.bars[a.bars.length - 1] ?? null;
  const shares = L ? L.보통주_유통주식수 ?? L.희석주식수 ?? null : null;
  const inp: BuffettInput = {
    기준일: last?.d ?? '', 단위: 'USD',
    종목: { 이름: a.name, 티커: a.ticker, 시장: 'NYSE/NASDAQ', 통화: 'USD', 업종: a.sector, 업종유형: sicToType(a.sic) },
    재무_10년: years, 비재무_해자증거: null,
    시장데이터: {
      주가: last?.c ?? null, 보통주_시가총액: last && shares ? last.c * shares : null,
      주당순자산: L && L.지배자기자본 && shares ? L.지배자기자본 / shares : null,
      국채10년_금리: a.dgs10?.value ?? null, 금리_기준일: a.dgs10?.date,
    },
    근거등급: { 재무: 'A', 가격: a.priceGrade, 금리: 'A' },
  };
  const calc = computeCalc(inp, cfg);
  const quant = judgeQuant(inp, calc, cfg);
  const pre = decide(inp, calc, cfg, null);
  return { inp, calc, quant, pre };
}
