import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chipClass, STATUS_LABEL } from '../lib/format';
import { usePeriod } from '../lib/period';

export const Chip = ({ s, label }: { s?: string | null; label?: string }) =>
  s ? <span className={'chip ' + chipClass(s)}>{label ?? STATUS_LABEL[s] ?? s}</span> : null;

export const Problems = ({ list }: { list: { label: string }[] }) =>
  list.length ? <span className="chip bad" style={{ whiteSpace: 'normal' }}>{list.map((p) => p.label).join('; ')}</span> : null;

export function Header({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="top">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {actions && <div className="live">{actions}</div>}
    </div>
  );
}

export function PeriodPicker() {
  const { period, setPeriod } = usePeriod();
  return (
    <div className="tools per">
      <label>De <input type="date" value={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} /></label>
      <label>Até <input type="date" value={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} /></label>
    </div>
  );
}

export const Kpi = ({ label, value, note }: { label: string; value: ReactNode; note?: string }) => (
  <div className="kpi"><small>{label}</small><b>{value}</b>{note && <em>{note}</em>}</div>
);

export function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <div className="empty">Carregando…</div>;
  if (q.error) return <div className="banner">{(q.error as Error).message}</div>;
  return null;
}

/* ---------- tabela com busca, filtro e ordenação ---------- */
export interface Col<T> { h: string; v: (r: T) => unknown; f?: (r: T) => ReactNode; n?: boolean; w?: boolean }

export function DataTable<T>({ rows, cols, filter, extra, limit = 300, maxh }: {
  rows: T[]; cols: Col<T>[]; filter?: { label: string; v: (r: T) => string | null | undefined }; extra?: ReactNode; limit?: number; maxh?: number;
}) {
  const [q, setQ] = useState(''); const [fv, setFv] = useState(''); const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const opts = useMemo(() => (filter ? [...new Set(rows.map(filter.v).filter(Boolean) as string[])].sort() : []), [rows, filter]);
  const shown = useMemo(() => {
    let r = rows.filter((row) => (!q || cols.some((c) => String(c.v(row) ?? '').toLowerCase().includes(q))) && (!fv || filter!.v(row) === fv));
    if (sort) r = [...r].sort((a, b) => {
      const x = cols[sort.i].v(a) as never, y = cols[sort.i].v(b) as never;
      if (x === y) return 0; if (x == null || x === '') return 1; if (y == null || y === '') return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
    return r;
  }, [rows, q, fv, sort, cols, filter]);
  return (
    <div>
      <div className="tools">
        <input type="search" placeholder="Buscar" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} />
        {filter && <select aria-label={filter.label} value={fv} onChange={(e) => setFv(e.target.value)}><option value="">{filter.label}</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>}
        {extra}
      </div>
      <div className="tw" style={maxh ? { maxHeight: maxh, overflow: 'auto' } : undefined}>
        <table>
          <thead><tr>{cols.map((c, i) => <th key={i}><button onClick={() => setSort({ i, dir: sort?.i === i ? (-sort.dir as 1 | -1) : 1 })}>{c.h}</button></th>)}</tr></thead>
          <tbody>
            {shown.slice(0, limit).map((r, k) => <tr key={k}>{cols.map((c, i) => <td key={i} className={(c.n ? 'n ' : '') + (c.w ? 'wide' : '')}>{c.f ? c.f(r) : String(c.v(r) ?? '')}</td>)}</tr>)}
            {!shown.length && <tr><td colSpan={cols.length} className="wide">Nenhum registro para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="count">{shown.length} registro{shown.length === 1 ? '' : 's'}{shown.length > limit ? ` (mostrando ${limit})` : ''}</div>
    </div>
  );
}

/* ---------- formulário em diálogo ---------- */
export interface Field { name: string; label: string; type?: 'text' | 'number' | 'date' | 'check' | 'select'; value?: unknown; step?: string; options?: [string, string][]; required?: boolean }

export function FormDialog({ title, fields, onSave, onClose, extra, note }: {
  title: string; note?: string; fields: Field[]; onSave: (v: Record<string, string | boolean>) => Promise<unknown>; onClose: () => void; extra?: { label: string; run: () => Promise<unknown> };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} onClose={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget); const o: Record<string, string | boolean> = {};
        fields.forEach((f) => { o[f.name] = f.type === 'check' ? fd.get(f.name) === 'on' : String(fd.get(f.name) ?? ''); });
        go(() => onSave(o));
      }}>
        <h3>{title}</h3>
        {note && <p className="note" style={{ marginTop: 0 }}>{note}</p>}
        {fields.map((f) => f.type === 'check'
          ? <label key={f.name} className="fld chk"><input type="checkbox" name={f.name} defaultChecked={!!f.value} /> {f.label}</label>
          : f.type === 'select'
            ? <label key={f.name} className="fld"><span>{f.label}</span><select name={f.name} defaultValue={String(f.value ?? '')}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            : <label key={f.name} className="fld"><span>{f.label}</span><input name={f.name} type={f.type ?? 'text'} step={f.step} required={f.required} defaultValue={f.value == null ? '' : String(f.value)} /></label>)}
        {err && <div className="err">{err}</div>}
        <div className="act">
          {extra && <button type="button" className="btn" disabled={busy} onClick={() => go(extra.run)}>{extra.label}</button>}
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Converte string vazia em null e números. */
export const nn = (v: unknown) => (v === '' || v == null ? null : v);
export const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
