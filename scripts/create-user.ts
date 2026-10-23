// npm run user:create -- <login> "<Имя>" [owner|operator]
// Creates a user, or resets the password of an existing login. Prints the new password once.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { hashPassword } from "../lib/password";

async function main() {
  const [login, name, role = "owner"] = process.argv.slice(2);
  if (!login || !name || !["owner", "operator"].includes(role)) {
    console.error('usage: create-user <login> "<Имя>" [owner|operator]');
    process.exitCode = 1;
    return;
  }
  const password = randomBytes(9).toString("base64url"); // 12 characters
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      insert into users (name, role, login, password_hash)
      values (${name}, ${role}, ${login.toLowerCase()}, ${await hashPassword(password)})
      on conflict (login) do update set name = excluded.name, role = excluded.role, password_hash = excluded.password_hash`;
  } finally {
    await sql.end();
  }
  console.log(`${login.toLowerCase()} (${role}) — пароль: ${password}\nСохраните его: повторно он не показывается.`);
}

main();
