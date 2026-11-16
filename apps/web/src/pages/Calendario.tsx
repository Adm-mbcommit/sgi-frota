/** Calendário: feriados nacionais (calculados) e aniversários da equipe. */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { daysBetween, nationalHolidays, nextBirthday, type Holiday } from '@sgi/core';
import { api, upload } from '../lib/api';
import { todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import { FormDialog, Header, Loading, num } from '../components/ui';

export interface Birthday { id: string; name: string; day: number; month: number; year?: number | null }
export const useBirthdays = () => useQuery({ queryKey: ['birthdays'], queryFn: () => api<Birthday[]>('/birthdays'), staleTime: 10 * 60_000 });

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const pad = (n: number) => String(n).padStart(2, '0');
const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
/** Nome curto: primeiro nome + o seguinte (pulando "de", "da", "dos"…), ex.: "Kleberson Oliveira". */
const firstNames = (name: string) => {
  const w = name.trim().split(/\s+/);
  const rest = w.slice(1).find((x) => !/^(d[aeo]s?|e)$/i.test(x));
  return rest ? `${w[0]} ${rest}` : w[0];
};

export interface CalEvent { date: string; kind: 'holiday' | 'optional' | 'birthday'; label: string }

/** Feriados e aniversários entre duas datas (inclusive). */
function eventsBetween(from: string, to: string, bdays: Birthday[]): CalEvent[] {
  const years = [+from.slice(0, 4), +to.slice(0, 4)].filter((y, i, a) => a.indexOf(y) === i);
  const hol = years.flatMap((y) => nationalHolidays(y)).filter((h: Holiday) => h.date >= from && h.date <= to)
    .map((h): CalEvent => ({ date: h.date, kind: h.optional ? 'optional' : 'holiday', label: h.name + (h.optional ? ' (ponto facultativo)' : '') }));
  const bd = bdays.flatMap((b) => years.map((y) => nextBirthday(b, `${y}-01-01`)).filter((d) => d >= from && d <= to)
    .map((d): CalEvent => ({ date: d, kind: 'birthday', label: b.name })));
  return [...hol, ...bd].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Próximos eventos a partir de hoje (para o Início e a lista ao lado do calendário). */
export function upcoming(bdays: Birthday[], days: number, today = todayIso()) {
  const end = new Date(today + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + days);
  return eventsBetween(today, end.toISOString().slice(0, 10), bdays);
}

const whenLabel = (date: string, today: string) => {
  const n = daysBetween(today, date);
  return n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : `${WEEK[weekday(date)]}, ${dm(date)}`;
};

export default function Calendario() {
  const today = todayIso();
  const [ym, setYm] = useState({ y: +today.slice(0, 4), m: +today.slice(5, 7) });
  const q = useBirthdays();
  const { can } = useAuth();
  const bdays = q.data ?? [];
  const first = `${ym.y}-${pad(ym.m)}-01`;
  const last = `${ym.y}-${pad(ym.m)}-${pad(new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate())}`;
  const events = useMemo(() => eventsBetween(first, last, bdays), [first, last, bdays]);
  const byDay = new Map<string, CalEvent[]>();
  events.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null)];
  for (let d = 1; d <= +last.slice(8); d++) cells.push(`${ym.y}-${pad(ym.m)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const move = (n: number) => setYm(({ y, m }) => { const t = (y * 12 + m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const next = upcoming(bdays, 60, today);
  return (
    <>
      <Header title="Calendário" sub="Feriados nacionais e aniversários da equipe." />
      <Loading q={q} />
      <div className="cal-layout">
        <div>
          <div className="cal-nav">
            <button className="btn sm" onClick={() => move(-1)} aria-label="Mês anterior">◀</button>
            <b>{MONTHS[ym.m - 1][0].toUpperCase() + MONTHS[ym.m - 1].slice(1)} de {ym.y}</b>
            <button className="btn sm" onClick={() => move(1)} aria-label="Próximo mês">▶</button>
            <button className="btn sm" onClick={() => setYm({ y: +today.slice(0, 4), m: +today.slice(5, 7) })}>Hoje</button>
          </div>
          <div className="cal" role="grid" aria-label={`${MONTHS[ym.m - 1]} de ${ym.y}`}>
            {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
            {cells.map((d, i) => {
              const ev = d ? byDay.get(d) ?? [] : [];
              const hol = ev.find((e) => e.kind === 'holiday');
              return (
                <div key={i} className={'cal-day' + (!d ? ' empty' : '') + (d === today ? ' today' : '') + (hol ? ' hol' : '') + (d && weekday(d) % 6 === 0 ? ' we' : '')}>
                  {d && <><span className="cal-n">{+d.slice(8)}</span>
                    {ev.map((e, k) => <span key={k} className={'cal-ev ' + e.kind} title={e.label}>{e.kind === 'birthday' ? '🎂 ' + e.label.split(' ')[0] : e.label.replace(' (ponto facultativo)', '')}</span>)}</>}
                </div>
              );
            })}
          </div>
          <p className="note"><span className="cal-key holiday" /> feriado nacional · <span className="cal-key optional" /> ponto facultativo · 🎂 aniversário. Feriados estaduais e municipais não aparecem.</p>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Próximos 60 dias</h2>
          <div className="panel">
            {next.length ? next.map((e, i) => (
              <div key={i} className="cal-next"><span className={'cal-when' + (e.date === today ? ' now' : '')}>{whenLabel(e.date, today)}</span>
                <span>{e.kind === 'birthday' ? '🎂 ' + e.label : e.label}</span></div>
            )) : <p className="note">Nada nos próximos 60 dias.</p>}
          </div>
          {can(...WRITE) && <BirthdayAdmin list={bdays} />}
        </div>
      </div>
    </>
  );
}

function BirthdayAdmin({ list }: { list: Birthday[] }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Birthday> | null>(null);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['birthdays'] });
  const importFile = async (f?: File) => {
    if (!f) return; setMsg('Importando ' + f.name + '…');
    try { const r = await upload('/birthdays/import', f) as { created: number; updated: number }; setMsg(`Importado: ${r.created} novo(s), ${r.updated} atualizado(s).`); await refresh(); }
    catch (e) { setMsg((e as Error).message); }
    if (file.current) file.current.value = '';
  };
  return (
    <>
      <h2>Aniversários ({list.length})</h2>
      <div className="panel">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm pri" onClick={() => setEdit({})}>Incluir pessoa</button>
          <label className="btn sm" htmlFor="aniv-file">Importar planilha</label>
          <input id="aniv-file" ref={file} type="file" accept=".xlsx" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          {list.length > 0 && <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Esconder lista' : 'Ver lista'}</button>}
        </div>
        <p className="note">A planilha precisa ter o nome e a data de nascimento de cada pessoa (como a Aniversarios.xlsx). Quem já está cadastrado é atualizado, sem duplicar.</p>
        {msg && <div className="banner">{msg}</div>}
        {open && <div className="cal-list">{list.map((b) => (
          <button key={b.id} className="cal-list-row" onClick={() => setEdit(b)}><span>{pad(b.day)}/{pad(b.month)}</span><span>{b.name}</span></button>
        ))}</div>}
      </div>
      {edit && <FormDialog title={edit.id ? 'Editar aniversário' : 'Incluir aniversário'} onClose={() => setEdit(null)}
        extra={edit.id ? { label: 'Excluir', run: async () => { if (confirm(`Tirar ${edit.name} do calendário?`)) { await api(`/birthdays/${edit.id}`, { method: 'DELETE' }); await refresh(); } } } : undefined}
        fields={[
          { name: 'name', label: 'Nome', value: edit.name, required: true },
          { name: 'day', label: 'Dia', type: 'number', value: edit.day, required: true },
          { name: 'month', label: 'Mês (1 a 12)', type: 'number', value: edit.month, required: true },
          { name: 'year', label: 'Ano de nascimento (opcional, não aparece no calendário)', type: 'number', value: edit.year },
        ]}
        onSave={async (o) => {
          const body = { name: o.name, day: num(o.day), month: num(o.month), year: num(o.year) };
          await api(edit.id ? `/birthdays/${edit.id}` : '/birthdays', { method: edit.id ? 'PATCH' : 'POST', json: body });
          await refresh();
        }} />}
    </>
  );
}

/** Lembrete no Início: aniversários de hoje e dos próximos 7 dias, e o próximo feriado. */
export function CalendarSummary() {
  const q = useBirthdays();
  const today = todayIso();
  if (!q.data) return null;
  const week = upcoming(q.data, 7, today).filter((e) => e.kind === 'birthday');
  const hol = upcoming([], 120, today)[0];
  if (!week.length && !hol) return null;
  return (
    <div className="banner cal-banner">
      {week.length > 0 && <span>🎂 <b>Aniversários:</b> {week.map((e) => `${firstNames(e.label)} (${whenLabel(e.date, today).toLowerCase()})`).join(' · ')}</span>}
      {hol && <span>📅 <b>Próximo feriado:</b> {hol.label} – {whenLabel(hol.date, today).toLowerCase()}</span>}
      <Link className="btn sm" to="/calendario">Ver calendário</Link>
    </div>
  );
}

/** Calendário pequeno do mês + próximos aniversários (usado ao lado das tarefas). */
export function MiniCalendar() {
  const today = todayIso();
  const [ym, setYm] = useState({ y: +today.slice(0, 4), m: +today.slice(5, 7) });
  const q = useBirthdays();
  const bdays = q.data ?? [];
  const first = `${ym.y}-${pad(ym.m)}-01`;
  const last = `${ym.y}-${pad(ym.m)}-${pad(new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate())}`;
  const byDay = new Map<string, CalEvent[]>();
  eventsBetween(first, last, bdays).forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null)];
  for (let d = 1; d <= +last.slice(8); d++) cells.push(`${ym.y}-${pad(ym.m)}-${pad(d)}`);
  const move = (n: number) => setYm(({ y, m }) => { const t = (y * 12 + m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const next = upcoming(bdays, 366, today);
  const nextBdays = next.filter((e) => e.kind === 'birthday').slice(0, 5);
  const nextHol = next.find((e) => e.kind !== 'birthday');
  const month = MONTHS[ym.m - 1];
  return (
    <div className="mini-cal-box">
      <h2>Calendário</h2>
      <div className="panel">
        <div className="mini-nav">
          <button className="btn sm" onClick={() => move(-1)} aria-label="Mês anterior">◀</button>
          <b>{month[0].toUpperCase() + month.slice(1)} {ym.y}</b>
          <button className="btn sm" onClick={() => move(1)} aria-label="Próximo mês">▶</button>
        </div>
        <div className="mini-cal">
          {WEEK.map((w) => <span key={w} className="mini-wd">{w[0]}</span>)}
          {cells.map((d, i) => {
            const ev = d ? byDay.get(d) ?? [] : [];
            const cls = ev.some((e) => e.kind === 'holiday') ? ' hol' : ev.some((e) => e.kind === 'optional') ? ' opt' : '';
            return <span key={i} className={'mini-day' + cls + (d === today ? ' today' : '') + (ev.some((e) => e.kind === 'birthday') ? ' bday' : '')}
              title={ev.map((e) => (e.kind === 'birthday' ? '🎂 ' : '') + e.label).join('\n') || undefined}>{d ? +d.slice(8) : ''}</span>;
          })}
        </div>
        <p className="note mini-key"><span className="cal-key holiday" /> feriado · <span className="cal-key optional" /> facultativo · <span className="mini-dot" /> aniversário</p>
        <h3 className="mini-h">Próximos aniversários</h3>
        {nextBdays.length ? nextBdays.map((e, i) => (
          <div key={i} className="cal-next"><span className={'cal-when' + (e.date === today ? ' now' : '')}>{whenLabel(e.date, today)}</span><span>🎂 {firstNames(e.label)}</span></div>
        )) : <p className="note">{q.isLoading ? 'Carregando…' : 'Nenhum aniversário cadastrado.'}</p>}
        {nextHol && <h3 className="mini-h">Próximo feriado</h3>}
        {nextHol && <div className="cal-next"><span className={'cal-when' + (nextHol.date === today ? ' now' : '')}>{whenLabel(nextHol.date, today)}</span><span>📅 {nextHol.label}</span></div>}
        <Link className="btn sm" to="/calendario" style={{ marginTop: 10 }}>Abrir calendário</Link>
      </div>
    </div>
  );
}
