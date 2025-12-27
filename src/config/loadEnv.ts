import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function loadIfExists(p: string): boolean {
  if (!fs.existsSync(p)) return false;
  dotenv.config({ path: p, override: false });
  return true;
}

/**
 * Loads environment variables from:
 * - ENV_FILE if set (explicit)
 * - .env.local in eval-service/ (cwd) or repo root (..)
 * - .env in eval-service/ (cwd) or repo root (..)
 *
 * Notes:
 * - Does NOT override already-set environment variables.
 * - This keeps production behavior standard (set env vars in the runtime).
 */
export function loadEnv(): { loaded: string[] } {
  const loaded: string[] = [];

  const cwd = process.cwd();
  const parent = path.resolve(cwd, "..");

  const explicit = process.env.ENV_FILE;
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    if (loadIfExists(abs)) loaded.push(abs);
    return { loaded };
  }

  const candidates = [
    path.resolve(cwd, ".env.local"),
    path.resolve(parent, ".env.local"),
    path.resolve(cwd, ".env"),
    path.resolve(parent, ".env")
  ];

  for (const p of candidates) {
    if (loadIfExists(p)) loaded.push(p);
  }

  return { loaded };
}



