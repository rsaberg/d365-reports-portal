/** Create (or reset) the first admin user. Usage: npm run db:seed-admin -- admin@company.com "Full Name" "Password" */
import "./env";
import bcrypt from "bcryptjs";
import { sql } from "../lib/db";
(async () => {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password || password.length < 8) {
    console.error('Usage: npm run db:seed-admin -- <email> "<name>" "<password, 8+ characters>"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await sql`insert into portal.users (email, name, password_hash, role) values (${email}, ${name}, ${hash}, 'admin')
    on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', active = true, name = excluded.name`;
  console.log(`Admin ready: ${email}`);
  await sql.end();
})();
