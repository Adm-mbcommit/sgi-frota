/**
 * Administrativo → Certidões (CNDs): o que renovar agora, um cartão por empresa e a leitura automática do Drive.
 * A antecedência do alerta é de cada tipo (FGTS 7 dias, Municipal 10, Falência 15, demais 30) e pode ser
 * ajustada em cada certidão. Os PDFs ficam no Google Drive (pasta DOCUMENTOS P/ LICITAÇÕES).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUrl } from '../lib/api';
import { fd, fdt } from '../lib/format';
import { certSyncScript } from '../lib/cert-sync-script';
import { useAuth, WRITE } from '../lib/auth';
import type { Certificate, CertificatesBoard, Company } from '../lib/types';
import { Chip, FormDialog, Header, Loading, nn, num } from '../components/ui';

export const useCertificates = () => {
  const { can } = useAuth();
  return useQuery({ queryKey: ['certificates'], queryFn: () => api<CertificatesBoard>('/certificates'), enabled: !can('MOTORISTA'), staleTime: 5 * 60_000 });
};

type Row = Certificate & { company: Company };
const rowsOf = (b: CertificatesBoard): Row[] => b.companies.filter((c) => c.active).flatMap((c) => c.certificates.map((x) => ({ ...x, company: c })));

/** Certidões vencidas ou dentro da antecedência de alerta (a mais urgente primeiro). */
export const certAlerts = (b?: CertificatesBoard) =>
  b ? rowsOf(b).filter((r) => r.status === 'VENCIDO' || r.status === 'ATENCAO').sort((a, b) => (a.days ?? 0) - (b.days ?? 0)) : [];

const daysText = (r: Certificate) =>
  r.days == null ? 'sem vencimento' : r.days < 0 ? `vencida há ${-r.days} dia${r.days === -1 ? '' : 's'}` : r.days === 0 ? 'vence hoje' : `vence em ${r.days} dia${r.days === 1 ? '' : 's'}`;
const chipLabel = (r: Certificate) => (r.status === 'VENCIDO' ? 'Vencida' : r.status === 'ATENCAO' ? (r.days === 0 ? 'Vence hoje' : `${r.days} dia${r.days === 1 ? '' : 's'}`) : r.status === 'OK' ? 'Válida' : 'Sem dado');

const shortDate = (iso: string) => fd(iso).slice(0, 5);
/** Frase da situação: "vence em 3 dias (22/11)", "venceu em 08/11 (há 11 dias)". */
const situation = (r: Certificate) =>
  !r.expiresOn || r.days == null ? 'sem data de validade'
    : r.days < 0 ? `venceu em ${shortDate(r.expiresOn)} (há ${-r.days} dia${r.days === -1 ? '' : 's'})`
    : r.days === 0 ? 'vence hoje' : `vence em ${r.days} dia${r.days === 1 ? '' : 's'} (${shortDate(r.expiresOn)})`;

export default function Certidoes() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useCertificates();
  const [edit, setEdit] = useState<Row | null>(null);
  const [co, setCo] = useState<Partial<Company> | null>(null);
  const b = q.data;
  const rows = b ? rowsOf(b) : [];
  const alerts = certAlerts(b);
  const next = rows.filter((r) => r.status === 'OK' && r.expiresOn).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!))[0];
  const info = (kind: string) => b?.kinds.find((k) => k.kind === kind);
  const write = can(...WRITE);
  return (
    <>
      <Header title="Certidões (CNDs)" sub="Validade das certidões negativas de cada empresa. O sistema avisa antes de vencer."
        actions={write && <button className="btn" onClick={() => setCo({})}>Nova empresa</button>} />
      <Loading q={q} />
      {b && <>
        {alerts.length > 0
          ? <section className="panel cnd-todo">
              <h3>Renovar agora <span className="cnd-count">{alerts.length}</span></h3>
              {alerts.map((r) => (
                <div key={r.company.id + r.kind} className={'cnd-todo-row ' + (r.status === 'VENCIDO' ? 'bad' : 'warn')}>
                  <span className="cnd-dot" aria-hidden />
                  <span className="cnd-todo-what"><b>{r.company.shortName}</b> · {r.label}</span>
                  <span className="cnd-todo-when">{situation(r)}</span>
                  <span className="cnd-todo-act">
                    <span className="note">{info(r.kind)?.issuer}</span>
                    {write && <button className="btn sm pri" onClick={() => setEdit(r)}>Atualizar</button>}
                  </span>
                </div>
              ))}
            </section>
          : <section className="panel cnd-ok">✅ <b>Tudo em dia.</b>{next && <> Próxima a vencer: {next.company.shortName} · {next.label}, em {fd(next.expiresOn)}.</>}</section>}

        <div className="cnd-cos">
          {b.companies.filter((c) => c.active).map((c) => (
            <article key={c.id} className="panel cnd-co">
              <header>
                <div><h3>{c.shortName}</h3><small>{c.name} · {c.cnpj}</small></div>
                <div className="cnd-co-act">
                  {c.driveFolder && <a className="btn sm" href={c.driveFolder} target="_blank" rel="noopener noreferrer" title="Abrir a pasta da empresa no Google Drive">📁 Pasta no Drive</a>}
                  {write && <button className="btn sm" onClick={() => setCo(c)} title="Editar dados da empresa">Editar</button>}
                </div>
              </header>
              <ul className="cnd-list">
                {c.certificates.map((x) => (
                  <li key={x.kind}>
                    <span className="cnd-kind" title={info(x.kind)?.issuer}>{x.label}</span>
                    <span className="cnd-date">{x.expiresOn ? fd(x.expiresOn) : '—'}{x.expiryEstimated && <small title={`Sem validade impressa: ${info(x.kind)?.validityDays} dias da emissão`}> estimado</small>}</span>
                    <Chip s={x.status} label={chipLabel(x)} />
                    <span className="cnd-act">
                      {x.link ? <a className="cnd-icon" href={x.link} target="_blank" rel="noopener noreferrer" title="Abrir o PDF">📄</a> : <span className="cnd-icon off" />}
                      {write && <button className="cnd-icon" onClick={() => setEdit({ ...x, company: c })} title="Atualizar esta certidão" aria-label={`Atualizar ${x.label}`}>✏️</button>}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        {can('ADMIN') && <DriveSyncPanel />}
      </>}

      {edit && <FormDialog title={`${edit.company.shortName}: certidão ${edit.label}`} onClose={() => setEdit(null)} fields={[
        { name: 'i', label: `Renovou? Baixe a nova certidão (${info(edit.kind)?.issuer}), salve o PDF na pasta da empresa no Drive e informe aqui as datas e o link.`, type: 'info' },
        { name: 'issuedOn', label: 'Data de emissão', type: 'date', value: edit.issuedOn },
        { name: 'expiresOn', label: `Válida até (vazio = ${info(edit.kind)?.validityDays} dias da emissão)`, type: 'date', value: edit.expiryEstimated ? '' : edit.expiresOn },
        { name: 'alertDays', label: `Avisar quantos dias antes (padrão: ${info(edit.kind)?.alertDays})`, type: 'number', value: edit.customAlert ? edit.alertDays : '' },
        { name: 'link', label: 'Link do PDF no Google Drive (abra o arquivo → ⋮ → Compartilhar → Copiar link)', value: edit.link },
        { name: 'notes', label: 'Observação', value: edit.notes },
      ]} onSave={async (o) => {
        await api('/certificates', { method: 'PUT', json: { companyId: edit.company.id, kind: edit.kind, issuedOn: nn(o.issuedOn), expiresOn: nn(o.expiresOn), alertDays: num(o.alertDays), link: nn(String(o.link).trim()), notes: nn(o.notes) } });
        await qc.invalidateQueries({ queryKey: ['certificates'] });
      }} />}

      {co && <FormDialog title={co.id ? `Empresa: ${co.shortName}` : 'Nova empresa'} onClose={() => setCo(null)} fields={[
        { name: 'shortName', label: 'Apelido (como na pasta do Drive, ex.: Matias 26)', value: co.shortName, required: true },
        { name: 'name', label: 'Razão social', value: co.name, required: true },
        { name: 'cnpj', label: 'CNPJ', value: co.cnpj, required: true },
        { name: 'driveFolder', label: 'Link da pasta no Google Drive', value: co.driveFolder },
        { name: 'active', label: 'Ativa (aparece no quadro e nos alertas)', type: 'check', value: co.active ?? true },
      ]} onSave={async (o) => {
        const body = { shortName: o.shortName, name: o.name, cnpj: o.cnpj, driveFolder: nn(String(o.driveFolder).trim()), active: o.active };
        await api(co.id ? `/companies/${co.id}` : '/companies', { method: co.id ? 'PATCH' : 'POST', json: body });
        await qc.invalidateQueries({ queryKey: ['certificates'] });
      }} />}
    </>
  );
}

/** Leitura automática das pastas do Drive (Apps Script + chave), só para o administrador. */
function DriveSyncPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cert-sync'], queryFn: () => api<{ configured: boolean; lastCheckAt: string | null; lastUpdateAt: string | null }>('/certificates/sync'), refetchInterval: 60_000 });
  const [script, setScript] = useState(''); const [copied, setCopied] = useState(false); const [open, setOpen] = useState(false);
  const d = q.data;
  const generate = async () => {
    if (d?.configured && !confirm('Gerar uma nova chave desliga o script atual até você colar o novo. Continuar?')) return;
    const { token } = await api<{ token: string }>('/certificates/sync/token', { method: 'POST' });
    setScript(certSyncScript(apiUrl('/certificates/sync'), token)); setCopied(false); setOpen(true);
    await qc.invalidateQueries({ queryKey: ['cert-sync'] });
  };
  const disable = async () => {
    if (!confirm('Desligar a leitura automática do Drive?')) return;
    await api('/certificates/sync/token', { method: 'DELETE' }); setScript(''); await qc.invalidateQueries({ queryKey: ['cert-sync'] });
  };
  const copy = async () => { try { await navigator.clipboard.writeText(script); setCopied(true); } catch { setCopied(false); } };
  const status = d?.configured
    ? <><span className="chip ok">Ligada</span> <span className="note">última leitura {d.lastCheckAt ? fdt(d.lastCheckAt) : 'ainda nenhuma'}</span></>
    : <span className="chip">Desligada</span>;
  return (
    <details className="panel cnd-sync" open={!d?.configured || !!script}>
      <summary><b>Leitura automática do Google Drive</b> {d && status}</summary>
      <p className="note">Todo dia às 7h o SGI lê a pasta de cada empresa. Salvou uma CND nova com o nome no padrão <b>CND FGTS - VAL 22.11.26.pdf</b>?
        A validade e o link se atualizam sozinhos. A certidão de falência pode ficar sem data no nome: o SGI lê a data dentro do PDF.
        Um arquivo mais antigo nunca substitui uma certidão mais nova.</p>
      {d?.configured && <p className="note">Última certidão atualizada pela leitura: {d.lastUpdateAt ? fdt(d.lastUpdateAt) : 'ainda nenhuma'}.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn pri" onClick={generate}>{d?.configured ? 'Gerar nova chave e script' : 'Ligar: gerar chave e script'}</button>
        {d?.configured && <button className="btn" onClick={disable}>Desligar</button>}
      </div>
      {script && open && <>
        <ol className="note" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <li>Clique em <b>Copiar script</b> (abaixo).</li>
          <li>Abra <b>script.google.com</b> com uma conta Google que enxergue as pastas das empresas no Drive.</li>
          <li>Clique em <b>Novo projeto</b> e dê o nome <b>SGI Certidões</b> (clique em "Projeto sem título", no alto).</li>
          <li>Apague o texto de exemplo, cole o script e clique no ícone de <b>Salvar</b> (disquete).</li>
          <li>Na barra de cima, escolha a função <b>instalarCertidoesSGI</b> e clique em <b>Executar</b>.</li>
          <li>O Google vai pedir permissão: escolha sua conta → <b>Avançado</b> → <b>Acessar (não seguro)</b> → <b>Permitir</b>. (O aviso aparece porque o script é seu, não publicado.)</li>
          <li>Pronto. Volte aqui e recarregue a página: a "Última leitura" deve mostrar o horário de agora.</li>
        </ol>
        <p className="banner">Esta chave aparece só agora. Não a compartilhe.</p>
        <button className="btn pri" onClick={copy}>{copied ? 'Copiado!' : 'Copiar script'}</button>
        <textarea readOnly value={script} rows={10} style={{ width: '100%', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} onFocus={(e) => e.target.select()} />
      </>}
    </details>
  );
}

/** Aviso no Início: certidões vencidas ou perto de vencer. */
export function CertificatesSummary() {
  const q = useCertificates();
  const alerts = certAlerts(q.data);
  if (!alerts.length) return null;
  const late = alerts.filter((r) => r.status === 'VENCIDO');
  const soon = alerts.filter((r) => r.status === 'ATENCAO');
  const desc = (r: Row) => `${r.company.shortName} ${r.label}${r.status === 'ATENCAO' ? ` (${daysText(r).replace('vence ', '')})` : ''}`;
  return (
    <div className={'banner cal-banner' + (late.length ? ' bad-banner' : '')}>
      <span>📑 <b>Certidões:</b> {[late.length && `${late.length} vencida(s): ${late.map(desc).join(', ')}`, soon.length && `${soon.length} vencendo: ${soon.map(desc).join(', ')}`].filter(Boolean).join(' · ')}</span>
      <Link className="btn sm" to="/administrativo">Ver certidões</Link>
    </div>
  );
}
