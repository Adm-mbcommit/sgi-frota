ALTER TABLE "vehicle_documents" ADD COLUMN "links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- CRLVs 2026 que estão no Google Drive da empresa (pasta dos CRLVs), ligados a cada veículo pela placa.
INSERT INTO "vehicle_documents" ("organization_id", "vehicle_id", "links")
SELECT v."organization_id", v."id", jsonb_build_object('crlv', x.url)
FROM "vehicles" v
JOIN (VALUES
  ('QXI9C75', 'https://drive.google.com/file/d/1UI7d2QGYA2YfMOv9g6XDs7yssCB4ff5B/view'),
  ('TPR0F55', 'https://drive.google.com/file/d/19wXMrksRoZzO6zhzNVTFn1ANFTn23nnw/view'),
  ('TPX8A21', 'https://drive.google.com/file/d/1styTtgutR3WsS75Gf_A_0W1UcSnQQDaS/view'),
  ('MFS7D92', 'https://drive.google.com/file/d/1hcYaWr9dcI3LxomZppDK_gO7gV0mrx4c/view')
) AS x(plate, url) ON x.plate = v."plate"
ON CONFLICT ("vehicle_id") DO UPDATE SET "links" = "vehicle_documents"."links" || EXCLUDED."links";
