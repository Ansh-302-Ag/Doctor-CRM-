/** Development seed: one clinic, two doctors, three staff logins. Idempotent. */
import postgres from "postgres";
import { hashPassword } from "../src/lib/password";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

async function main() {
  const [clinic] = await sql<{ id: string }[]>`
    insert into clinics (name, timezone, phone)
    values ('Sunrise Clinic', 'Asia/Kolkata', '+911140001234')
    on conflict do nothing
    returning id`
    ?? [];
  const clinicId = clinic?.id ??
    (await sql<{ id: string }[]>`select id from clinics order by created_at limit 1`)[0].id;

  const doctors = [
    { name: "Dr. Rao", specialty: "General Medicine", slot: 30 },
    { name: "Dr. Iyer", specialty: "Paediatrics", slot: 20 },
  ];
  for (const d of doctors) {
    const [existing] = await sql`select id from doctors where clinic_id = ${clinicId} and name = ${d.name}`;
    if (existing) continue;
    const [doc] = await sql<{ id: string }[]>`
      insert into doctors (clinic_id, name, specialty, default_slot_minutes)
      values (${clinicId}, ${d.name}, ${d.specialty}, ${d.slot}) returning id`;
    await sql`insert into staff_users (clinic_id, name, email, password_hash, role, doctor_id)
              values (${clinicId}, ${d.name},
                      ${d.name.toLowerCase().replace(/[^a-z]/g, "") + "@sunrise.clinic"},
                      ${await hashPassword("password123")}, 'doctor', ${doc.id})`;
  }

  for (const s of [
    { name: "Front Desk", email: "desk@sunrise.clinic", role: "receptionist" },
    { name: "Admin", email: "admin@sunrise.clinic", role: "admin" },
  ]) {
    await sql`insert into staff_users (clinic_id, name, email, password_hash, role)
              values (${clinicId}, ${s.name}, ${s.email},
                      ${await hashPassword("password123")}, ${s.role}::staff_role)
              on conflict (email) do nothing`;
  }

  console.log(`clinic ready: ${clinicId}`);
  console.log("logins: desk@sunrise.clinic / admin@sunrise.clinic / drrao@sunrise.clinic");
  console.log("password: password123   (development only)");
  console.log(`\nadd this to .env.local:\nCLINIC_ID=${clinicId}`);
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
