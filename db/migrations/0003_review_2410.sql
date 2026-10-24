ALTER TYPE "public"."client_source" ADD VALUE 'manual';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "storage_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- seasons created before the fridge became paid get the default rate (lib/settings.ts)
UPDATE "seasons" SET "settings" = "settings" || '{"storage_fee_per_day": 1000}'::jsonb WHERE "settings"->'storage_fee_per_day' IS NULL;
