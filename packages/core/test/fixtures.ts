import type { BuffettInput } from '../src/buffett/engine';

/** 우량 일반 기업 픽스처: 10년, 꾸준한 성장, 순현금 */
export function fixture(over: Partial<{ niMul: number; debt: number; price: number; years: number; deficit: number[]; type: BuffettInput['종목']['업종유형'] }> = {}): BuffettInput {
  const years = over.years ?? 10;
  const ys = Array.from({ length: years }, (_, i) => {
    const g = Math.pow(1.08, i);
    const rev = 1000 * g, oi = 250 * g;
    const ni = (over.deficit?.includes(i) ? -50 : 180 * g) * (over.niMul ?? 1);
    return {
      연도: 2016 + i, 매출: rev, 매출원가: rev * 0.5, 매출총이익: rev * 0.5, 영업이익: oi, 지배순이익: ni, 일회성손익: 0,
      감가상각비: 40 * g, 무형자산상각비: 5 * g, 자본적지출: 50 * g, 운전자본증감: 5 * g,
      지배자기자본: 1000 * g, 투하자본: 1000 * g, 총부채: 600 * g, 이자부부채: over.debt ?? 100, 현금성자산: 300 * g, 비영업자산: 0,
      이자비용: 10, 이자수익: 3, EBITDA: oi + 45 * g, 보통주_유통주식수: 100, 희석주식수: 100, 자사주수: 0, 우선주_시가총액: 0,
      배당금총액: 50 * g, 자사주매입액: 20 * g, 자사주소각액: 0, 유상증자액: 0, 주식보상비용: 5,
      연말시가총액: 4000 * g, PER: 20, PBR: 4, 법인세비용: 50 * g, 세전이익: 250 * g,
    };
  });
  return {
    기준일: '2026-11-20', 단위: '백만USD',
    종목: { 이름: '테스트', 티커: 'TST', 시장: 'NASDAQ', 통화: 'USD', 업종유형: over.type ?? '일반' },
    재무_10년: ys,
    시장데이터: { 주가: over.price ?? 10, 보통주_시가총액: (over.price ?? 10) * 100, 국채10년_금리: 4.2 },
    근거등급: { 재무: 'A', 가격: 'A', 금리: 'A' },
  };
}
