-- SAVEIRO 55 (TPR0F55): alinhamento, balanceamento e freios também foram feitos na 5ª revisão
-- (09/11/2026, km 50.263, Viaserra), confirmado pelo usuário em 17/11/2026.
-- Só atualiza o que estiver com registro mais antigo (ou sem registro).
INSERT INTO "maintenance_records" ("organization_id", "plan_item_id", "vehicle_id", "item", "km", "date", "supplier", "invoice", "cost_id", "notes")
SELECT p."organization_id", p."id", p."vehicle_id", p."item", 50263, DATE '2026-11-09', 'VIASERRA', c."invoice", c."id",
       '5ª REVISÃO (incluiu este item, confirmado pelo usuário em 17/11/2026)'
FROM "maintenance_plan" p
JOIN "vehicles" v ON v."id" = p."vehicle_id" AND v."plate" = 'TPR0F55'
LEFT JOIN LATERAL (
  SELECT * FROM "costs" c WHERE c."vehicle_id" = p."vehicle_id" AND c."date" = DATE '2026-11-09' AND c."category" = 'Manutenção'
  ORDER BY c."amount" DESC NULLS LAST LIMIT 1
) c ON true
WHERE p."active" AND p."item" ~* '^(alinhamento|balanceamento|freios)$'
  AND (p."last_date" IS NULL OR p."last_date" < DATE '2026-11-09')
  AND NOT EXISTS (SELECT 1 FROM "maintenance_records" r WHERE r."plan_item_id" = p."id" AND r."date" = DATE '2026-11-09');
--> statement-breakpoint
UPDATE "maintenance_plan" p
SET "last_km" = 50263, "last_date" = DATE '2026-11-09', "needs_check" = false,
    "source" = 'Registrado no SGI: 5ª revisão de 09/11/2026 · VIASERRA (confirmado pelo usuário)'
FROM "vehicles" v
WHERE p."vehicle_id" = v."id" AND v."plate" = 'TPR0F55' AND p."active"
  AND p."item" ~* '^(alinhamento|balanceamento|freios)$'
  AND (p."last_date" IS NULL OR p."last_date" < DATE '2026-11-09');
