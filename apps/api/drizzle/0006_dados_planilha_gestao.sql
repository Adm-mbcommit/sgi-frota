-- Dados da planilha "Gestão Frota MATIAS" (deixa de ser usada; o SGI passa a ser o sistema oficial).
-- 1) Base das revisões (aba Manutencoes): km da próxima revisão de cada veículo vale para Revisão geral,
--    Troca do óleo e Filtro do óleo (último km = próxima - intervalo). Data = a revisão mais recente da aba Custos.
--    Não substitui um serviço mais novo já registrado no SGI (data posterior ou km bem maior).
UPDATE "maintenance_plan" p
SET "last_km" = x.next_km - p."interval_km",
    "last_date" = COALESCE(x.last_date, p."last_date"),
    "needs_check" = false,
    "source" = 'Planilha Gestão Frota: próxima revisão no km ' || replace(to_char(x.next_km, 'FM999,999,999'), ',', '.')
      || COALESCE(' · última em ' || to_char(x.last_date, 'DD/MM/YYYY'), '')
FROM "vehicles" v,
  (VALUES ('QXI9C75', 149126, NULL::date),
          ('TPX8A21', 30000, DATE '2026-09-25'),
          ('TPR0F55', 60263, DATE '2026-11-09'),
          ('MFS7D92', 237845, DATE '2026-09-22')) AS x(plate, next_km, last_date)
WHERE p."vehicle_id" = v."id" AND v."plate" = x.plate AND p."active" AND p."interval_km" IS NOT NULL
  AND p."item" ~* '(revis[aã]o geral|troca d[eo] [óo]leo|filtro d[eo] [óo]leo)'
  AND (p."last_date" IS NULL OR x.last_date IS NULL OR p."last_date" <= x.last_date)
  AND (p."last_km" IS NULL OR p."last_km" <= x.next_km - p."interval_km" + 500);
--> statement-breakpoint
-- 2) Histórico: a revisão da aba Custos (já lançada em Custos) vira registro de cada item atualizado.
INSERT INTO "maintenance_records" ("organization_id", "plan_item_id", "vehicle_id", "item", "km", "date", "supplier", "invoice", "cost_id", "notes")
SELECT p."organization_id", p."id", p."vehicle_id", p."item", p."last_km", c."date", c."supplier", c."invoice", c."id",
       trim(c."description") || ' (planilha Gestão Frota; km pela próxima revisão)'
FROM "maintenance_plan" p
JOIN LATERAL (
  SELECT * FROM "costs" c
  WHERE c."vehicle_id" = p."vehicle_id" AND c."category" = 'Manutenção' AND c."date" = p."last_date" AND c."description" ~* '(revis|[óo]leo)'
  ORDER BY c."amount" DESC NULLS LAST LIMIT 1
) c ON true
WHERE p."source" LIKE 'Planilha Gestão Frota:%'
  AND NOT EXISTS (SELECT 1 FROM "maintenance_records" r WHERE r."plan_item_id" = p."id" AND r."date" = p."last_date");
--> statement-breakpoint
-- 3) Modelo e ano de cada veículo (aba Veiculos / CRLV), só onde ainda está genérico.
UPDATE "vehicles" v SET "model" = x.model
FROM (VALUES ('QXI9C75', 'VW/Nova Saveiro RB MBVD 2019/2020 (flex)'),
             ('TPR0F55', 'VW/Saveiro CS RB MF 2025/2026 (flex) · alienação fiduciária'),
             ('TPX8A21', 'VW/Saveiro CS RB MF 2026/2026 (flex)'),
             ('MFS7D92', 'Fiat/Uno Mille Fire 2005/2006 (gasolina)')) AS x(plate, model)
WHERE v."plate" = x.plate AND (v."model" IS NULL OR v."model" IN ('', 'Saveiro', 'Uno'));
