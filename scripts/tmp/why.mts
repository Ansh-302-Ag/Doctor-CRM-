import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
console.log("--- recent escalations");
for (const r of await sql`
  select e.created_at, e.reason, e.priority, p.phone, p.consent_status, p.name
    from escalations e join patients p on p.id = e.patient_id
   order by e.created_at desc limit 6`)
  console.log(`${r.created_at.toISOString().slice(0,19)} | ${r.phone} | consent=${r.consent_status} | ${r.reason}`);
console.log("\n--- recent messages");
for (const m of await sql`
  select m.created_at, m.direction, left(m.body, 90) as body
    from messages m order by m.created_at desc limit 8`)
  console.log(`${m.created_at.toISOString().slice(11,19)} ${m.direction.padEnd(8)} ${m.body}`);
await sql.end();
