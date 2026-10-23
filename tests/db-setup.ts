// Vitest global setup: a fresh guldala_test database with all migrations, once per run
import postgres from "postgres";
import { migrateDb } from "../scripts/migrate";

export async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const name = new URL(url).pathname.slice(1);
  const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();
  await migrateDb(url);
}
