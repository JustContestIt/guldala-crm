// npm run db:migrate — applies db/migrations to DATABASE_URL
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function migrateDb(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./db/migrations" });
  await sql.end();
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrateDb(process.env.DATABASE_URL!).then(() => console.log("migrations applied"));
}
