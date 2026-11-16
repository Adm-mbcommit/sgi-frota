/** Minhas tarefas: o "caderno" do usuário. Só ele vê. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseTaskList } from '@sgi/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fd, todayIso } from '../lib/format';
import { FormDialog, Header, Loading, nn } from '../components/ui';

export interface PersonalTask { id: string; title: string; details: string | null; person: string | null; dueDate: string | null; status: 'A_FAZER' | 'AGUARDANDO' | 'FEITA'; doneAt: string | null; createdAt: string }
interface Routine { day: string; items: { id: string; title: string; checked: boolean }[] }

export const useMyTasks = () => useQuery({ queryKey: ['my-tasks'], queryFn: () => api<PersonalTask[]>('/my/tasks') });

/** Situação do prazo: atrasada, hoje ou futura. */
export function dueInfo(t: PersonalTask) {
  if (!t.dueDate || t.status === 'FEITA') return null;
  const today = todayIso();
  if (t.dueDate < today) return { cls: 'bad', label: 'Atrasada · ' + fd(t.dueDate) };
  if (t.dueDate === today) return { cls: 'warn', label: 'Hoje' };
  return { cls: '', label: 'Até ' + fd(t.dueDate) };
}

export default function Tarefas() {
  const qc = useQueryClient();
  const q = useMyTasks();
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<PersonalTask | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-tasks'] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!title.trim()) return;
    try { await api('/my/tasks', { method: 'POST', json: { title } }); setTitle(''); await refresh(); } catch (x) { setErr((x as Error).message); }
  };
  // muda na tela na hora e confirma com o servidor em seguida
  const setStatus = async (t: PersonalTask, status: PersonalTask['status']) => {
    qc.setQueryData<PersonalTask[]>(['my-tasks'], (l) => l?.map((x) => (x.id === t.id ? { ...x, status, doneAt: status === 'FEITA' ? new Date().toISOString() : null } : x)));
    try { await api(`/my/tasks/${t.id}`, { method: 'PATCH', json: { status } }); } finally { await refresh(); }
  };
  const all = q.data ?? [];
  const todo = all.filter((t) => t.status === 'A_FAZER');
  const waiting = all.filter((t) => t.status === 'AGUARDANDO');
  const done = all.filter((t) => t.status === 'FEITA').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const row = (t: PersonalTask) => <TaskRow key={t.id} t={t} onStatus={(s) => setStatus(t, s)} onEdit={() => setEdit(t)} />;
  return (
    <>
      <Header title="Minhas tarefas" sub="Seu caderno de tarefas. Só você vê o que está aqui." />
      <div className="tasks-layout">
        <div>
          <form onSubmit={add} className="task-add">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Escreva uma tarefa e aperte Enter…" aria-label="Nova tarefa" maxLength={300}
              onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/\n/.test(t.trim())) { e.preventDefault(); setPaste(t); } }} />
            <button className="btn pri" type="submit" disabled={!title.trim()}>Anotar</button>
          </form>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setPaste('')}>Colar uma lista de tarefas</button>
          {err && <div className="err">{err}</div>}
          <Loading q={q} />
          {q.data && <>
            <h2>A fazer <span className="count-pill">{todo.length}</span></h2>
            <div className="panel tasklist">{todo.length ? todo.map(row) : <p className="note">Nada pendente. 🎉</p>}</div>
            {waiting.length > 0 && <>
              <h2>Aguardando <span className="count-pill">{waiting.length}</span></h2>
              <div className="panel tasklist">{waiting.map(row)}</div>
            </>}
            {done.length > 0 && <details className="done-box">
              <summary>Feitas nos últimos 30 dias ({done.length})</summary>
              <div className="panel tasklist">{done.map(row)}</div>
            </details>}
          </>}
        </div>
        <RoutinePanel />
      </div>
      {paste !== null && <PasteDialog initial={paste} onClose={() => setPaste(null)} onDone={refresh} />}
      {edit && <FormDialog title="Tarefa" onClose={() => setEdit(null)}
        extra={{ label: 'Excluir', run: async () => { if (confirm('Excluir esta tarefa?')) { await api(`/my/tasks/${edit.id}`, { method: 'DELETE' }); await refresh(); } } }}
        fields={[
          { name: 'title', label: 'Tarefa', value: edit.title, required: true },
          { name: 'details', label: 'Detalhe (opcional)', value: edit.details },
          { name: 'person', label: 'Com quem (opcional)', value: edit.person },
          { name: 'dueDate', label: 'Prazo (opcional)', type: 'date', value: edit.dueDate },
          { name: 'status', label: 'Situação', type: 'select', value: edit.status, options: [['A_FAZER', 'A fazer'], ['AGUARDANDO', 'Aguardando'], ['FEITA', 'Feita']] },
        ]}
        onSave={async (o) => {
          await api(`/my/tasks/${edit.id}`, { method: 'PATCH', json: { title: o.title, details: nn(o.details), person: nn(o.person), dueDate: nn(o.dueDate), status: o.status } });
          await refresh();
        }} />}
    </>
  );
}

function TaskRow({ t, onStatus, onEdit }: { t: PersonalTask; onStatus: (s: PersonalTask['status']) => void; onEdit: () => void }) {
  const done = t.status === 'FEITA';
  const due = dueInfo(t);
  return (
    <div className={'task' + (done ? ' done' : '')}>
      <input type="checkbox" checked={done} onChange={() => onStatus(done ? 'A_FAZER' : 'FEITA')} aria-label={done ? 'Desmarcar' : 'Marcar como feita'} />
      <div className="task-body" onClick={onEdit} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onEdit()}>
        <span className="task-title">{t.title}</span>
        {t.details && <span className="task-details">↳ {t.details}</span>}
        {(t.person || due) && <span className="task-meta">
          {t.person && <span className="chip">👤 {t.person}</span>}
          {due && <span className={'chip ' + due.cls}>{due.label}</span>}
        </span>}
      </div>
      {!done && <button className="btn sm" onClick={() => onStatus(t.status === 'AGUARDANDO' ? 'A_FAZER' : 'AGUARDANDO')}>{t.status === 'AGUARDANDO' ? 'Retomar' : 'Aguardar'}</button>}
    </div>
  );
}

function RoutinePanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-routine'], queryFn: () => api<Routine>('/my/routine') });
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-routine'] });
  const items = q.data?.items ?? [];
  const checked = items.filter((i) => i.checked).length;
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!title.trim()) return;
    await api('/my/routine', { method: 'POST', json: { title } }); setTitle(''); setEditing(true); await refresh();
  };
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Rotina de hoje {items.length > 0 && <span className="count-pill">{checked}/{items.length}</span>}</h2>
      <div className="panel">
        <p className="note" style={{ marginTop: 0 }}>O que você confere todo dia. Volta desmarcado a cada manhã.</p>
        <Loading q={q} />
        {items.map((i) => (
          <label key={i.id} className={'routine' + (i.checked ? ' done' : '')}>
            <input type="checkbox" checked={i.checked} onChange={async () => {
              qc.setQueryData<Routine>(['my-routine'], (r) => r && { ...r, items: r.items.map((x) => (x.id === i.id ? { ...x, checked: !i.checked } : x)) });
              try { await api(`/my/routine/${i.id}/check`, { method: 'PUT', json: { checked: !i.checked } }); } finally { await refresh(); }
            }} />
            <span>{i.title}</span>
            {editing && <button type="button" className="btn sm" onClick={async (e) => { e.preventDefault(); if (confirm(`Tirar "${i.title}" da rotina?`)) { await api(`/my/routine/${i.id}`, { method: 'DELETE' }); await refresh(); } }}>Tirar</button>}
          </label>
        ))}
        {q.data && !items.length && <p className="note">Ainda vazia. Sugestões: Conferir prazos · Conferir datas · Documentos · Atualizações.</p>}
        {(editing || !items.length) && <form onSubmit={add} className="task-add" style={{ marginTop: 10 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Novo item da rotina" aria-label="Novo item da rotina" maxLength={120} />
          <button className="btn" type="submit" disabled={!title.trim()}>Incluir</button>
        </form>}
        {items.length > 0 && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setEditing(!editing)}>{editing ? 'Pronto' : 'Editar rotina'}</button>}
      </div>
    </div>
  );
}

/** Colar várias tarefas de uma vez: uma por linha; "↳" = detalhe; "@Nome" = com quem; [aguardando]/[feita] = situação. */
function PasteDialog({ initial, onClose, onDone }: { initial: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initial);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const tasks = parseTaskList(text);
  const label = { A_FAZER: 'A fazer', AGUARDANDO: 'Aguardando', FEITA: 'Feita' } as const;
  const save = async () => {
    setBusy(true); setErr('');
    try { await api('/my/tasks/bulk', { method: 'POST', json: { tasks } }); await onDone(); onClose(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} onClose={onClose} className="paste-dialog">
      <h3>Colar lista de tarefas</h3>
      <p className="note" style={{ marginTop: 0 }}>Uma tarefa por linha. Linha começando com <b>↳</b> vira detalhe da tarefa de cima; <b>@Nome</b> no fim diz com quem; <b>[aguardando]</b> ou <b>[feita]</b> no começo muda a situação.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus aria-label="Lista de tarefas"
        placeholder={'Fazer ordem de compra\nVer com João sobre as mesas @João\n↳ manutenção nos calços\n[aguardando] Confraternização de final de ano @Diego'} />
      {tasks.length > 0 && <div className="paste-preview">
        <b>{tasks.length} tarefa{tasks.length > 1 ? 's' : ''}:</b>
        <ul>{tasks.map((t, i) => <li key={i}>{t.title}{t.details && <span className="task-details"> ↳ {t.details}</span>}
          {t.person && <span className="chip">👤 {t.person}</span>}{t.status !== 'A_FAZER' && <span className="chip">{label[t.status]}</span>}</li>)}</ul>
      </div>}
      {err && <div className="err">{err}</div>}
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn pri" disabled={busy || !tasks.length || tasks.length > 200} onClick={save}>{busy ? 'Adicionando…' : `Adicionar ${tasks.length || ''} tarefa${tasks.length === 1 ? '' : 's'}`}</button>
      </div>
    </dialog>
  );
}
