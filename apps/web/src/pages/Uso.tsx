/** Uso dos veículos pelo rastreador (Chronos): fora do expediente, velocidade, paradas por local e pernoites. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fd, fdt, nf } from '../lib/format';
import { usePeriod } from '../lib/period';
import { DataTable, Header, Kpi, Loading, PeriodPicker } from '../components/ui';

interface UVehicle { plate: string; name: string; trips: number; km: number; hours: number; offTrips: number; offKm: number; offHoursDriving: number;
  over: number; high: number; severe: number; maxSpeed: number; maxSpeedAt: string | null; idleWorkdays: number; stopHours: number; baseStopHours: number; nightsAway: number }
interface UPlace { place: string; atBase: boolean; hours: number; inHours: number; offHours: number; stops: number; longest: { at: string; hours: number } }
interface UTrip { plate: string; name: string; startedAt: string; endedAt: string; durationH: number; km: number | null; vmax: number; from: string | null; to: string | null; reasons: string[] }
interface Usage {
  period: { from: string; to: string };
  options: { workStart: number; workEnd: number; speed: number; high: number; severe: number; longStopH: number };
  totals: Omit<UVehicle, 'plate' | 'name' | 'idleWorkdays' | 'maxSpeedAt'> & { withKm: number };
  vehicles: UVehicle[]; series: { key: string; name: string }[];
  monthly: { month: string; byVehicle: Record<string, { km: number; hours: number; offTrips: number; high: number }> }[];
  places: { plate: string; name: string; list: UPlace[] }[];
  overnights: { plate: string; name: string; place: string; nights: number; first: string; last: string; dates: string[] }[];
  longStops: { plate: string; name: string; place: string; from: string; to: string; hours: number }[];
  flagged: UTrip[]; lastAt: string | null;
}

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—');
const niceTop = (max: number) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1)))); const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => max / v <= 5) ?? p * 10; return { top: Math.max(step, Math.ceil(max / step) * step), step }; };

type Metric = 'km' | 'hours' | 'offTrips' | 'high';
const METRICS: [Metric, string][] = [['km', 'Km rodados'], ['hours', 'Horas rodando'], ['offTrips', 'Viagens fora do expediente'], ['high', 'Viagens acima de 120 km/h']];

function MonthChart({ data, series, metric }: { data: Usage['monthly']; series: Usage['series']; metric: Metric }) {
  const ser = series.filter((s) => data.some((m) => m.byVehicle[s.key]));
  if (!data.length || !ser.length) return <div className="note">Sem dados do rastreador no período.</div>;
  const W = 560, H = 240, L = 46, B = 28, T = 20, R = 8, cw = W - L - R, ch = H - T - B;
  const val = (m: Usage['monthly'][0], k: string) => m.byVehicle[k]?.[metric] ?? 0;
  const max = Math.max(...data.flatMap((m) => ser.map((s) => val(m, s.key))));
  if (!max) return <div className="note">Nada a mostrar para este indicador no período.</div>;
  const { top, step } = niceTop(max);
  const gw = cw / data.length, bw = Math.min(26, (gw * 0.78) / ser.length);
  const grid: number[] = []; for (let v = 0; v <= top; v += step) grid.push(v);
  return (
    <>
      <div className="legend">{ser.map((s) => <span key={s.key}><i style={{ background: COLORS[series.indexOf(s) % 4] }} />{s.name}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Indicador por mês e veículo">
        {grid.map((v) => { const y = T + ch - (v / top) * ch; return <g key={v}><line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" /><text x={L - 6} y={y + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{nf(v)}</text></g>; })}
        {data.map((m, i) => {
          const x0 = L + gw * i + (gw - bw * ser.length) / 2;
          return <g key={m.month}>
            {ser.map((s, j) => { const v = val(m, s.key); const h = (v / top) * ch;
              const cx = x0 + j * bw + bw / 2;
              return <g key={s.key}>
                <rect x={x0 + j * bw + 1} y={T + ch - h} width={bw - 2} height={h} rx={2} fill={COLORS[series.indexOf(s) % 4]}><title>{s.name} · {MONTHS[+m.month.slice(5) - 1]}: {metric === 'hours' ? hm(v) : nf(v)}</title></rect>
                {v > 0 && <text x={cx} y={T + ch - h - 4} textAnchor="middle" fontSize={ser.length > 3 ? 9 : 10.5} fill="var(--fg)">{nf(v)}</text>}
              </g>; })}
            <text x={L + gw * (i + 0.5)} y={H - 9} textAnchor="middle" fontSize="11" fill="var(--muted)">{MONTHS[+m.month.slice(5) - 1]}/{m.month.slice(2, 4)}</text>
          </g>;
        })}
      </svg>
    </>
  );
}

function Places({ p }: { p: Usage['places'][0] }) {
  const mx = Math.max(1, ...p.list.map((x) => x.hours));
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{p.name} <span className="plate">{p.plate}</span></h3>
      {!p.list.length && <div className="note">Sem paradas no período.</div>}
      <div className="bars">
        {p.list.map((x) => <div className="bar usage-bar" key={x.place} title={`${x.place}\n${x.stops} paradas · maior: ${hm(x.longest.hours)} em ${fdt(x.longest.at)}`}>
          <span className={x.atBase ? '' : 'usage-away'}>{x.atBase ? 'Base · ' : ''}{x.place}</span>
          <span className="t" style={{ display: 'flex' }}>
            <i style={{ width: `${(x.inHours / mx) * 100}%`, background: 'var(--c1)' }} />
            <i style={{ width: `${(x.offHours / mx) * 100}%`, background: 'var(--c2)' }} />
          </span>
          <b>{nf(x.hours, 1)} h</b>
        </div>)}
      </div>
    </div>
  );
}

export default function Uso() {
  const { qs } = usePeriod();
  const [plate, setPlate] = useState('');
  const [metric, setMetric] = useState<Metric>('km');
  const q = useQuery({ queryKey: ['usage', qs, plate], queryFn: () => api<Usage>(`/usage?${qs}${plate ? '&plate=' + encodeURIComponent(plate) : ''}`) });
  const d = q.data; const t = d?.totals;
  const work = d ? `${hm(d.options.workStart)} às ${hm(d.options.workEnd)}` : '';
  return (
    <>
      <Header title="Uso dos veículos" sub="Pelo rastreador (Chronos): viagens fora do expediente, velocidade, onde os veículos ficam parados e onde dormem."
        actions={d && <div className="asof">Último dado do Chronos: {fdt(d.lastAt)}<br />Atualize em Importações → Chronos</div>} />
      <div className="tools per" style={{ alignItems: 'center' }}>
        <PeriodPicker />
        <select aria-label="Veículo" value={plate} onChange={(e) => setPlate(e.target.value)}>
          <option value="">Todos os veículos</option>{d?.series.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
        </select>
      </div>
      <Loading q={q} />
      {d && t && <>
        {!t.trips && <div className="banner">Não há dados do rastreador neste período. Exporte o relatório "Períodos de utilização (BDV)" no Chronos e envie em Importações.</div>}
        <div className="kpis">
          <Kpi label="Viagens" value={nf(t.trips)} />
          <Kpi label="Km rodados" value={nf(t.km)} note={t.withKm < t.trips ? `${nf(t.trips - t.withKm)} viagens sem km` : 'pelo rastreador'} />
          <Kpi label="Horas rodando" value={nf(t.hours, 0)} />
          <Kpi label="Fora do expediente" value={nf(t.offTrips)} note={`${nf(t.offKm)} km · fora de ${work} ou fim de semana`} />
          <Kpi label={`Acima de ${d.options.high} km/h`} value={nf(t.high)} note={`${nf(t.severe)} acima de ${d.options.severe} km/h`} />
          <Kpi label="Velocidade máxima" value={nf(t.maxSpeed) + ' km/h'} />
          <Kpi label="Noites fora da base" value={nf(t.nightsAway)} />
        </div>

        <h2>Resumo por veículo</h2>
        <DataTable rows={d.vehicles} cols={[
          { h: 'Veículo', v: (r) => r.name, f: (r) => <><b>{r.name}</b> <span className="plate">{r.plate}</span></> },
          { h: 'Viagens', v: (r) => r.trips, f: (r) => nf(r.trips), n: true }, { h: 'Km', v: (r) => r.km, f: (r) => nf(r.km), n: true },
          { h: 'Horas rodando', v: (r) => r.hours, f: (r) => nf(r.hours, 1), n: true },
          { h: 'Fora do exp.', v: (r) => r.offTrips, f: (r) => `${nf(r.offTrips)} (${nf(r.offKm)} km)`, n: true },
          { h: `> ${d.options.high} km/h`, v: (r) => r.high, f: (r) => nf(r.high), n: true }, { h: 'Vel. máx.', v: (r) => r.maxSpeed, f: (r) => nf(r.maxSpeed), n: true },
          { h: 'Dias úteis parado', v: (r) => r.idleWorkdays, f: (r) => nf(r.idleWorkdays), n: true },
          { h: 'Parado na base', v: (r) => (r.stopHours ? r.baseStopHours / r.stopHours : null), f: (r) => pct(r.baseStopHours, r.stopHours), n: true },
          { h: 'Noites fora', v: (r) => r.nightsAway, f: (r) => nf(r.nightsAway), n: true },
        ]} />

        <h2>Mês a mês por veículo</h2><div className="panel" style={{ maxWidth: 760 }}>
            <div className="tools"><select aria-label="Indicador" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>{METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <MonthChart data={d.monthly} series={d.series} metric={metric} />
            <div className="note">Só os meses dentro do período escolhido. O mês corrente é parcial.</div>
        </div>

        <h2>Onde cada veículo mais fica parado</h2>
        <div className="legend"><span><i style={{ background: 'var(--c1)' }} />Horas paradas no expediente</span><span><i style={{ background: 'var(--c2)' }} />Horas paradas fora do expediente</span><span className="usage-away">Endereço fora da base</span></div>
        <div className="two">{d.places.map((p) => <Places key={p.plate} p={p} />)}</div>
        <div className="note">Parada = tempo entre desligar e religar o motor no mesmo dia, no endereço final da viagem. Passe o mouse para ver o número de paradas e a maior delas.</div>

        <div className="two">
          <div><h2>Pernoites fora da base</h2>
            <DataTable rows={d.overnights} maxh={420} filter={{ label: 'Todos os veículos', v: (r) => r.name }} cols={[
              { h: 'Veículo', v: (r) => r.name }, { h: 'Local', v: (r) => r.place, w: true },
              { h: 'Noites', v: (r) => r.nights, n: true }, { h: 'Primeira', v: (r) => r.first, f: (r) => fd(r.first) }, { h: 'Última', v: (r) => r.last, f: (r) => fd(r.last) },
            ]} /></div>
          <div><h2>Paradas longas fora da base ({d.options.longStopH} h ou mais)</h2>
            <DataTable rows={d.longStops} maxh={420} filter={{ label: 'Todos os veículos', v: (r) => r.name }} cols={[
              { h: 'Veículo', v: (r) => r.name }, { h: 'Local', v: (r) => r.place, w: true },
              { h: 'De', v: (r) => r.from, f: (r) => fdt(r.from) }, { h: 'Até', v: (r) => r.to, f: (r) => fdt(r.to).slice(11) },
              { h: 'Horas', v: (r) => r.hours, f: (r) => hm(r.hours), n: true },
            ]} /></div>
        </div>

        <h2>Viagens para verificar</h2>
        <DataTable rows={d.flagged} maxh={560} filter={{ label: 'Todos os motivos', v: (r) => r.reasons.join(' + ') }} cols={[
          { h: 'Início', v: (r) => r.startedAt, f: (r) => fdt(r.startedAt) }, { h: 'Veículo', v: (r) => r.name },
          { h: 'Motivo', v: (r) => r.reasons.join(' + '), f: (r) => r.reasons.map((x) => <span key={x} className={'chip ' + (x.startsWith('Acima') ? 'bad' : 'warn')} style={{ marginRight: 4 }}>{x}</span>) },
          { h: 'Km', v: (r) => r.km, f: (r) => nf(r.km, 1), n: true }, { h: 'Vel. máx.', v: (r) => r.vmax, f: (r) => nf(r.vmax), n: true },
          { h: 'Duração', v: (r) => r.durationH, f: (r) => hm(r.durationH), n: true },
          { h: 'Origem', v: (r) => r.from, w: true }, { h: 'Destino', v: (r) => r.to, w: true },
        ]} />
        <div className="note">Fora do expediente = viagem iniciada antes das {hm(d.options.workStart)}, a partir das {hm(d.options.workEnd)} ou no sábado e domingo (horários em Gestão → Parâmetros). A base é a Rua Brasília, 201 (São Cristóvão). O relatório do Chronos não identifica o motorista.</div>
      </>}
    </>
  );
}
