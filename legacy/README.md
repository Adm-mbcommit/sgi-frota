# Legado

- `sgi-frota-artefato-original.html` — o artefato "SGI Frota Matias" como estava publicado em 12/11/2026
  (página única com dados embutidos, leitura ao vivo do Google Drive e gravações no banco do artefato).
- `snapshot.json` — os dados embutidos no artefato (snapshot de 11/11/2026 10:49): viagens, abastecimentos,
  checklists, eventos do Chronos, plano de manutenção, documentos, custos, pendências e motoristas.
  O banco do artefato (manutenções registradas, CNH, documentos, custos, pendências) estava vazio na exportação.

O seed (`npm run db:seed`) carrega este snapshot no banco. Depois da carga, estes arquivos servem só de referência
e para o teste de paridade.
