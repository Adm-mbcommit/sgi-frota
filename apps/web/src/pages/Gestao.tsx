/** Custos, pendências, importações e usuários. */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, upload } from '../lib/api';
import { fd, fdt, nf, rs, todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import type { Cost, PlanItem, Task, User, Vehicle } from '../lib/types';
import { Chip, DataTable, FormDialog, Header, Loading, nn, num } from '../components/ui';

export function Custos() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['costs'], queryFn: () => api<Cost[]>('/costs') });
  const vs = useQuery({ queryKey: ['vehicles'], queryFn: () => api<Vehicle[]>('/vehicles') });
  const cats = useQuery({ queryKey: ['cost-cats'], queryFn: () => api<string[]>('/costs/categories') });
  const [edit, setEdit] = useState<Partial<Cost> | null>(null);
  return (
    <>
      <Header title="Custos" sub="Custos além do combustível (o combustível vem dos abastecimentos). Numa revisão ou manutenção, marque os itens feitos: o prazo deles recomeça na tela Manutenção." />
      <Loading q={q} />
      {q.data && <DataTable rows={q.data} filter={{ label: 'Todas as categorias', v: (r) => r.category }}
        extra={can(...WRITE) && <button className="btn" onClick={() => setEdit({ date: todayIso(), category: 'Manutenção' })}>Novo custo</button>} cols={[
          { h: 'Data', v: (r) => r.date, f: (r) => fd(r.date) }, { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Categoria', v: (r) => r.category },
          { h: 'Descrição', v: (r) => r.description }, { h: 'Fornecedor', v: (r) => r.supplier },
          { h: 'Valor', v: (r) => r.amount, f: (r) => (r.amount == null ? <span className="chip conf">preencher</span> : rs(r.amount)), n: true },
          { h: 'NF / observação', v: (r) => [r.invoice, r.notes].filter(Boolean).join(' · '), w: true },
          { h: 'Itens do plano', v: (r) => r.maintenance?.items.join(', ') ?? '', f: (r) => r.maintenance ? <span title={r.maintenance.items.join(', ')}>{r.maintenance.items.length} {r.maintenance.items.length === 1 ? 'item' : 'itens'} · {nf(r.maintenance.km)} km</span> : null },
          { h: '', v: () => '', f: (r) => can(...WRITE) && <button className="btn sm" onClick={() => setEdit(r)}>Editar</button> },
        ]} />}
      {edit && <CostDialog cost={edit} vehicles={vs.data ?? []} categories={cats.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

const MAINT_CATS = ['Manutenção', 'Pneus'];

/**
 * Formulário de custo. Em Manutenção/Pneus mostra os itens do plano do veículo:
 * os marcados entram no histórico e o prazo deles recomeça (a revisão marca "Revisão geral" sozinha).
 */
function CostDialog({ cost, vehicles, categories, onClose }: { cost: Partial<Cost>; vehicles: Vehicle[]; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient(); const ref = useRef<HTMLDialogElement>(null);
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanItem[]>('/maintenance/plan') });
  const [vehicleId, setVehicleId] = useState(cost.vehicleId ?? '');
  const [category, setCategory] = useState(cost.category ?? 'Manutenção');
  const [checked, setChecked] = useState<string[]>(cost.maintenance?.planItemIds ?? []);
  const [touched, setTouched] = useState(!!cost.maintenance);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const items = (plan.data ?? []).filter((p) => p.vehicleId === vehicleId);
  const showItems = MAINT_CATS.includes(category) && !!vehicleId;
  const toggle = (id: string) => { setTouched(true); setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])); };
  /** Sugestão: descrição com "revisão" marca o item Revisão geral (só enquanto o usuário não mexeu nos itens). */
  const suggest = (desc: string) => {
    if (touched || !/revis/i.test(desc)) return;
    const rg = items.find((p) => /revis[aã]o geral/i.test(p.item));
    if (rg) setChecked([rg.id]);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); await qc.invalidateQueries(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} onClose={onClose} className="wide">
      <form onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget); const g = (k: string) => String(f.get(k) ?? '');
        const ids = showItems ? checked.filter((id) => items.some((p) => p.id === id)) : [];
        const body = { date: g('date'), vehicleId: nn(vehicleId), category, description: g('description'), supplier: nn(g('supplier')), amount: num(g('amount')), invoice: nn(g('invoice')), notes: nn(g('notes')),
          ...(showItems || cost.maintenance ? { maintenance: { km: num(g('km')), planItemIds: ids } } : {}) };
        run(() => api(cost.id ? `/costs/${cost.id}` : '/costs', { method: cost.id ? 'PATCH' : 'POST', json: body }));
      }}>
        <h3>{cost.id ? 'Editar custo' : 'Novo custo'}</h3>
        <label className="fld"><span>Data</span><input name="date" type="date" required defaultValue={cost.date} /></label>
        <label className="fld"><span>Veículo</span><select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setChecked([]); setTouched(false); }}>
          <option value="">(sem veículo)</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="fld"><span>Categoria</span><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="fld"><span>Descrição</span><input name="description" required defaultValue={cost.description} onChange={(e) => suggest(e.target.value)} /></label>
        <label className="fld"><span>Fornecedor</span><input name="supplier" defaultValue={cost.supplier ?? ''} /></label>
        <label className="fld"><span>Valor (R$)</span><input name="amount" type="number" step="0.01" defaultValue={cost.amount ?? ''} /></label>
        <label className="fld"><span>Nota fiscal</span><input name="invoice" defaultValue={cost.invoice ?? ''} /></label>
        <label className="fld"><span>Observação</span><input name="notes" defaultValue={cost.notes ?? ''} /></label>
        {showItems && <fieldset className="plan-items">
          <legend>Itens do plano feitos neste serviço</legend>
          <p className="note" style={{ marginTop: 0 }}>Os itens marcados recomeçam a contar na tela Manutenção. Deixe tudo desmarcado se o serviço não faz parte do plano (ex.: troca de bateria).</p>
          <label className="fld"><span>Km do veículo no serviço{checked.length ? ' (obrigatório)' : ''}</span><input name="km" type="number" step="1" required={checked.length > 0} defaultValue={cost.maintenance?.km ?? ''} /></label>
          {plan.isLoading ? <p className="note">Carregando itens…</p> : items.length === 0 ? <p className="note">Este veículo não tem itens no plano.</p> :
            <div className="checks">{items.map((p) => <label key={p.id} className="fld chk"><input type="checkbox" checked={checked.includes(p.id)} onChange={() => toggle(p.id)} /> {p.item}</label>)}</div>}
        </fieldset>}
        {err && <div className="err">{err}</div>}
        <div className="act">
          {cost.id && <button type="button" className="btn" disabled={busy} onClick={() => { if (confirm('Excluir este custo? Os itens do plano ligados a ele saem do histórico.')) run(() => api(`/costs/${cost.id}`, { method: 'DELETE' })); }}>Excluir</button>}
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </dialog>
  );
}

export function Pendencias() {
  const { can } = useAuth(); const qc = useQueryClient();
  const t = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const ql = useQuery({ queryKey: ['quality'], queryFn: () => api<{ label: string; count: number; level: number }[]>('/quality') });
  const [add, setAdd] = useState(false);
  const toggle = async (x: Task) => { await api(`/tasks/${x.id}`, { method: 'PATCH', json: { status: x.status === 'RESOLVIDO' ? 'ABERTO' : 'RESOLVIDO' } }); await qc.invalidateQueries(); };
  return (
    <>
      <Header title="Pendências e qualidade dos dados" sub="Itens que precisam de confirmação e verificações automáticas dos registros."
        actions={can(...WRITE) && <button className="btn" onClick={() => setAdd(true)}>Nova pendência</button>} />
      <div className="two">
        <div><h2>Para confirmar</h2><div className="panel todo"><Loading q={t} />
          {t.data?.map((x) => <div key={x.id}><Chip s={x.status} /><span><b>{x.title}</b> {x.status !== 'SUGESTAO' && can(...WRITE) && <button className="btn sm" onClick={() => toggle(x)}>{x.status === 'RESOLVIDO' ? 'Reabrir' : 'Marcar resolvido'}</button>}</span><p>{x.description}</p></div>)}
        </div></div>
        <div><h2>Verificações dos dados</h2><div className="tw"><table><tbody>
          {ql.data?.map((r) => <tr key={r.label}><td style={{ paddingLeft: r.level ? 26 : 10 }}>{r.label}</td><td className="n">{nf(r.count)}</td></tr>)}
        </tbody></table></div></div>
      </div>
      {add && <FormDialog title="Nova pendência" onClose={() => setAdd(false)} fields={[{ name: 'title', label: 'Título', required: true }, { name: 'description', label: 'O que fazer' }]}
        onSave={async (o) => { await api('/tasks', { method: 'POST', json: { title: o.title, description: nn(o.description) } }); await qc.invalidateQueries(); }} />}
    </>
  );
}

export function Importacoes() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['imports'], queryFn: () => api<{ id: string; kind: string; fileName: string; stats: Record<string, unknown>; at: string }[]>('/imports') });
  const [msg, setMsg] = useState('');
  const send = async (path: string, f?: File) => {
    if (!f) return; setMsg('Importando ' + f.name + '…');
    try { const r = await upload(path, f); setMsg('Importado: ' + Object.entries(r).filter(([k]) => k !== 'id').map(([k, v]) => `${k} ${v}`).join(', ')); await qc.invalidateQueries(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <Header title="Importações" sub="Atualize os registros a partir das planilhas. Reimportar a mesma planilha não duplica linhas: viagens encerradas depois são atualizadas." />
      {can(...WRITE) && <div className="two">
        <div className="panel"><h3 style={{ marginTop: 0 }}>Comando de Bordo</h3><p className="note">Baixe a planilha do Google Drive como .xlsx (abas Registros, Abastecimentos, manutencao_diaria e Manutencao). A aba Manutencao atualiza o plano só quando traz um serviço mais recente.</p>
          <div className="drop"><label className="btn pri" htmlFor="cb">Escolher arquivo</label><input id="cb" type="file" accept=".xlsx" hidden onChange={(e) => send('/imports/comando-bordo', e.target.files?.[0])} /></div></div>
        <div className="panel"><h3 style={{ marginTop: 0 }}>Chronos (rastreador)</h3><p className="note">Exporte o relatório "Períodos de utilização (BDV)" em .xlsx.</p>
          <div className="drop"><label className="btn pri" htmlFor="ch">Escolher arquivo</label><input id="ch" type="file" accept=".xlsx" hidden onChange={(e) => send('/imports/chronos', e.target.files?.[0])} /></div></div>
      </div>}
      {msg && <div className="banner" style={{ marginTop: 14 }}>{msg}</div>}
      <h2>Histórico</h2>
      <Loading q={q} />
      {q.data && <DataTable rows={q.data} cols={[
        { h: 'Quando', v: (r) => r.at, f: (r) => fdt(r.at) }, { h: 'Tipo', v: (r) => r.kind }, { h: 'Arquivo', v: (r) => r.fileName },
        { h: 'Resultado', v: (r) => JSON.stringify(r.stats ?? {}), f: (r) => Object.entries(r.stats ?? {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '), w: true },
      ]} />}
    </>
  );
}

const ROLES: [string, string][] = [['LEITOR', 'Leitura'], ['MOTORISTA', 'Motorista'], ['GESTOR', 'Gestor'], ['ADMIN', 'Administrador']];
export function Usuarios() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  return (
    <>
      <Header title="Usuários" sub="Quem acessa o sistema e com qual perfil. Gestor altera cadastros e registros; Leitura só consulta." actions={<button className="btn" onClick={() => setEdit({ role: 'LEITOR', active: true })}>Novo usuário</button>} />
      <Loading q={q} />
      {q.data && <DataTable rows={q.data} cols={[
        { h: 'Nome', v: (r) => r.name }, { h: 'E-mail', v: (r) => r.email }, { h: 'Perfil', v: (r) => ROLES.find((x) => x[0] === r.role)?.[1] },
        { h: 'Situação', v: (r) => r.active, f: (r) => <span className={'chip ' + (r.active ? 'ok' : '')}>{r.active ? 'Ativo' : 'Bloqueado'}</span> },
        { h: 'Último acesso', v: (r) => r.lastLoginAt, f: (r) => fdt(r.lastLoginAt) },
        { h: '', v: () => '', f: (r) => <button className="btn sm" onClick={() => setEdit(r)}>Editar</button> },
      ]} />}
      {edit && <FormDialog title={edit.id ? 'Editar usuário' : 'Novo usuário'} onClose={() => setEdit(null)} fields={[
        { name: 'name', label: 'Nome', value: edit.name, required: true },
        ...(edit.id ? [] : [{ name: 'email', label: 'E-mail', value: edit.email, required: true }]),
        { name: 'role', label: 'Perfil', type: 'select', value: edit.role, options: ROLES },
        { name: 'password', label: edit.id ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial (mín. 10 caracteres)', type: 'text', required: !edit.id },
        ...(edit.id ? [{ name: 'active', label: 'Acesso ativo', type: 'check' as const, value: edit.active }] : []),
      ]} onSave={async (o) => {
        if (edit.id) await api(`/users/${edit.id}`, { method: 'PATCH', json: { name: o.name, role: o.role, active: o.active, ...(o.password ? { password: o.password } : {}) } });
        else await api('/users', { method: 'POST', json: { name: o.name, email: o.email, role: o.role, password: o.password } });
        await qc.invalidateQueries();
      }} />}
    </>
  );
}
