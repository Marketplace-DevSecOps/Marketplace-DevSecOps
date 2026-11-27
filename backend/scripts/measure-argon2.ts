// Measures hash and verify times for ARGON2_OPTIONS on this machine.
// Run: npx tsx scripts/measure-argon2.ts. Results go to
// docs/backend/session-policy.md ("Password storage").
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from '../src/modules/auth/password.js';

const RUNS = 20;
const PASSWORD = 'measure-only-password-123';

function stats(samples: number[]): { median: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  return { median: at(0.5), p95: at(0.95) };
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

// Warm-up (loads the native binding).
const hash = await hashPassword(PASSWORD);

const hashTimes: number[] = [];
const verifyTimes: number[] = [];
for (let i = 0; i < RUNS; i += 1) {
  hashTimes.push(await time(() => hashPassword(PASSWORD)));
  verifyTimes.push(await time(() => verifyPassword(hash, PASSWORD)));
}

const h = stats(hashTimes);
const v = stats(verifyTimes);
process.stdout.write(
  [
    `Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'} (${String(cpus().length)} logical cores)`,
    `Options: m=${String(ARGON2_OPTIONS.memoryCost)} KiB, t=${String(ARGON2_OPTIONS.timeCost)}, p=${String(ARGON2_OPTIONS.parallelism)}; ${String(RUNS)} runs each`,
    `hash:   median ${h.median.toFixed(1)} ms, p95 ${h.p95.toFixed(1)} ms`,
    `verify: median ${v.median.toFixed(1)} ms, p95 ${v.p95.toFixed(1)} ms`,
  ].join('\n') + '\n',
);
