import { nf, rs } from '../lib/format';

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function StackChart({ data, series }: { data: { month: string; byVehicle: Record<string, number> }[]; series: { key: string; name: string }[] }) {
  const W = 520, H = 230, L = 48, B = 28, T = 14, R = 10, cw = W - L - R, ch = H - T - B;
  const tot = data.map((r) => series.reduce((a, s) => a + (r.byVehicle[s.key] ?? 0), 0));
  const max = Math.max(...tot, 1);
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => max / v <= 5) ?? p * 10;
  const top = Math.ceil(max / step) * step;
  const bw = (cw / Math.max(data.length, 1)) * 0.56;
  const grid = []; for (let v = 0; v <= top; v += step) grid.push(v);
  return (
    <>
      <div className="legend">{series.map((s, j) => <span key={s.key}><i style={{ background: COLORS[j % 4] }} />{s.name}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Gasto com combustível por mês e veículo, em reais">
        {grid.map((v) => { const y = T + ch - (v / top) * ch; return <g key={v}><line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" /><text x={L - 6} y={y + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{nf(v)}</text></g>; })}
        {data.map((r, i) => {
          const x = L + (cw / data.length) * (i + 0.5) - bw / 2; let acc = 0;
          return <g key={r.month}>
            {series.map((s, j) => { const v = r.byVehicle[s.key] ?? 0; const h = (v / top) * ch; const y = T + ch - (acc / top) * ch - h; acc += v;
              return h > 0 ? <rect key={s.key} x={x} y={y} width={bw} height={h} fill={COLORS[j % 4]}><title>{s.name}: {rs(v)}</title></rect> : null; })}
            <text x={x + bw / 2} y={H - 9} textAnchor="middle" fontSize="11" fill="var(--muted)">{MONTHS[Number(r.month.slice(5, 7)) - 1]}</text>
            <text x={x + bw / 2} y={T + ch - (acc / top) * ch - 4} textAnchor="middle" fontSize="10.5" fill="var(--fg)">{nf(acc)}</text>
          </g>;
        })}
      </svg>
      <div className="note">O mês corrente é parcial. Valores em reais.</div>
    </>
  );
}

export function Bars({ items }: { items: { label: string; value: number }[] }) {
  const mx = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="note">Sem ocorrências no período.</div>;
  return <div className="bars">{items.map((i) => <div className="bar" key={i.label}><span>{i.label}</span><span className="t"><i style={{ width: `${(i.value / mx) * 100}%` }} /></span><b>{i.value}</b></div>)}</div>;
}
