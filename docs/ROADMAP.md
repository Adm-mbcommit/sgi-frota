# Roadmap

O sistema passou a se chamar **SGI Matias Brasil**, com um módulo por setor. Frota é o primeiro.

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
      a cada hora (Importações → Sincronização automática). Ver ARQUITETURA.md.
- [ ] Importação do Chronos pela API do rastreador, se disponível
- [ ] Reprocessar registros quando um apelido de placa/motorista for cadastrado

## Fora dos planos
- App do motorista no celular: **não será feito** (decisão do usuário). Os motoristas continuam usando o
  formulário do Comando de Bordo, que chega ao SGI pela sincronização automática.

## Fase 4 — Gestão
- [x] Custos da frota importados do Mais Controle (relatório Pagamentos)
- [ ] Integração automática com o Mais Controle (se tiverem API)
- [x] Alertas das próximas revisões na tela de Manutenção, no Calendário (🔧) e no Início
- [ ] Alertas por e-mail/WhatsApp (manutenção, documentos, CNH, excesso de velocidade)
- [x] Links dos PDFs dos documentos (CRLV 2026 dos 4 veículos já ligados ao Google Drive)
- [ ] Anexos (NF, CRLV, apólice) guardados no próprio SGI (hoje ficam no Drive)
- [ ] Relatórios em PDF/Excel por período, veículo e motorista
- [ ] Recuperação de senha por e-mail; autenticação em dois fatores para administradores

## Outros setores (módulos do SGI Matias Brasil)
- [x] Nome SGI Matias Brasil, tela de Início com os setores e Frota como setor (telas em `/frota/...`)
- [x] RH aparece como "em breve"
- [x] Minhas tarefas (fora dos setores): caderno pessoal com Em andamento / A fazer / Aguardando / Feitas, pesquisa, pessoa, prazo e rotina diária; colar uma lista inteira de uma vez
- [x] Calendário (fora dos setores): feriados nacionais calculados, aniversários da equipe (importa .xlsx), compromissos (clicar no dia; pessoais ou da equipe) e lembretes no Início
- [x] Administrativo: Certidões (CNDs) da Matias 26 e da Matias 44, com quadro, alertas antes de vencer (menu, Início) e links dos PDFs no Drive
- [x] Administrativo: leitura automática das CNDs na pasta do Drive (Apps Script diário, chave própria)
- [ ] Administrativo: alerta das CNDs por e-mail; outros controles do setor (levantar com o usuário)
- [ ] RH: levantar com o usuário o que o setor precisa
- [ ] Permissões por módulo (quem vê cada setor)
