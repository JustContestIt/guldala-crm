ALTER TYPE "public"."message_author" ADD VALUE 'assistant';--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'draft' BEFORE 'queued';--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assistant_muted_at" timestamp with time zone;