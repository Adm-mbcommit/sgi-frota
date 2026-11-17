ALTER TYPE "public"."record_source" ADD VALUE 'MAIS_CONTROLE';--> statement-breakpoint
ALTER TABLE "costs" ADD COLUMN "external_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "costs_org_ext_uq" ON "costs" USING btree ("organization_id","external_key");