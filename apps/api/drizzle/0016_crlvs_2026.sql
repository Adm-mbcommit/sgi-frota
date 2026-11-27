-- CRLVs do exercício 2026 (PDFs na pasta dos CRLVs no Google Drive, lidos em 27/11/2026).
-- O CRLV não traz data de vencimento impressa: vale até o prazo do licenciamento 2027.
-- Em SC o prazo segue o final da placa: IPVA (cota única) no fim do mês do final da placa
-- e licenciamento dois meses depois (final 1 = 31/03, final 2 = 30/04, final 5 = 31/07).
-- O calendário oficial de 2027 ainda não saiu: ficam "a confirmar" até o Detran-SC publicar.
-- As datas antigas "a confirmar" eram estimativas do artefato e são trocadas; se já estiverem conferidas,
-- só troca por uma data mais tarde (não desfaz o que foi informado na tela).
INSERT INTO "vehicle_documents" ("organization_id", "vehicle_id", "crlv", "ipva", "licensing", "links")
SELECT v."organization_id", v."id", x.lic::date, x.ipva::date, x.lic::date,
       jsonb_build_object('crlv', 'https://drive.google.com/file/d/' || x.file || '/view')
FROM "vehicles" v
JOIN (VALUES
  ('QXI9C75', '2027-05-31', '2027-07-31', '1UI7d2QGYA2YfMOv9g6XDs7yssCB4ff5B'),
  ('TPR0F55', '2027-05-31', '2027-07-31', '19wXMrksRoZzO6zhzNVTFn1ANFTn23nnw'),
  ('TPX8A21', '2027-01-31', '2027-03-31', '1styTtgutR3WsS75Gf_A_0W1UcSnQQDaS'),
  ('MFS7D92', '2027-02-28', '2027-04-30', '1hcYaWr9dcI3LxomZppDK_gO7gV0mrx4c'),
  ('TPQ6B05', '2027-05-31', '2027-07-31', '1RdiKWg_sSKjEAW_-VAHopXdt9SZjwK1h')
) AS x(plate, ipva, lic, file) ON x.plate = v."plate"
ON CONFLICT ("vehicle_id") DO UPDATE SET
  "crlv" = CASE WHEN "vehicle_documents"."confirmed" THEN GREATEST("vehicle_documents"."crlv", EXCLUDED."crlv") ELSE EXCLUDED."crlv" END,
  "ipva" = CASE WHEN "vehicle_documents"."confirmed" THEN GREATEST("vehicle_documents"."ipva", EXCLUDED."ipva") ELSE EXCLUDED."ipva" END,
  "licensing" = CASE WHEN "vehicle_documents"."confirmed" THEN GREATEST("vehicle_documents"."licensing", EXCLUDED."licensing") ELSE EXCLUDED."licensing" END,
  "links" = "vehicle_documents"."links" || EXCLUDED."links",
  "updated_at" = now();
