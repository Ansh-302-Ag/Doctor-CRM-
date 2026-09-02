/**
 * WhatsApp simulator: a terminal chat against the real agent, real database and
 * real tools — everything except Meta. Use it to exercise the loop before there
 * are any credentials, and to reproduce a conversation while debugging.
 *
 *   npm run sim -- +919000000001
 */
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { handleInbound } from "../src/lib/agent";

const phone = process.argv[2] ?? "+919000000001";
const url = process.env.AGENT_DATABASE_URL ?? process.env.DATABASE_URL!;
const sql = postgres(url, { max: 2, onnotice: () => {} });

async function main() {
  const clinicId = process.env.CLINIC_ID ??
    (await sql<{ id: string }[]>`select id from clinics order by created_at limit 1`)[0]?.id;
  if (!clinicId) throw new Error("no clinic found — run `npm run seed` first");

  console.log(`WhatsApp simulator — you are ${phone}. Ctrl-C to quit.\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  rl.on("close", () => process.exit(0));
  for (;;) {
    const body = (await rl.question("you › ").catch(() => null))?.trim();
    if (body === undefined || body === null) break;   // stdin closed
    if (!body) continue;
    const reply = await handleInbound(sql, {
      clinicId, phone, body, providerMessageId: `sim.${randomUUID()}`,
    });
    if (!reply) { console.log("(duplicate — ignored)\n"); continue; }
    console.log(`\nclinic › ${reply.text}${reply.escalated ? "\n         [escalated to staff]" : ""}\n`);
  }
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
