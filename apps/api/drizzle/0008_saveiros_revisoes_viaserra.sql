-- Saveiros 21 e 55: revisões na Viaserra a cada 10.000 km, com cada item (inclusive troca de peças) feito no seu
-- período (informado pelo usuário em 17/11/2026; conferir depois com as notas de serviço do Mais Controle).
-- Item de intervalo I = feito na revisão cujo km (10.000 × n) é múltiplo de I.
-- Revisões: 21 (2026/2026) → 2ª ~20.000 km (25/09/2026); 55 (2025/2026) → 4ª 40.264 km (04/09/2026), 5ª 50.263 km (09/11/2026).
-- Itens cujo período o veículo ainda não alcançou (21: pneus, velas, correia) contam do km 0 (de fábrica).
-- Não substitui registro mais novo já existente.
CREATE TEMP TABLE _rev AS
SELECT p."id" AS plan_id, p."organization_id", p."vehicle_id", p."item", x.km, x.dt
FROM "maintenance_plan" p
JOIN "vehicles" v ON v."id" = p."vehicle_id"
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN v."plate" = 'TPX8A21' AND p."interval_km" IN (10000, 20000) THEN 20000
    WHEN v."plate" = 'TPX8A21' AND p."interval_km" > 20000 THEN 0
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" = 10000 THEN 50263
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" IN (20000, 40000) THEN 40264
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" = 50000 THEN 50263
  END AS km,
  CASE
    WHEN v."plate" = 'TPX8A21' AND p."interval_km" IN (10000, 20000) THEN DATE '2026-09-25'
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" = 10000 THEN DATE '2026-11-09'
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" IN (20000, 40000) THEN DATE '2026-09-04'
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" = 50000 THEN DATE '2026-11-09'
  END AS dt
) x
WHERE v."plate" IN ('TPX8A21', 'TPR0F55') AND p."active" AND p."interval_km" IS NOT NULL AND x.km IS NOT NULL
  AND (p."last_date" IS NULL OR x.dt IS NULL OR p."last_date" < x.dt OR (p."last_date" = x.dt AND COALESCE(p."last_km", 0) < x.km))
  AND (x.dt IS NOT NULL OR p."last_date" IS NULL OR p."needs_check" OR p."last_km" <= 10000);
--> statement-breakpoint
INSERT INTO "maintenance_records" ("organization_id", "plan_item_id", "vehicle_id", "item", "km", "date", "supplier", "invoice", "cost_id", "notes")
SELECT r."organization_id", r.plan_id, r."vehicle_id", r."item", r.km, r.dt, 'VIASERRA', c."invoice", c."id",
       'Revisão Viaserra (gestão anterior; item feito no seu período, informado pelo usuário em 17/11/2026; conferir NF no Mais Controle)'
FROM _rev r
LEFT JOIN LATERAL (
  SELECT * FROM "costs" c WHERE c."vehicle_id" = r."vehicle_id" AND c."date" = r.dt AND c."category" = 'Manutenção'
  ORDER BY c."amount" DESC NULLS LAST LIMIT 1
) c ON true
WHERE r.dt IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "maintenance_records" m WHERE m."plan_item_id" = r.plan_id AND m."date" = r.dt);
--> statement-breakpoint
UPDATE "maintenance_plan" p
SET "last_km" = r.km, "last_date" = r.dt, "needs_check" = false,
    "source" = CASE WHEN r.dt IS NULL
      THEN 'Veículo novo: ainda não chegou ao período deste item (conta do km 0, de fábrica)'
      ELSE 'Revisão Viaserra de ' || to_char(r.dt, 'DD/MM/YYYY') || ', km ' || replace(to_char(r.km, 'FM999,999'), ',', '.') || ' (feito no seu período; conferir NF no Mais Controle)' END
FROM _rev r WHERE p."id" = r.plan_id;
--> statement-breakpoint
DROP TABLE _rev;
