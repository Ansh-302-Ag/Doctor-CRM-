/**
 * Every source file is valid UTF-8. tsc and tsx shrug off a stray Windows-1252
 * byte, but Turbopack refuses to compile the file — and one bad byte in a
 * shared module turns every page AND the webhook into a blank 500.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dirname, "..");

test("every .ts/.tsx file under src/ and tests/ is valid UTF-8", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const bad: string[] = [];
  for (const dir of ["src", "tests"]) {
    for (const rel of readdirSync(join(repo, dir), { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(rel)) continue;
      try { decoder.decode(readFileSync(join(repo, dir, rel))); }
      catch { bad.push(join(dir, rel)); }
    }
  }
  assert.deepEqual(bad, [], "files that are not valid UTF-8");
});
