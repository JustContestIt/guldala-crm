CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'client');--> statement-breakpoint
CREATE TYPE "public"."client_source" AS ENUM('order', 'inbound_message', 'import');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('flower_shop', 'reseller', 'landscaper', 'private', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('status_change', 'payment', 'edit', 'note', 'notification', 'stock', 'message_sent');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('client', 'operator', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('whatsapp', 'telegram', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'error');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('site', 'whatsapp', 'instagram', 'telegram', 'phone', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."order_created_by" AS ENUM('client', 'operator');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'confirmed', 'prepaid', 'ready', 'issued', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('prepayment', 'balance', 'refund');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('kaspi_invoice', 'cash', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pickup_method" AS ENUM('self_pickup', 'client_truck');--> statement-breakpoint
CREATE TYPE "public"."product_line" AS ENUM('tulpan', 'botanica');--> statement-breakpoint
CREATE TYPE "public"."product_unit" AS ENUM('stem', 'piece');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('planning', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tulip_type" AS ENUM('classic', 'double');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'operator');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"company" text,
	"client_type" "client_type" DEFAULT 'flower_shop' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source" "client_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"external_id" text NOT NULL,
	"provider_channel_id" text,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_channel_externalId_unique" UNIQUE("channel","external_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"author" "message_author" NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_message_id" text,
	"status" "message_status" NOT NULL,
	"error" text,
	"template_key" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"is_echo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_externalMessageId_unique" UNIQUE("external_message_id")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"type" "event_type" NOT NULL,
	"from_status" text,
	"to_status" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_packs" integer NOT NULL,
	"pack_size" integer NOT NULL,
	"qty_stems" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"price_rule_id" uuid,
	"line_total" integer NOT NULL,
	"substitute_product_id" uuid,
	"substitution_note" text,
	"issued_stems" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_qty" CHECK ("order_items"."qty_packs" >= 1 and "order_items"."qty_stems" = "order_items"."qty_packs" * "order_items"."pack_size")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"season_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"channel" "order_channel" DEFAULT 'whatsapp' NOT NULL,
	"created_by" "order_created_by" NOT NULL,
	"prepayment_pct" integer NOT NULL,
	"subtotal" integer NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"discount_reason" text,
	"price_locked_at" timestamp with time zone,
	"hold_until" timestamp with time zone,
	"pickup_date" date,
	"pickup_time" time,
	"pickup_method" "pickup_method" DEFAULT 'self_pickup' NOT NULL,
	"storage_requested" boolean DEFAULT false NOT NULL,
	"comment_client" text DEFAULT '' NOT NULL,
	"comment_internal" text DEFAULT '' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_discount" CHECK ("orders"."discount_amount" >= 0 and "orders"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount" integer NOT NULL,
	"invoice_ref" text,
	"paid_at" timestamp with time zone,
	"recorded_by" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"tulip_type" "tulip_type" NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"prepayment_min_pct" integer NOT NULL,
	"prepayment_max_pct" integer NOT NULL,
	"price_per_stem" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_rules_dates" CHECK ("price_rules"."date_from" <= "price_rules"."date_to"),
	CONSTRAINT "price_rules_pct" CHECK ("price_rules"."prepayment_min_pct" <= "price_rules"."prepayment_max_pct"),
	CONSTRAINT "price_rules_price" CHECK ("price_rules"."price_per_stem" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line" "product_line" DEFAULT 'tulpan' NOT NULL,
	"name" text NOT NULL,
	"tulip_type" "tulip_type",
	"color" text,
	"varieties" text,
	"unit" "product_unit" DEFAULT 'stem' NOT NULL,
	"pack_size" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"orders_open_from" date NOT NULL,
	"peak_date" date NOT NULL,
	"pickup_from" date NOT NULL,
	"pickup_to" date NOT NULL,
	"status" "season_status" DEFAULT 'planning' NOT NULL,
	"settings" jsonb NOT NULL,
	"order_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"delta_stems" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_plans" (
	"season_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_stems" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_plans_season_id_product_id_pk" PRIMARY KEY("season_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_rule_id_price_rules_id_fk" FOREIGN KEY ("price_rule_id") REFERENCES "public"."price_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_substitute_product_id_products_id_fk" FOREIGN KEY ("substitute_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_plans" ADD CONSTRAINT "stock_plans_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_plans" ADD CONSTRAINT "stock_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;