// 외부 차트 라이브러리 없이 SVG로 그린다(CDN 금지). 가격·낙폭 두 개 패널.
export function LineChart({ xs, ys, height = 160, label, color = 'var(--accent)', fill = false, yfmt = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) }: { xs: string[]; ys: number[]; height?: number; label: string; color?: string; fill?: boolean; yfmt?: (v: number) => string }) {
  if (ys.length < 2) return <p class="muted">차트 데이터 없음</p>;
  const W = 600, H = height, P = 4;
  const step = Math.max(1, Math.floor(ys.length / 600));
  const pts = ys.filter((_, i) => i % step === 0 || i === ys.length - 1);
  const dts = xs.filter((_, i) => i % step === 0 || i === ys.length - 1);
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * (W - 2 * P) + P).toFixed(1)},${(H - P - ((v - lo) / span) * (H - 2 * P)).toFixed(1)}`).join('');
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {fill && <path d={`${path}L${W - P},${H - P}L${P},${H - P}Z`} fill={color} opacity="0.15" />}
        <path d={path} fill="none" stroke={color} stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <figcaption><span>{dts[0]}</span><span>{label} · 최고 {yfmt(hi)} / 최저 {yfmt(lo)}</span><span>{dts[dts.length - 1]}</span></figcaption>
    </figure>
  );
}
