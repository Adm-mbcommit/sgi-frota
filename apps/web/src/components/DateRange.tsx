/**
 * Seletor de período: um campo só; ao clicar abre dois meses lado a lado.
 * 1º clique = início, 2º clique = fim (o intervalo fica destacado, inclusive ao passar o mouse).
 */
import { useEffect, useRef, useState } from 'react';
import { todayIso } from '../lib/format';

export interface Range { from: string; to: string }

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ym = (d: string) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7) });
const shift = ({ y, m }: { y: number; m: number }, n: number) => { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** Atalhos de período. */
function presets(today: string): [string, Range][] {
  const { y, m } = ym(today);
  const prev = shift({ y, m }, -1);
  return [
    ['Este mês', { from: `${y}-${pad(m)}-01`, to: today }],
    ['Mês passado', { from: `${prev.y}-${pad(prev.m)}-01`, to: `${prev.y}-${pad(prev.m)}-${pad(lastDay(prev.y, prev.m))}` }],
    ['Últimos 30 dias', { from: addDays(today, -29), to: today }],
    ['Últimos 90 dias', { from: addDays(today, -89), to: today }],
    ['Este ano', { from: `${y}-01-01`, to: today }],
  ];
}

export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null); // início escolhido, esperando o fim
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => shift(ym(value.to), -1)); // mês da esquerda
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setStart(null); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setStart(null); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => { if (!open) { setView(shift(ym(value.to), -1)); setStart(null); } setOpen(!open); };
  const pick = (d: string) => {
    if (!start) { setStart(d); return; }
    const r = d < start ? { from: d, to: start } : { from: start, to: d };
    onChange(r); setStart(null); setOpen(false);
  };
  // intervalo mostrado: o já escolhido, ou o que está sendo escolhido (início + mouse)
  const lo = start ? (hover && hover < start ? hover : start) : value.from;
  const hi = start ? (hover && hover > start ? hover : start) : value.to;

  const month = (v: { y: number; m: number }) => {
    const first = `${v.y}-${pad(v.m)}-01`;
    const blanks = new Date(first + 'T12:00:00Z').getUTCDay();
    const days = Array.from({ length: lastDay(v.y, v.m) }, (_, i) => `${v.y}-${pad(v.m)}-${pad(i + 1)}`);
    return (
      <div className="dr-month" key={`${v.y}-${v.m}`}>
        <div className="dr-title">{MONTHS[v.m - 1][0].toUpperCase() + MONTHS[v.m - 1].slice(1)} de {v.y}</div>
        <div className="dr-grid">
          {WD.map((w, i) => <span key={i} className="dr-wd">{w}</span>)}
          {Array.from({ length: blanks }, (_, i) => <span key={'b' + i} />)}
          {days.map((d) => {
            const inRange = d >= lo && d <= hi;
            const edge = d === lo || d === hi;
            const cls = 'dr-day' + (inRange ? ' in' : '') + (edge ? ' edge' : '') + (d === lo ? ' lo' : '') + (d === hi ? ' hi' : '') + (d === today ? ' today' : '') + (d > today ? ' future' : '');
            return <button key={d} type="button" className={cls} onClick={() => pick(d)} onMouseEnter={() => setHover(d)} aria-label={br(d)} aria-pressed={edge}>{+d.slice(8)}</button>;
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="dr" ref={box}>
      <button type="button" className={'dr-field' + (open ? ' open' : '')} onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <span aria-hidden>📅</span> {br(value.from)} <span className="dr-arrow">→</span> {br(value.to)}
      </button>
      {open && (
        <div className="dr-pop" role="dialog" aria-label="Escolher período" onMouseLeave={() => setHover(null)}>
          <div className="dr-presets">
            {presets(today).map(([label, r]) => (
              <button key={label} type="button" className={'dr-preset' + (r.from === value.from && r.to === value.to ? ' on' : '')}
                onClick={() => { onChange(r); setStart(null); setOpen(false); }}>{label}</button>
            ))}
          </div>
          <div className="dr-main">
            <div className="dr-nav">
              <button type="button" className="dr-btn" onClick={() => setView(shift(view, -1))} aria-label="Mês anterior">‹</button>
              <span className="dr-hint">{start ? `Início: ${br(start)} · agora clique na data final` : 'Clique na data inicial e depois na final'}</span>
              <button type="button" className="dr-btn" onClick={() => setView(shift(view, 1))} aria-label="Próximo mês">›</button>
            </div>
            <div className="dr-months">{month(view)}{month(shift(view, 1))}</div>
          </div>
        </div>
      )}
    </div>
  );
}
