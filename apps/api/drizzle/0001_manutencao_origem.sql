ALTER TABLE "maintenance_records" ADD COLUMN "source" "record_source" DEFAULT 'SGI' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD COLUMN "external_key" text;--> statement-breakpoint
UPDATE "maintenance_records" SET "cost_id" = NULL WHERE "cost_id" IS NOT NULL AND "cost_id" NOT IN (SELECT "id" FROM "costs");--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_cost_id_costs_id_fk" FOREIGN KEY ("cost_id") REFERENCES "public"."costs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maint_records_org_ext_uq" ON "maintenance_records" USING btree ("organization_id","external_key");--> statement-breakpoint
CREATE INDEX "maint_records_cost_idx" ON "maintenance_records" USING btree ("cost_id");