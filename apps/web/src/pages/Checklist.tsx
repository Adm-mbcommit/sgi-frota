/**
 * Frota → Checklist periódico: vistoria quinzenal dos veículos, com fotos, feita pela administração.
 * (O checklist diário dos motoristas continua no Comando de Bordo; é outra coisa.)
 *
 * Fluxo: quadro com a situação de cada veículo → "Fazer checklist" → fotos + itens + km → salvar.
 * As fotos são reduzidas no navegador (lado maior 1600 px, JPEG) antes de enviar, uma por vez.
 * Item com "Problema" vira uma Pendência do veículo (Gestão → Pendências).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { inspectionTemplateFor } from '@sgi/core';
import { api, apiBlob, uploadTo } from '../lib/api';
import { fd, nf, todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import { DataTable, Header, Loading } from '../components/ui';

type Answer = 'OK' | 'ATENCAO' | 'PROBLEMA' | 'NA';
type Due = 'EM_DIA' | 'VENCENDO' | 'ATRASADO' | 'NUNCA';
interface ItemDef { key: string; group: string; label: string; pickup?: boolean }
interface PhotoSlot { key: string; label: string; required: boolean; pickup?: boolean }
interface Template { items: ItemDef[]; photos: PhotoSlot[]; fuelLevels: string[]; intervalDays: number; alertDays: number }
interface BoardVehicle {
  vehicleId: string; name: string; plate: string; model: string | null; next: string | null; days: number | null; status: Due;
  last: { id: string; date: string; km: number | null; ok: number; attention: number; problems: number; photoId: string | null } | null;
}
export interface InspectionBoard { today: string; intervalDays: number; alertDays: number; vehicles: BoardVehicle[] }
interface Row { id: string; vehicleId: string; date: string; km: number | null; fuelLevel: string | null; notes: string | null; vehicleName: string; plate: string; userName: string | null; photos: number; ok: number; attention: number; problems: number }
interface Item { key: string; label: string; group: string; status: Answer; note: string | null }
interface Photo { id: string; slot: string; caption: string | null; size: number }
interface Detail { id: string; vehicleId: string; vehicleName: string; plate: string; date: string; km: number | null; fuelLevel: string | null; notes: string | null; userName: string | null; items: Item[]; photos: Photo[] }

const ANSWERS: [Answer, string][] = [['OK', 'OK'], ['ATENCAO', 'Atenção'], ['PROBLEMA', 'Problema'], ['NA', 'Não tem']];
const ANSWER_CLS: Record<Answer, string> = { OK: 'ok', ATENCAO: 'warn', PROBLEMA: 'bad', NA: '' };
const DUE_CLS: Record<Due, string> = { EM_DIA: 'ok', VENCENDO: 'warn', ATRASADO: 'bad', NUNCA: 'bad' };
const plural = (n: number, s: string, p = s + 's') => `${n} ${n === 1 ? s : p}`;
const dueText = (v: BoardVehicle) =>
  v.status === 'NUNCA' ? 'Nunca feito' : v.days! < 0 ? `Atrasado ${plural(-v.days!, 'dia')}` : v.days === 0 ? 'Vence hoje' : `Faltam ${plural(v.days!, 'dia')}`;

export const useInspectionBoard = () => {
  const { can } = useAuth();
  return useQuery({ queryKey: ['inspections', 'board'], queryFn: () => api<InspectionBoard>('/inspections/board'), enabled: !can('MOTORISTA'), staleTime: 5 * 60_000 });
};
/** Veículos com checklist atrasado, vencendo ou nunca feito (contador do menu). */
export const inspectionAlerts = (b?: InspectionBoard) => (b?.vehicles ?? []).filter((v) => v.status !== 'EM_DIA');

/* ---------- fotos ---------- */

/** Reduz a foto (lado maior 1600 px, JPEG 80%) para ocupar ~300 KB. */
async function shrink(file: File): Promise<Blob> {
  const max = 1600;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
    if (out) return out;
  } catch { /* formato que o navegador não abre: envia como veio */ }
  return file;
}

const urlCache = new Map<string, Promise<string>>();
/** Foto guardada no SGI (precisa do login, por isso é baixada e mostrada como blob). */
function SavedPhoto({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    if (!urlCache.has(id)) urlCache.set(id, apiBlob('/inspection-photos/' + id).then((b) => URL.createObjectURL(b)));
    urlCache.get(id)!.then((u) => live && setSrc(u)).catch(() => urlCache.delete(id));
    return () => { live = false; };
  }, [id]);
  return src
    ? <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir a foto"><img src={src} alt={alt} className={className} loading="lazy" /></a>
    : <span className={'insp-ph-empty ' + (className ?? '')}>…</span>;
}

/* ---------- tela ---------- */

export default function Checklist() {
  const { can } = useAuth();
  const write = can(...WRITE);
  const board = useInspectionBoard();
  const hist = useQuery({ queryKey: ['inspections', 'list'], queryFn: () => api<Row[]>('/inspections') });
  const tpl = useQuery({ queryKey: ['inspections', 'template'], queryFn: () => api<Template>('/inspections/template'), staleTime: Infinity });
  const [form, setForm] = useState<{ vehicleId?: string; edit?: Detail } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const open = (f: typeof form) => { setView(null); setForm(f); requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth' })); };

  if (form && tpl.data && board.data) return <div ref={top}><InspectionForm tpl={tpl.data} vehicles={board.data.vehicles} {...form} onClose={() => setForm(null)} /></div>;
  const b = board.data;
  const late = inspectionAlerts(b);
  return (
    <div ref={top}>
      <Header title="Checklist periódico"
        sub={`Vistoria dos veículos a cada ${b?.intervalDays ?? 15} dias, com fotos. Feito pela administração (o checklist diário dos motoristas continua no Comando de Bordo).`}
        actions={write && <button className="btn pri" onClick={() => open({})}>Novo checklist</button>} />
      <Loading q={board} />
      {b && <>
        {late.length === 0
          ? <section className="panel cnd-ok">✅ <b>Todos os veículos em dia.</b></section>
          : <div className="banner">📋 {plural(late.length, 'veículo precisa', 'veículos precisam')} de checklist: {late.map((v) => `${v.name} (${dueText(v).toLowerCase()})`).join(', ')}.</div>}
        <div className="insp-board">
          {b.vehicles.map((v) => (
            <article key={v.vehicleId} className={'panel insp-card ' + DUE_CLS[v.status]}>
              <div className="insp-thumb">
                {v.last?.photoId ? <SavedPhoto id={v.last.photoId} alt={'Frente de ' + v.name} /> : <span className="insp-ph-empty">🚗</span>}
              </div>
              <div className="insp-info">
                <h3>{v.name}</h3>
                <small>{v.plate}{v.model ? ' · ' + v.model : ''}</small>
                <div><span className={'chip ' + DUE_CLS[v.status]}>{dueText(v)}</span></div>
                {v.last
                  ? <p className="note">Último: <b>{fd(v.last.date)}</b>{v.last.km != null && <> · {nf(v.last.km)} km</>}
                      {v.last.problems > 0 && <> · <span className="insp-bad">{plural(v.last.problems, 'problema')}</span></>}
                      {v.last.attention > 0 && <> · {plural(v.last.attention, 'atenção', 'atenções')}</>}
                      <br />Próximo: {fd(v.next)}</p>
                  : <p className="note">Ainda sem checklist no SGI.</p>}
                <div className="insp-card-act">
                  {write && <button className={'btn' + (v.status !== 'EM_DIA' ? ' pri' : '')} onClick={() => open({ vehicleId: v.vehicleId })}>Fazer checklist</button>}
                  {v.last && <button className="btn" onClick={() => setView(v.last!.id)}>Ver último</button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </>}

      <section className="panel" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Histórico</h3>
        <Loading q={hist} />
        {hist.data && <DataTable rows={hist.data} filter={{ label: 'Veículo', v: (r) => r.vehicleName }} cols={[
          { h: 'Data', v: (r) => r.date, f: (r) => fd(r.date) },
          { h: 'Veículo', v: (r) => r.vehicleName },
          { h: 'Km', v: (r) => r.km, f: (r) => nf(r.km), n: true },
          { h: 'Combustível', v: (r) => r.fuelLevel },
          { h: 'Resultado', v: (r) => r.problems * 1000 + r.attention, f: (r) => r.problems ? <span className="chip bad">{plural(r.problems, 'problema')}</span> : r.attention ? <span className="chip warn">{plural(r.attention, 'atenção', 'atenções')}</span> : <span className="chip ok">Tudo OK</span> },
          { h: 'Fotos', v: (r) => r.photos, n: true },
          { h: 'Feito por', v: (r) => r.userName },
          { h: '', v: () => '', f: (r) => <button className="btn sm" onClick={() => setView(r.id)}>Ver</button> },
        ]} />}
      </section>

      {view && <InspectionView id={view} onClose={() => setView(null)} onEdit={write ? (d) => open({ edit: d }) : undefined} />}
    </div>
  );
}

/* ---------- ver um checklist ---------- */

function InspectionView({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit?: (d: Detail) => void }) {
  const ref = useRef<HTMLDialogElement>(null); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['inspections', 'detail', id], queryFn: () => api<Detail>('/inspections/' + id) });
  const tpl = useQuery({ queryKey: ['inspections', 'template'], queryFn: () => api<Template>('/inspections/template'), staleTime: Infinity });
  useEffect(() => { ref.current?.showModal(); }, []);
  const d = q.data;
  const slotLabel = (s: string) => tpl.data?.photos.find((p) => p.key === s)?.label ?? s;
  const notOk = d?.items.filter((i) => i.status === 'PROBLEMA' || i.status === 'ATENCAO') ?? [];
  const remove = async () => {
    if (!d || !confirm(`Excluir o checklist de ${d.vehicleName} de ${fd(d.date)}, com as fotos? As pendências já abertas continuam.`)) return;
    await api('/inspections/' + d.id, { method: 'DELETE' });
    await qc.invalidateQueries({ queryKey: ['inspections'] }); onClose();
  };
  return (
    <dialog ref={ref} onClose={onClose} className="insp-dialog">
      <Loading q={q} />
      {d && <>
        <h3>{d.vehicleName} · checklist de {fd(d.date)}</h3>
        <p className="note" style={{ marginTop: 0 }}>{d.plate}{d.km != null && <> · {nf(d.km)} km</>}{d.fuelLevel && <> · combustível {d.fuelLevel}</>}{d.userName && <> · feito por {d.userName}</>}</p>
        {d.photos.length > 0
          ? <div className="insp-photos">{d.photos.map((p) => <figure key={p.id}><SavedPhoto id={p.id} alt={slotLabel(p.slot)} /><figcaption>{slotLabel(p.slot)}{p.caption ? ': ' + p.caption : ''}</figcaption></figure>)}</div>
          : <p className="banner">Este checklist está sem fotos.</p>}
        {notOk.length > 0
          ? <><h4>Pontos a acompanhar</h4><ul className="insp-issues">{notOk.map((i) => <li key={i.key}><span className={'chip ' + ANSWER_CLS[i.status]}>{i.status === 'PROBLEMA' ? 'Problema' : 'Atenção'}</span> <b>{i.label}</b>{i.note && <> — {i.note}</>}</li>)}</ul></>
          : <p className="cnd-ok">✅ Todos os itens OK.</p>}
        {d.notes && <><h4>Observações</h4><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{d.notes}</p></>}
        <details className="note"><summary>Todos os itens ({d.items.length})</summary>
          <ul className="insp-all">{d.items.map((i) => <li key={i.key}><span className={'chip ' + ANSWER_CLS[i.status]}>{ANSWERS.find(([a]) => a === i.status)?.[1]}</span> {i.label}{i.note ? ` — ${i.note}` : ''}</li>)}</ul>
        </details>
      </>}
      <div className="act">
        {d && onEdit && <button className="btn" onClick={remove}>Excluir</button>}
        {d && onEdit && <button className="btn" onClick={() => onEdit(d)}>Editar</button>}
        <button className="btn pri" onClick={onClose}>Fechar</button>
      </div>
    </dialog>
  );
}

/* ---------- fazer / editar um checklist ---------- */

interface NewPhoto { tmp: string; slot: string; blob: Blob; url: string }

function InspectionForm({ tpl, vehicles, vehicleId, edit, onClose }: { tpl: Template; vehicles: BoardVehicle[]; vehicleId?: string; edit?: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const [vid, setVid] = useState(edit?.vehicleId ?? vehicleId ?? '');
  const [date, setDate] = useState(edit?.date ?? todayIso());
  const [km, setKm] = useState(edit?.km != null ? String(edit.km) : '');
  const [fuel, setFuel] = useState(edit?.fuelLevel ?? '');
  const [notes, setNotes] = useState(edit?.notes ?? '');
  const [ans, setAns] = useState<Record<string, { status?: Answer; note: string }>>(() =>
    Object.fromEntries((edit?.items ?? []).map((i) => [i.key, { status: i.status, note: i.note ?? '' }])));
  const [saved, setSaved] = useState<Photo[]>(edit?.photos ?? []);
  const [photos, setPhotos] = useState<NewPhoto[]>([]);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const vehicle = vehicles.find((v) => v.vehicleId === vid);
  // picapes (Saveiro) recebem também os itens e a foto de caçamba e capota
  const items = useMemo(() => (vehicle ? inspectionTemplateFor(tpl.items, vehicle) : tpl.items.filter((i) => !i.pickup)), [tpl, vehicle]);
  const slots = useMemo(() => (vehicle ? inspectionTemplateFor(tpl.photos, vehicle) : tpl.photos.filter((p) => !p.pickup)), [tpl, vehicle]);
  const groups = useMemo(() => [...new Set(items.map((i) => i.group))], [items]);
  const missing = items.filter((i) => !ans[i.key]?.status);
  const hasPhoto = (slot: string) => saved.some((p) => p.slot === slot) || photos.some((p) => p.slot === slot);
  const missingPhotos = slots.filter((p) => p.required && !hasPhoto(p.key));
  const set = (key: string, patch: Partial<{ status: Answer; note: string }>) => setAns((a) => ({ ...a, [key]: { status: a[key]?.status, note: a[key]?.note ?? '', ...patch } }));

  const addPhotos = async (slot: string, files: FileList | null) => {
    if (!files?.length) return;
    setBusy('Preparando foto…');
    try {
      const list = slot === 'outra' ? [...files] : [files[0]];
      const out: NewPhoto[] = [];
      for (const f of list) { const blob = await shrink(f); out.push({ tmp: Math.random().toString(36).slice(2), slot, blob, url: URL.createObjectURL(blob) }); }
      setPhotos((p) => [...(slot === 'outra' ? p : p.filter((x) => x.slot !== slot)), ...out]);
    } finally { setBusy(''); }
  };
  const dropNew = (tmp: string) => setPhotos((p) => { const x = p.find((y) => y.tmp === tmp); if (x) URL.revokeObjectURL(x.url); return p.filter((y) => y.tmp !== tmp); });
  const dropSaved = async (p: Photo) => {
    if (!confirm('Apagar esta foto já guardada?')) return;
    await api('/inspection-photos/' + p.id, { method: 'DELETE' }); setSaved((s) => s.filter((x) => x.id !== p.id));
  };

  const save = async () => {
    setErr('');
    if (!vid) return setErr('Escolha o veículo.');
    if (missing.length) return setErr(`Falta responder ${plural(missing.length, 'item', 'itens')}: ${missing.slice(0, 4).map((i) => i.label).join(', ')}${missing.length > 4 ? '…' : ''}. Use "Marcar o resto como OK" se estiver tudo certo.`);
    const noNote = items.filter((i) => ans[i.key]?.status === 'PROBLEMA' && !ans[i.key]?.note.trim());
    if (noNote.length) return setErr(`Descreva o problema em: ${noNote.map((i) => i.label).join(', ')}.`);
    if (missingPhotos.length && !confirm(`Faltam fotos: ${missingPhotos.map((p) => p.label).join(', ')}. Salvar mesmo assim?`)) return;
    const body = {
      date, km: km.trim() ? Math.round(Number(km.replace(/\./g, '').replace(',', '.'))) : null, fuelLevel: fuel || null, notes: notes.trim() || null,
      items: items.map((i) => ({ key: i.key, status: ans[i.key].status, note: ans[i.key].note.trim() || null })),
    };
    if (body.km != null && !Number.isFinite(body.km)) return setErr('Km inválido.');
    setBusy('Salvando…');
    try {
      const r = edit
        ? await api<{ id: string; tasksCreated: number }>('/inspections/' + edit.id, { method: 'PATCH', json: body })
        : await api<{ id: string; tasksCreated: number }>('/inspections', { method: 'POST', json: { ...body, vehicleId: vid } });
      let sent = 0;
      for (const p of photos) {
        setBusy(`Enviando fotos ${sent + 1} de ${photos.length}…`);
        await uploadTo(`/inspections/${r.id}/photos?slot=${encodeURIComponent(p.slot)}`, p.blob, `${p.slot}.jpg`);
        sent++; dropNew(p.tmp);
      }
      await qc.invalidateQueries({ queryKey: ['inspections'] });
      if (r.tasksCreated) await qc.invalidateQueries({ queryKey: ['dashboard'] });
      alert(`Checklist salvo.${r.tasksCreated ? ` ${plural(r.tasksCreated, 'pendência aberta', 'pendências abertas')} para os problemas (Gestão → Pendências).` : ''}`);
      onClose();
    } catch (e) {
      setErr((e as Error).message + (photos.length ? ' As fotos que faltaram continuam aqui: clique em Salvar de novo.' : ''));
      await qc.invalidateQueries({ queryKey: ['inspections'] });
    } finally { setBusy(''); }
  };

  return (
    <>
      <Header title={edit ? `Editar checklist · ${edit.vehicleName}` : 'Novo checklist periódico'}
        sub="Tire as fotos, confira os itens e salve. Pode fazer pelo celular, andando em volta do carro."
        actions={<button className="btn" onClick={onClose} disabled={!!busy}>Voltar</button>} />

      <section className="panel insp-head">
        <label className="fld"><span>Veículo</span>
          <select value={vid} onChange={(e) => setVid(e.target.value)} disabled={!!edit}>
            <option value="">Escolha…</option>
            {vehicles.map((v) => <option key={v.vehicleId} value={v.vehicleId}>{v.name} · {v.plate}</option>)}
          </select></label>
        <label className="fld"><span>Data</span><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="fld"><span>Km no painel</span><input inputMode="numeric" placeholder={vehicle?.last?.km != null ? `último: ${nf(vehicle.last.km)}` : 'ex.: 45.300'} value={km} onChange={(e) => setKm(e.target.value)} /></label>
        <div className="fld"><span>Combustível</span>
          <div className="insp-seg">{tpl.fuelLevels.map((f) => <button type="button" key={f} className={fuel === f ? 'on' : ''} onClick={() => setFuel(fuel === f ? '' : f)}>{f}</button>)}</div>
        </div>
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>1. Fotos</h3>
        <div className="insp-slots">
          {slots.map((s) => {
            const mine = photos.filter((p) => p.slot === s.key); const old = saved.filter((p) => p.slot === s.key);
            const done = mine.length + old.length > 0;
            return (
              <div key={s.key} className={'insp-slot' + (done ? ' done' : s.required ? ' req' : '')}>
                <b>{s.label}{s.required ? '' : ' (opcional)'}</b>
                <div className="insp-slot-imgs">
                  {old.map((p) => <span key={p.id} className="insp-slot-img"><SavedPhoto id={p.id} alt={s.label} /><button type="button" onClick={() => dropSaved(p)} aria-label="Apagar foto">✕</button></span>)}
                  {mine.map((p) => <span key={p.tmp} className="insp-slot-img"><img src={p.url} alt={s.label} /><button type="button" onClick={() => dropNew(p.tmp)} aria-label="Tirar foto da lista">✕</button></span>)}
                </div>
                <label className="btn sm insp-pick">📷 {done && s.key !== 'outra' ? 'Trocar' : 'Tirar / escolher'}
                  <input type="file" accept="image/*" capture="environment" multiple={s.key === 'outra'} onChange={(e) => { addPhotos(s.key, e.target.files); e.target.value = ''; }} />
                </label>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="insp-items-top">
          <h3 style={{ margin: 0 }}>2. Itens <small className="note">({items.length - missing.length} de {items.length})</small></h3>
          <button type="button" className="btn" disabled={!missing.length} onClick={() => missing.forEach((i) => set(i.key, { status: 'OK' }))}>Marcar o resto como OK</button>
        </div>
        {groups.map((g) => <div key={g} className="insp-group">
          <h4>{g}</h4>
          {items.filter((i) => i.group === g).map((i) => {
            const a = ans[i.key];
            return (
              <div key={i.key} className={'insp-item' + (a?.status ? ' ' + ANSWER_CLS[a.status] : '')}>
                <span className="insp-item-label">{i.label}</span>
                <div className="insp-seg">{ANSWERS.map(([k, l]) => <button type="button" key={k} className={a?.status === k ? 'on ' + ANSWER_CLS[k] : ''} onClick={() => set(i.key, { status: k })}>{l}</button>)}</div>
                {(a?.status === 'ATENCAO' || a?.status === 'PROBLEMA') &&
                  <input className="insp-note" placeholder={a.status === 'PROBLEMA' ? 'O que está errado? (vira pendência)' : 'O que observar?'} value={a.note} onChange={(e) => set(i.key, { note: e.target.value })} />}
              </div>
            );
          })}
        </div>)}
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>3. Observações</h3>
        <textarea className="insp-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Algo mais que valha registrar (opcional)" />
      </section>

      <div className="insp-save">
        {err && <div className="err">{err}</div>}
        {missingPhotos.length > 0 && !err && <span className="note" style={{ margin: 0 }}>Faltam fotos: {missingPhotos.map((p) => p.label).join(', ')}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose} disabled={!!busy}>Cancelar</button>
        <button className="btn pri" onClick={save} disabled={!!busy}>{busy || 'Salvar checklist'}</button>
      </div>
      <p className="note">Itens com <b>Problema</b> viram pendência do veículo em <Link to="/frota/pendencias">Gestão → Pendências</Link>.</p>
    </>
  );
}
