ALTER TABLE "conversations" ADD COLUMN "prefill_token" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "prefill_token_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "public_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_prefillToken_unique" UNIQUE("prefill_token");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_publicToken_unique" UNIQUE("public_token");