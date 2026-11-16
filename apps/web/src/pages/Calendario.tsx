/** Calendário: feriados nacionais (calculados), aniversários da equipe e compromissos. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { daysBetween, nationalHolidays, nextBirthday, type Holiday } from '@sgi/core';
import { api, upload } from '../lib/api';
import { todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import { FormDialog, Header, Loading, num } from '../components/ui';

export interface Birthday { id: string; name: string; day: number; month: number; year?: number | null }
export const useBirthdays = () => useQuery({ queryKey: ['birthdays'], queryFn: () => api<Birthday[]>('/birthdays'), staleTime: 10 * 60_000 });

export interface Appointment { id: string; date: string; time: string | null; title: string; notes: string | null; shared: boolean; mine: boolean; owner: string }
export const useAppointments = (from: string, to: string) =>
  useQuery({ queryKey: ['appointments', from, to], queryFn: () => api<Appointment[]>(`/appointments?from=${from}&to=${to}`) });
const plusDays = (date: string, n: number) => { const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const apptLabel = (a: Appointment) => (a.time ? a.time + ' ' : '') + a.title;

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

export interface CalEvent { date: string; kind: 'holiday' | 'optional' | 'birthday' | 'appointment'; label: string; appt?: Appointment }

/** Feriados, aniversários e compromissos entre duas datas (inclusive). */
function eventsBetween(from: string, to: string, bdays: Birthday[], appts: Appointment[] = []): CalEvent[] {
  const years = [+from.slice(0, 4), +to.slice(0, 4)].filter((y, i, a) => a.indexOf(y) === i);
  const hol = years.flatMap((y) => nationalHolidays(y)).filter((h: Holiday) => h.date >= from && h.date <= to)
    .map((h): CalEvent => ({ date: h.date, kind: h.optional ? 'optional' : 'holiday', label: h.name + (h.optional ? ' (ponto facultativo)' : '') }));
  const bd = bdays.flatMap((b) => years.map((y) => nextBirthday(b, `${y}-01-01`)).filter((d) => d >= from && d <= to)
    .map((d): CalEvent => ({ date: d, kind: 'birthday', label: b.name })));
  const ap = appts.filter((a) => a.date >= from && a.date <= to).map((a): CalEvent => ({ date: a.date, kind: 'appointment', label: apptLabel(a), appt: a }));
  const order = { holiday: 0, optional: 1, appointment: 2, birthday: 3 };
  return [...hol, ...ap, ...bd].sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || (a.appt?.time ?? '').localeCompare(b.appt?.time ?? ''));
}

/** Próximos eventos a partir de hoje (para o Início e a lista ao lado do calendário). */
export function upcoming(bdays: Birthday[], days: number, today = todayIso(), appts: Appointment[] = []) {
  return eventsBetween(today, plusDays(today, days), bdays, appts);
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
  const [day, setDay] = useState<string | null>(null);
  const aq = useAppointments(first < today ? first : today, last > plusDays(today, 60) ? last : plusDays(today, 60));
  const appts = aq.data ?? [];
  const events = useMemo(() => eventsBetween(first, last, bdays, appts), [first, last, bdays, appts]);
  const byDay = new Map<string, CalEvent[]>();
  events.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null)];
  for (let d = 1; d <= +last.slice(8); d++) cells.push(`${ym.y}-${pad(ym.m)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const move = (n: number) => setYm(({ y, m }) => { const t = (y * 12 + m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const next = upcoming(bdays, 60, today, appts);
  return (
    <>
      <Header title="Calendário" sub="Feriados nacionais, aniversários da equipe e seus compromissos. Clique num dia para marcar um compromisso." />
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
                <div key={i} className={'cal-day' + (!d ? ' empty' : ' click') + (d === today ? ' today' : '') + (hol ? ' hol' : '') + (d && weekday(d) % 6 === 0 ? ' we' : '')}
                  onClick={d ? () => setDay(d) : undefined} role={d ? 'button' : undefined} tabIndex={d ? 0 : undefined} onKeyDown={d ? (e) => e.key === 'Enter' && setDay(d) : undefined}
                  aria-label={d ? `Dia ${+d.slice(8)}: ver ou marcar compromisso` : undefined}>
                  {d && <><span className="cal-n">{+d.slice(8)}</span>
                    {ev.map((e, k) => <span key={k} className={'cal-ev ' + e.kind} title={e.label}>{e.kind === 'birthday' ? '🎂 ' + e.label.split(' ')[0] : e.kind === 'appointment' ? '🕑 ' + e.label : e.label.replace(' (ponto facultativo)', '')}</span>)}</>}
                </div>
              );
            })}
          </div>
          <p className="note"><span className="cal-key holiday" /> feriado nacional · <span className="cal-key optional" /> ponto facultativo · 🎂 aniversário · 🕑 compromisso. Feriados estaduais e municipais não aparecem.</p>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Próximos 60 dias</h2>
          <div className="panel">
            {next.length ? next.map((e, i) => (
              <div key={i} className="cal-next"><span className={'cal-when' + (e.date === today ? ' now' : '')}>{whenLabel(e.date, today)}</span>
                <span>{e.kind === 'birthday' ? '🎂 ' + e.label : e.kind === 'appointment' ? <button className="linkish" onClick={() => setDay(e.date)}>🕑 {e.label}</button> : e.label}</span></div>
            )) : <p className="note">Nada nos próximos 60 dias.</p>}
          </div>
          {can(...WRITE) && <BirthdayAdmin list={bdays} />}
        </div>
      </div>
      {day && <DayDialog date={day} events={eventsBetween(day, day, bdays, appts)} onClose={() => setDay(null)} />}
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
  const aq = useAppointments(today, today);
  if (!q.data) return null;
  const week = upcoming(q.data, 7, today).filter((e) => e.kind === 'birthday');
  const hol = upcoming([], 120, today)[0];
  const todayAppts = aq.data ?? [];
  if (!week.length && !hol && !todayAppts.length) return null;
  return (
    <div className="banner cal-banner">
      {todayAppts.length > 0 && <span>🕑 <b>Hoje:</b> {todayAppts.map(apptLabel).join(' · ')}</span>}
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
  const [day, setDay] = useState<string | null>(null);
  const first = `${ym.y}-${pad(ym.m)}-01`;
  const last = `${ym.y}-${pad(ym.m)}-${pad(new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate())}`;
  const aq = useAppointments(first < today ? first : today, last > plusDays(today, 60) ? last : plusDays(today, 60));
  const appts = aq.data ?? [];
  const byDay = new Map<string, CalEvent[]>();
  eventsBetween(first, last, bdays, appts).forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null)];
  for (let d = 1; d <= +last.slice(8); d++) cells.push(`${ym.y}-${pad(ym.m)}-${pad(d)}`);
  const move = (n: number) => setYm(({ y, m }) => { const t = (y * 12 + m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const next = upcoming(bdays, 366, today);
  const nextAppts = upcoming([], 60, today, appts).filter((e) => e.kind === 'appointment').slice(0, 5);
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
            if (!d) return <span key={i} />;
            return <button key={i} type="button" onClick={() => setDay(d)}
              className={'mini-day' + cls + (d === today ? ' today' : '') + (ev.some((e) => e.kind === 'birthday') ? ' bday' : '') + (ev.some((e) => e.kind === 'appointment') ? ' appt' : '')}
              title={ev.map((e) => (e.kind === 'birthday' ? '🎂 ' : e.kind === 'appointment' ? '🕑 ' : '') + e.label).join('\n') || 'Marcar compromisso'}>{+d.slice(8)}</button>;
          })}
        </div>
        <p className="note mini-key"><span className="cal-key holiday" /> feriado · <span className="cal-key optional" /> facultativo · <span className="mini-dot" /> aniversário · <span className="mini-dot appt" /> compromisso</p>
        <p className="note" style={{ margin: '0 0 4px' }}>Clique num dia para marcar um compromisso.</p>
        {nextAppts.length > 0 && <>
          <h3 className="mini-h">Próximos compromissos</h3>
          {nextAppts.map((e, i) => (
            <div key={i} className="cal-next"><span className={'cal-when' + (e.date === today ? ' now' : '')}>{whenLabel(e.date, today)}</span>
              <button className="linkish" onClick={() => setDay(e.date)}>🕑 {e.label}</button></div>
          ))}
        </>}
        <h3 className="mini-h">Próximos aniversários</h3>
        {nextBdays.length ? nextBdays.map((e, i) => (
          <div key={i} className="cal-next"><span className={'cal-when' + (e.date === today ? ' now' : '')}>{whenLabel(e.date, today)}</span><span>🎂 {firstNames(e.label)}</span></div>
        )) : <p className="note">{q.isLoading ? 'Carregando…' : 'Nenhum aniversário cadastrado.'}</p>}
        {nextHol && <h3 className="mini-h">Próximo feriado</h3>}
        {nextHol && <div className="cal-next"><span className={'cal-when' + (nextHol.date === today ? ' now' : '')}>{whenLabel(nextHol.date, today)}</span><span>📅 {nextHol.label}</span></div>}
        <Link className="btn sm" to="/calendario" style={{ marginTop: 10 }}>Abrir calendário</Link>
      </div>
      {day && <DayDialog date={day} events={eventsBetween(day, day, bdays, appts)} onClose={() => setDay(null)} />}
    </div>
  );
}

const WEEK_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Janela de um dia: o que já tem nele e o formulário para marcar ou editar um compromisso. */
function DayDialog({ date, events, onClose }: { date: string; events: CalEvent[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDialogElement>(null);
  const [edit, setEdit] = useState<Partial<Appointment>>({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const refresh = () => qc.invalidateQueries({ queryKey: ['appointments'] });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!edit.title?.trim()) return setErr('Escreva o compromisso.');
    setBusy(true);
    try {
      const body = { date: edit.date ?? date, time: edit.time || null, title: edit.title, notes: edit.notes || null, shared: !!edit.shared };
      await api(edit.id ? `/appointments/${edit.id}` : '/appointments', { method: edit.id ? 'PATCH' : 'POST', json: body });
      await refresh(); setEdit({});
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!edit.id || !confirm('Excluir este compromisso?')) return;
    setBusy(true);
    try { await api(`/appointments/${edit.id}`, { method: 'DELETE' }); await refresh(); setEdit({}); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const set = (k: keyof Appointment) => (e: { target: { value: string } }) => setEdit({ ...edit, [k]: e.target.value });
  return (
    <dialog ref={ref} onClose={onClose} className="day-dialog">
      <h3>{WEEK_FULL[weekday(date)]}, {date.slice(8, 10)}/{date.slice(5, 7)}/{date.slice(0, 4)}</h3>
      {events.length > 0 ? <div className="day-list">{events.map((ev, i) => (
        ev.kind === 'appointment' && ev.appt
          ? <button key={i} type="button" className={'day-item appt' + (edit.id === ev.appt.id ? ' sel' : '')} disabled={!ev.appt.mine}
              onClick={() => setEdit(ev.appt!)} title={ev.appt.mine ? 'Clique para editar' : `Marcado por ${ev.appt.owner}`}>
              🕑 {ev.label}{ev.appt.shared && <span className="chip">👥 equipe</span>}{!ev.appt.mine && <span className="note"> · {ev.appt.owner}</span>}
              {ev.appt.notes && <span className="task-details">↳ {ev.appt.notes}</span>}
            </button>
          : <div key={i} className={'day-item ' + ev.kind}>{ev.kind === 'birthday' ? '🎂 Aniversário: ' + ev.label : '📅 ' + ev.label}</div>
      ))}</div> : <p className="note">Nada marcado neste dia.</p>}
      <form onSubmit={save} className="day-form">
        <h4>{edit.id ? 'Editar compromisso' : 'Novo compromisso'}</h4>
        <label className="fld"><span>Compromisso</span><input value={edit.title ?? ''} onChange={set('title')} placeholder="Ex.: Reunião com o Diego" maxLength={200} autoFocus /></label>
        <div className="day-row">
          <label className="fld"><span>Hora (opcional)</span><input type="time" value={edit.time ?? ''} onChange={set('time')} /></label>
          {edit.id && <label className="fld"><span>Data</span><input type="date" value={edit.date ?? date} onChange={set('date')} /></label>}
        </div>
        <label className="fld"><span>Observação (opcional)</span><input value={edit.notes ?? ''} onChange={set('notes')} maxLength={2000} /></label>
        <label className="fld chk"><input type="checkbox" checked={!!edit.shared} onChange={(e) => setEdit({ ...edit, shared: e.target.checked })} /> Mostrar para toda a equipe</label>
        {err && <div className="err">{err}</div>}
        <div className="act">
          {edit.id && <button type="button" className="btn" disabled={busy} onClick={remove}>Excluir</button>}
          {edit.id && <button type="button" className="btn" onClick={() => setEdit({})}>Novo</button>}
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </dialog>
  );
}
