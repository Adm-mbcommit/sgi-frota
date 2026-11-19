CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"issued_on" date,
	"expires_on" date,
	"expiry_estimated" boolean DEFAULT false NOT NULL,
	"alert_days" integer,
	"link" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"short_name" text NOT NULL,
	"name" text NOT NULL,
	"cnpj" text NOT NULL,
	"drive_folder" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_company_kind_uq" ON "certificates" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "certificates_org_exp_idx" ON "certificates" USING btree ("organization_id","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_cnpj_uq" ON "companies" USING btree ("organization_id","cnpj");--> statement-breakpoint
-- Relação das CNDs lida no Google Drive em 19/11/2026 (pasta "DOCUMENTOS P/ LICITAÇÕES", uma subpasta por empresa).
-- Vencimentos conferidos no nome dos arquivos e, nos casos vencidos/próximos, dentro do PDF.
-- Falência (TJSC) não traz validade: 90 dias da emissão (expiry_estimated).
INSERT INTO "companies" ("organization_id", "short_name", "name", "cnpj", "drive_folder")
SELECT o."id", c.short_name, c.name, c.cnpj, 'https://drive.google.com/drive/folders/' || c.folder
FROM "organizations" o,
  (VALUES ('Matias 26', 'MATIAS BRASIL ENGENHARIA LTDA', '26.951.857/0001-80', '14xpDFzZwPHVp_NzLD5yhHwS7g74cF6G1'),
          ('Matias 44', 'MATIAS BRASIL ENGENHARIA E EMPREENDIMENTOS LTDA', '44.801.324/0001-02', '1Fsu7pnp8qMXWgKf566cX2zDlxmwdCviE'),
          ('Santos 47', 'SANTOS BRASIL TERRAPLANAGEM LTDA', '47.317.891/0001-78', '1f1c1Gx4BlivAxo7IxrXYg-s7UZsZHs8X'),
          ('Santos 50', 'SANTOS GUIMARAES CONSTRUCOES E EMPREENDIMENTOS SPE LTDA', '50.043.646/0001-24', '1WdjDnLD5nEBSY7BV98UoDCQvKez721jN')
  ) AS c(short_name, name, cnpj, folder)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "certificates" ("organization_id", "company_id", "kind", "issued_on", "expires_on", "expiry_estimated", "link")
SELECT co."organization_id", co."id", x.kind, x.issued::date, x.expires::date, x.estimated, 'https://drive.google.com/file/d/' || x.file || '/view'
FROM "companies" co,
  (VALUES
    ('26.951.857/0001-80', 'FEDERAL', NULL, '2027-04-14', false, '17wwGLmGzYg7SJV4ZE-YqZWf8ojCBF9N9'),
    ('26.951.857/0001-80', 'ESTADUAL', NULL, '2027-03-01', false, '1-A3ajpkg5xx0HsmZE7UbP1RnYsZ-kD-e'),
    ('26.951.857/0001-80', 'MUNICIPAL', '2026-11-06', '2026-12-06', false, '1plvoNfmQdRJcNT10ubQ2Rai-jh23SAvX'),
    ('26.951.857/0001-80', 'FGTS', '2026-10-24', '2026-11-22', false, '1IgomrsAFalhI5GNiV0o3K6pyQW14CNLW'),
    ('26.951.857/0001-80', 'TRABALHISTA', NULL, '2027-05-05', false, '1FrpCrYGIIoVLWOfN8TiqVDvm-dHSY7Zd'),
    ('26.951.857/0001-80', 'FALENCIA', '2026-06-12', '2026-09-10', true, '1HlEsZB4Z3DjwdDNpH1DF8yzeEMoX-p3D'),
    ('44.801.324/0001-02', 'FEDERAL', NULL, '2027-01-24', false, '1fPfwBbdlOBkIQ6PN9J95_Q5HqcI7-lF-'),
    ('44.801.324/0001-02', 'ESTADUAL', NULL, '2027-03-01', false, '1Hxka7F1W5ffYSUwGcFddpV01gz5mprW2'),
    ('44.801.324/0001-02', 'MUNICIPAL', '2026-10-09', '2026-11-08', false, '1ZEG1GGWQHdLkaGan-WxEBGM1VGxxTm4s'),
    ('44.801.324/0001-02', 'FGTS', '2026-10-12', '2026-11-10', false, '1U5YBNkdn7KMHFQzqwX1wlJOwDUuWWesQ'),
    ('44.801.324/0001-02', 'TRABALHISTA', NULL, '2027-01-24', false, '1__KlO8y263dw3LlIpFZ3FJjxkWeryyve'),
    ('44.801.324/0001-02', 'FALENCIA', '2026-11-09', '2027-02-07', true, '1aJdjtOOxOqvKZbv2LskcXnSZ8_PAJXIb'),
    ('47.317.891/0001-78', 'FEDERAL', NULL, '2027-03-01', false, '1wwg2YCnkv5vbLWenHLUvYjEdDFTHPyxo'),
    ('47.317.891/0001-78', 'ESTADUAL', NULL, '2027-03-01', false, '1fXaXpllc3GQpntyaacjQ9KadIpF2fat-'),
    ('47.317.891/0001-78', 'MUNICIPAL', NULL, '2026-11-08', false, '1QSnwnY2sRYiIDQyOyR2sG5U0NLMGqmHd'),
    ('47.317.891/0001-78', 'FGTS', '2026-09-13', '2026-10-12', false, '1Ryp675hvLwzpfGFIe3F1QH9J_uAQTBCN'),
    ('47.317.891/0001-78', 'TRABALHISTA', NULL, '2026-11-28', false, '1KFUND-cfWWP1pqFeqAIIe0NyXG3Xx8ZG'),
    ('47.317.891/0001-78', 'FALENCIA', '2026-06-01', '2026-08-30', true, '1SI6-qDNvScEtYS51w4L8xLNKpcL72_Fh'),
    ('50.043.646/0001-24', 'FEDERAL', NULL, '2027-02-16', false, '1J7bGhlQSY1iPdH7nkKUJxlUt7RnMlL4J'),
    ('50.043.646/0001-24', 'ESTADUAL', NULL, '2027-02-16', false, '1DHvXjbqsLtZoc9RGybIIGGtyyqzDn4uU'),
    ('50.043.646/0001-24', 'MUNICIPAL', NULL, '2026-11-08', false, '1kaEN2_yRBAjgHNhx5I90QepAPJCsVoS7'),
    ('50.043.646/0001-24', 'FGTS', '2026-09-14', '2026-10-13', false, '1j6Pyfxf4M_BVteihsWsPobJqROSZXh6C'),
    ('50.043.646/0001-24', 'TRABALHISTA', NULL, '2027-02-16', false, '1PFB9-t27BmGpYoLjff6qmJRH8rWgICj0'),
    ('50.043.646/0001-24', 'FALENCIA', '2026-08-20', '2026-11-18', true, '12CbpCI86S9rMdh_SSs_blhQW4kzAY95_')
  ) AS x(cnpj, kind, issued, expires, estimated, file)
WHERE co."cnpj" = x.cnpj
ON CONFLICT DO NOTHING;
