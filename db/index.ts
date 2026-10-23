import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// One pool per process: Next dev reloads modules, so the client is kept on globalThis
const g = globalThis as unknown as { pg?: postgres.Sql };
export const pg = (g.pg ??= postgres(url, { max: 10 }));

export const db = drizzle(pg, { schema, casing: "snake_case" });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Db = typeof db | Tx;
