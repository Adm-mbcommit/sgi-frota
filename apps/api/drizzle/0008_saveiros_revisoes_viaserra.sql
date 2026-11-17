-- Saveiros 21 e 55 (veículos novos): revisões na Viaserra a cada 10.000 km; nenhuma peça foi trocada
-- (informado pelo usuário em 17/11/2026).
-- - Itens de revisão (revisão geral, óleo, filtro, alinhamento, balanceamento, freios, arrefecimento):
--   feitos na revisão do seu período. Revisões: 21 → 2ª ~20.000 km (25/09/2026);
--   55 → 4ª 40.264 km (04/09/2026), 5ª 50.263 km (09/11/2026).
-- - Peças de troca (pneus, pastilhas/lonas, velas, correia): nunca trocadas → contam do km 0 (de fábrica).
-- Não substitui registro mais novo já existente.
CREATE TEMP TABLE _rev AS
SELECT p."id" AS plan_id, p."organization_id", p."vehicle_id", p."item", x.km, x.dt
FROM "maintenance_plan" p
JOIN "vehicles" v ON v."id" = p."vehicle_id"
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN p."item" ~* '(pneu|pastilha|lona|vela|correia)' THEN 0
    WHEN v."plate" = 'TPX8A21' AND p."interval_km" IN (10000, 20000) THEN 20000
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" = 10000 THEN 50263
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" IN (20000, 40000) THEN 40264
    WHEN v."plate" = 'TPR0F55' AND p."interval_km" = 50000 THEN 50263
  END AS km,
  CASE
    WHEN p."item" ~* '(pneu|pastilha|lona|vela|correia)' THEN NULL::date
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
       'Revisão Viaserra (gestão anterior; item de revisão no seu período; informado pelo usuário em 17/11/2026)'
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
      THEN 'Veículo novo: peça nunca trocada (conta do km 0, de fábrica)'
      ELSE 'Revisão Viaserra de ' || to_char(r.dt, 'DD/MM/YYYY') || ', km ' || replace(to_char(r.km, 'FM999,999'), ',', '.') || ' (item de revisão)' END
FROM _rev r WHERE p."id" = r.plan_id;
--> statement-breakpoint
DROP TABLE _rev;
