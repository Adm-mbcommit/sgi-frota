# Roadmap

## Fase 1 — Base (esta entrega)
- [x] Regras do artefato portadas para `@sgi/core`, com teste de paridade
- [x] Banco PostgreSQL com histórico, auditoria e multiempresa
- [x] API com login, perfis e todas as telas do artefato
- [x] Importação das planilhas do Comando de Bordo e do Chronos
- [x] Implantação na Vercel (front + API serverless + Neon) e alternativa com Docker

## Fase 2 — Colocar no ar
- [ ] Criar o projeto na Vercel, conectar o Neon e publicar (docs/DEPLOY.md)
- [ ] Criar usuários dos gestores; trocar a senha do admin
- [ ] Resolver as pendências herdadas (datas reais dos documentos, CNH, revisão da Saveiro 55…)
- [x] Tela de parâmetros (Gestão → Parâmetros; só o ADMIN altera) e de troca de senha (Minha conta)

## Fase 3 — Automação dos dados
- [x] Sincronização automática com a planilha do Google Drive: um Apps Script na planilha envia o .xlsx ao SGI
      a cada 10 min (Importações → Sincronização automática). Ver ARQUITETURA.md.
- [ ] Importação do Chronos pela API do rastreador, se disponível
- [ ] Reprocessar registros quando um apelido de placa/motorista for cadastrado

## Fora dos planos
- App do motorista no celular: **não será feito** (decisão do usuário). Os motoristas continuam usando o
  formulário do Comando de Bordo, que chega ao SGI pela sincronização automática.

## Fase 4 — Gestão
- [ ] Alertas por e-mail/WhatsApp (manutenção, documentos, CNH, excesso de velocidade)
- [ ] Anexos (NF, CRLV, apólice) em armazenamento de objetos
- [ ] Relatórios em PDF/Excel por período, veículo e motorista
- [ ] Recuperação de senha por e-mail; autenticação em dois fatores para administradores
