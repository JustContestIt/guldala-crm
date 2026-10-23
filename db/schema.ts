// Data model of spec §6, stages 0–2. Columns are snake_case in the DB (casing option), camelCase here.
// Botanica projects, Telegram and PIN fields arrive with their stages (6, 4).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { SeasonSettings } from "@/lib/settings";

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum("user_role", ["owner", "operator"]);
export const clientType = pgEnum("client_type", ["flower_shop", "reseller", "landscaper", "private", "other"]);
export const clientSource = pgEnum("client_source", ["order", "inbound_message", "import"]);
export const seasonStatus = pgEnum("season_status", ["planning", "open", "closed"]);
export const productLine = pgEnum("product_line", ["tulpan", "botanica"]);
export const tulipType = pgEnum("tulip_type", ["classic", "double"]);
export const productUnit = pgEnum("product_unit", ["stem", "piece"]);
export const orderStatus = pgEnum("order_status", ["new", "confirmed", "prepaid", "ready", "issued", "expired", "cancelled"]);
export const orderChannel = pgEnum("order_channel", ["site", "whatsapp", "instagram", "telegram", "phone", "in_person"]);
export const orderCreatedBy = pgEnum("order_created_by", ["client", "operator"]);
export const pickupMethod = pgEnum("pickup_method", ["self_pickup", "client_truck"]);
export const paymentKind = pgEnum("payment_kind", ["prepayment", "balance", "refund"]);
export const paymentMethod = pgEnum("payment_method", ["kaspi_invoice", "cash", "bank_transfer"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "cancelled"]);
export const eventType = pgEnum("event_type", ["status_change", "payment", "edit", "note", "notification", "stock", "message_sent"]);
export const actorType = pgEnum("actor_type", ["user", "system", "client"]);
export const messageChannel = pgEnum("message_channel", ["whatsapp", "telegram", "instagram"]);
export const messageDirection = pgEnum("message_direction", ["in", "out"]);
export const messageAuthor = pgEnum("message_author", ["client", "operator", "system"]);
export const messageStatus = pgEnum("message_status", ["queued", "sent", "delivered", "read", "error"]);

export const users = pgTable("users", {
  id: id(),
  name: text().notNull(),
  role: userRole().notNull(),
  login: text().notNull().unique(),
  passwordHash: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const clients = pgTable("clients", {
  id: id(),
  phone: text().notNull().unique(),
  name: text().notNull().default(""),
  company: text(),
  clientType: clientType().notNull().default("flower_shop"),
  notes: text().notNull().default(""),
  source: clientSource().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const seasons = pgTable("seasons", {
  id: id(),
  name: text().notNull(),
  ordersOpenFrom: date().notNull(),
  peakDate: date().notNull(),
  pickupFrom: date().notNull(),
  pickupTo: date().notNull(),
  status: seasonStatus().notNull().default("planning"),
  settings: jsonb().$type<SeasonSettings>().notNull(),
  orderSeq: integer().notNull().default(0), // last order number issued in the season, T-2027-NNNN
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const products = pgTable("products", {
  id: id(),
  line: productLine().notNull().default("tulpan"),
  name: text().notNull(),
  tulipType: tulipType(),
  color: text(),
  varieties: text(),
  unit: productUnit().notNull().default("stem"),
  packSize: integer().notNull().default(30),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const priceRules = pgTable(
  "price_rules",
  {
    id: id(),
    seasonId: uuid()
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    tulipType: tulipType().notNull(),
    dateFrom: date().notNull(),
    dateTo: date().notNull(),
    prepaymentMinPct: integer().notNull(),
    prepaymentMaxPct: integer().notNull(),
    pricePerStem: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("price_rules_dates", sql`${t.dateFrom} <= ${t.dateTo}`),
    check("price_rules_pct", sql`${t.prepaymentMinPct} <= ${t.prepaymentMaxPct}`),
    check("price_rules_price", sql`${t.pricePerStem} > 0`),
  ],
);

export const stockPlans = pgTable(
  "stock_plans",
  {
    seasonId: uuid()
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    plannedStems: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.productId] })],
);

export const stockAdjustments = pgTable("stock_adjustments", {
  id: id(),
  seasonId: uuid()
    .notNull()
    .references(() => seasons.id, { onDelete: "cascade" }),
  productId: uuid()
    .notNull()
    .references(() => products.id),
  deltaStems: integer().notNull(),
  reason: text().notNull(),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: text().notNull().unique(),
    seasonId: uuid()
      .notNull()
      .references(() => seasons.id),
    clientId: uuid()
      .notNull()
      .references(() => clients.id),
    status: orderStatus().notNull(),
    channel: orderChannel().notNull().default("whatsapp"),
    createdBy: orderCreatedBy().notNull(),
    prepaymentPct: integer().notNull(),
    subtotal: integer().notNull(),
    discountAmount: integer().notNull().default(0),
    total: integer().notNull(),
    discountReason: text(),
    priceLockedAt: timestamp({ withTimezone: true }),
    holdUntil: timestamp({ withTimezone: true }),
    pickupDate: date(),
    pickupTime: time(),
    pickupMethod: pickupMethod().notNull().default("self_pickup"),
    storageRequested: boolean().notNull().default(false),
    commentClient: text().notNull().default(""),
    commentInternal: text().notNull().default(""),
    confirmedAt: timestamp({ withTimezone: true }),
    issuedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("orders_discount", sql`${t.discountAmount} >= 0 and ${t.total} >= 0`)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    qtyPacks: integer().notNull(),
    packSize: integer().notNull(),
    qtyStems: integer().notNull(),
    unitPrice: integer().notNull(),
    priceRuleId: uuid().references(() => priceRules.id, { onDelete: "set null" }),
    lineTotal: integer().notNull(),
    substituteProductId: uuid().references(() => products.id),
    substitutionNote: text(),
    issuedStems: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [check("order_items_qty", sql`${t.qtyPacks} >= 1 and ${t.qtyStems} = ${t.qtyPacks} * ${t.packSize}`)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    // becomes nullable with projects (stage 6): exactly one of order_id / project_id
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: paymentKind().notNull(),
    method: paymentMethod().notNull(),
    status: paymentStatus().notNull(),
    amount: integer().notNull(),
    invoiceRef: text(),
    paidAt: timestamp({ withTimezone: true }),
    recordedBy: uuid().references(() => users.id),
    note: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("payments_amount", sql`${t.amount} > 0`)],
);

export const orderEvents = pgTable("order_events", {
  id: id(),
  orderId: uuid().references(() => orders.id, { onDelete: "cascade" }),
  type: eventType().notNull(),
  fromStatus: text(),
  toStatus: text(),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  actorType: actorType().notNull(),
  actorId: uuid().references(() => users.id),
  createdAt: createdAt(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    clientId: uuid()
      .notNull()
      .references(() => clients.id),
    channel: messageChannel().notNull(),
    externalId: text().notNull(),
    providerChannelId: text(),
    lastMessageAt: timestamp({ withTimezone: true }),
    lastInboundAt: timestamp({ withTimezone: true }),
    unreadCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.channel, t.externalId)],
);

export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid()
    .notNull()
    .references(() => conversations.id),
  direction: messageDirection().notNull(),
  author: messageAuthor().notNull(),
  text: text().notNull(),
  attachments: jsonb().$type<unknown[]>().notNull().default([]),
  externalMessageId: text().unique(),
  status: messageStatus().notNull(),
  error: text(),
  templateKey: text(),
  sentAt: timestamp({ withTimezone: true }),
  readAt: timestamp({ withTimezone: true }),
  isEcho: boolean().notNull().default(false),
  createdAt: createdAt(),
});
