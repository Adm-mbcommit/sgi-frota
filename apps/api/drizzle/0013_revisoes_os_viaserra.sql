-- Revisões da Viaserra (Auto Elite) conferidas com as ordens de serviço enviadas pelo usuário em 27/11/2026.
-- Saveiro 55 (TPR0F55): 1ª OS 160623 24/10/2025 km 9.993 · 2ª OS 162691 11/02/2026 km 20.183 ·
--   3ª OS 164659 01/06/2026 km 29.999 · 4ª OS 166719 04/09/2026 km 40.263 (velas e pastilhas traseiras) ·
--   5ª OS 167983 09/11/2026 km 50.333.
-- Saveiro 21 (TPX8A21): 1ª OS 164951 15/06/2026 km 10.199 · 2ª OS 167171 25/09/2026 km 18.994
--   (inclui balanceamento + geometria + rodízio).
-- Não cria custos (os valores já estão em Custos / Mais Controle); só corrige km, completa o histórico
-- e marca para conferir o que as migrações 0007/0008 deram como feito mas não aparece nas OS.

-- 1) Km corretos das revisões já registradas (só onde ainda está o km antigo).
UPDATE "maintenance_records" r SET "km" = x.new_km
FROM "vehicles" v,
  (VALUES ('TPR0F55', DATE '2026-11-09', 50263, 50333),
          ('TPR0F55', DATE '2026-09-04', 40264, 40263),
          ('TPX8A21', DATE '2026-09-25', 20000, 18994)) AS x(plate, dt, old_km, new_km)
WHERE r."vehicle_id" = v."id" AND v."plate" = x.plate AND r."date" = x.dt AND r."km" = x.old_km;
--> statement-breakpoint
UPDATE "maintenance_plan" p
SET "last_km" = x.new_km, "needs_check" = false,
    "source" = 'OS ' || x.os || ' da Viaserra: ' || x.rev || ' revisão em ' || to_char(x.dt, 'DD/MM/YYYY')
      || ', km ' || replace(to_char(x.new_km, 'FM999,999'), ',', '.') || ' (conferido com a OS em 27/11/2026)'
FROM "vehicles" v,
  (VALUES ('TPR0F55', DATE '2026-11-09', 50263, 50333, '167983', '5ª'),
          ('TPR0F55', DATE '2026-09-04', 40264, 40263, '166719', '4ª'),
          ('TPX8A21', DATE '2026-09-25', 20000, 18994, '167171', '2ª')) AS x(plate, dt, old_km, new_km, os, rev)
WHERE p."vehicle_id" = v."id" AND v."plate" = x.plate AND p."last_date" = x.dt AND p."last_km" = x.old_km;
--> statement-breakpoint
-- 2) Itens dados como feitos que não aparecem nas OS: ficam para CONFIRMAR (mantêm km/data, que podem ter sido
--    feitos em outra oficina). Não mexe em item que o usuário registrou pelo SGI nessa data.
UPDATE "maintenance_plan" p
SET "needs_check" = true,
    "source" = 'Conferir: não aparece nas OS da Viaserra (conferidas em 27/11/2026). Registro anterior: '
      || to_char(p."last_date", 'DD/MM/YYYY') || ', km ' || replace(to_char(p."last_km", 'FM999,999'), ',', '.')
FROM "vehicles" v
WHERE p."vehicle_id" = v."id" AND p."active"
  AND (
    (v."plate" = 'TPR0F55' AND p."last_date" IN (DATE '2026-09-04', DATE '2026-11-09')
      AND p."item" ~* '^(alinhamento|balanceamento|freios|pneus|revis[aã]o do sistema de arrefecimento|correia dentada)$')
    OR (v."plate" = 'TPX8A21' AND p."last_date" = DATE '2026-09-25'
      AND p."item" ~* '^(freios|pastilhas ?/ ?lonas de freios|revis[aã]o do sistema de arrefecimento)$')
  )
  AND NOT EXISTS (SELECT 1 FROM "maintenance_records" r
                  WHERE r."plan_item_id" = p."id" AND r."date" = p."last_date" AND r."user_id" IS NOT NULL);
--> statement-breakpoint
UPDATE "maintenance_records" r
SET "notes" = COALESCE(r."notes" || ' · ', '') || 'Conferir: não aparece na OS da Viaserra (27/11/2026)'
FROM "maintenance_plan" p
WHERE r."plan_item_id" = p."id" AND r."date" = p."last_date" AND p."needs_check"
  AND p."source" LIKE 'Conferir: não aparece nas OS da Viaserra%'
  AND COALESCE(r."notes", '') NOT LIKE '%não aparece na OS da Viaserra%';
--> statement-breakpoint
-- 3) Revisões antigas que faltavam no histórico (troca de óleo, filtro de óleo e revisão geral).
--    São mais antigas que o último registro, então não mudam o prazo do plano. Ligadas ao custo, se existir.
INSERT INTO "maintenance_records" ("organization_id", "plan_item_id", "vehicle_id", "item", "km", "date", "supplier", "invoice", "cost_id", "notes")
SELECT p."organization_id", p."id", p."vehicle_id", p."item", x.km, x.dt, 'VIASERRA', c."invoice", c."id",
       x.rev || ' revisão · OS ' || x.os || ' da Viaserra (Auto Elite), conferida em 27/11/2026'
FROM "maintenance_plan" p
JOIN "vehicles" v ON v."id" = p."vehicle_id"
JOIN (VALUES ('TPR0F55', DATE '2025-10-24', 9993, '160623', '1ª'),
             ('TPR0F55', DATE '2026-02-11', 20183, '162691', '2ª'),
             ('TPR0F55', DATE '2026-06-01', 29999, '164659', '3ª'),
             ('TPX8A21', DATE '2026-06-15', 10199, '164951', '1ª')) AS x(plate, dt, km, os, rev) ON x.plate = v."plate"
LEFT JOIN LATERAL (
  SELECT * FROM "costs" c
  WHERE c."vehicle_id" = p."vehicle_id" AND c."category" = 'Manutenção' AND c."date" BETWEEN x.dt - 3 AND x.dt + 3
  ORDER BY c."amount" DESC NULLS LAST LIMIT 1
) c ON true
WHERE p."active" AND p."item" ~* '(revis[aã]o geral|troca d[eo] [óo]leo|filtro d[eo] [óo]leo)'
  AND NOT EXISTS (SELECT 1 FROM "maintenance_records" r
                  WHERE r."plan_item_id" = p."id" AND r."date" BETWEEN x.dt - 3 AND x.dt + 3);
