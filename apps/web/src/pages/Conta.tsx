/** Minha conta (troca de senha) e parâmetros das regras. */
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Header, Loading } from '../components/ui';

const ROLE: Record<string, string> = { ADMIN: 'Administrador', GESTOR: 'Gestor', MOTORISTA: 'Motorista', LEITOR: 'Leitura' };

export function MinhaConta() {
  const { me } = useAuth();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    if (!f.current || !f.next || !f.again) return setMsg({ ok: false, text: 'Preencha os três campos: senha atual, nova senha e a repetição da nova senha.' });
    if (f.next.length < 10) return setMsg({ ok: false, text: 'A nova senha precisa ter pelo menos 10 caracteres.' });
    if (f.next !== f.again) return setMsg({ ok: false, text: 'A confirmação não é igual à nova senha.' });
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', json: { current: f.current, next: f.next } });
      setF({ current: '', next: '', again: '' });
      setMsg({ ok: true, text: 'Senha alterada. Use a nova senha no próximo acesso.' });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Header title="Minha conta" sub={`${me?.user.name} · ${me?.user.email} · ${ROLE[me?.user.role ?? ''] ?? ''}`} />
      <div className="two">
        <form className="panel" onSubmit={submit} noValidate style={{ maxWidth: 460 }}>
          <h3 style={{ marginTop: 0 }}>Trocar senha</h3>
          <label className="fld"><span>Senha atual</span><input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} /></label>
          <label className="fld"><span>Nova senha (mínimo 10 caracteres)</span><input type="password" autoComplete="new-password" value={f.next} onChange={set('next')} /></label>
          <label className="fld"><span>Repita a nova senha</span><input type="password" autoComplete="new-password" value={f.again} onChange={set('again')} /></label>
          {msg && <div className={msg.ok ? 'banner' : 'err'} style={{ marginBottom: 12 }}>{msg.text}</div>}
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Salvando…' : 'Trocar senha'}</button>
          <p className="note">Dica: uma frase curta fácil de lembrar (ex.: "caminhonete azul na obra") é mais segura que uma senha curta com símbolos.</p>
        </form>
      </div>
    </>
  );
}

type Cfg = Record<string, number | string | string[]>;
/** Parâmetros editáveis, agrupados, com a explicação de cada um (ver packages/core/src/config.ts). */
const GROUPS: { title: string; items: [key: string, label: string, unit: string, step?: string][] }[] = [
  { title: 'Alertas', items: [
    ['kmAlert', 'Avisar manutenção quando faltar', 'km'],
    ['dayAlert', 'Avisar manutenção quando faltar', 'dias'],
    ['docDays', 'Avisar documentos e CNH com antecedência de', 'dias'],
    ['speed', 'Excesso de velocidade acima de', 'km/h'],
  ] },
  { title: 'Viagens e hodômetro', items: [
    ['tripH', 'Duração máxima aceitável de uma viagem', 'horas'],
    ['maxTrip', 'Distância máxima aceitável em uma viagem', 'km'],
    ['jump', 'Diferença máxima entre o km final de uma viagem e o inicial da próxima', 'km'],
    ['win', 'Tolerância do hodômetro em torno do km de referência do veículo', 'km'],
    ['paceDays', 'Período usado para calcular o uso médio por dia', 'dias'],
  ] },
  { title: 'Abastecimentos', items: [
    ['maxL', 'Litros máximos em um abastecimento', 'L', '0.1'],
    ['pMin', 'Preço por litro mínimo aceitável', 'R$', '0.01'],
    ['pMax', 'Preço por litro máximo aceitável', 'R$', '0.01'],
    ['kmlMin', 'Consumo mínimo aceitável', 'km/L', '0.1'],
    ['kmlMax', 'Consumo máximo aceitável', 'km/L', '0.1'],
  ] },
];

export function Parametros() {
  const { can } = useAuth(); const qc = useQueryClient();
  const admin = can('ADMIN');
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Cfg>('/settings') });
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (c: Cfg) => setV(Object.fromEntries(GROUPS.flatMap((g) => g.items.map(([k]) => [k, String(c[k] ?? '')]))));
  useEffect(() => { if (q.data) load(q.data); }, [q.data]);
  const changed = q.data ? GROUPS.flatMap((g) => g.items.map(([k]) => k)).filter((k) => v[k] !== undefined && Number(v[k]) !== Number(q.data![k])) : [];
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    const body: Record<string, number> = {};
    for (const k of changed) {
      const n = Number(v[k].replace(',', '.'));
      if (v[k].trim() === '' || !Number.isFinite(n) || n < 0) return setMsg({ ok: false, text: 'Preencha todos os campos com números positivos.' });
      body[k] = n;
    }
    setBusy(true);
    try {
      await api('/settings', { method: 'PUT', json: body });
      await qc.invalidateQueries(); // os alertas e verificações dependem dos parâmetros
      setMsg({ ok: true, text: 'Parâmetros salvos. Painel, alertas e verificações já usam os novos valores.' });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); } finally { setBusy(false); }
  };
  return (
    <>
      <Header title="Parâmetros" sub={admin ? 'Limites usados nos alertas e nas verificações dos registros. Alterações ficam registradas na auditoria.' : 'Limites usados nos alertas e nas verificações dos registros. Só o administrador altera.'} />
      <Loading q={q} />
      {q.data && <form onSubmit={save} noValidate>
        <div className="two">
          {GROUPS.map((g) => <div className="panel" key={g.title}>
            <h3 style={{ marginTop: 0 }}>{g.title}</h3>
            {g.items.map(([k, label, unit, step]) => <label className="fld" key={k}><span>{label} ({unit})</span>
              <input type="number" min={0} step={step ?? '1'} required disabled={!admin} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>)}
          </div>)}
        </div>
        {msg && <div className={msg.ok ? 'banner' : 'err'} style={{ marginTop: 14 }}>{msg.text}</div>}
        {admin && <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="submit" className="btn pri" disabled={busy || !changed.length}>{busy ? 'Salvando…' : 'Salvar parâmetros'}</button>
          <button type="button" className="btn" disabled={busy || !changed.length} onClick={() => { load(q.data!); setMsg(null); }}>Desfazer alterações</button>
        </div>}
      </form>}
    </>
  );
}
