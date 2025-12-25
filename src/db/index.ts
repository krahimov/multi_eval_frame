import type pg from "pg";
import { createPool, getDbConfigFromEnv } from "./pool.js";

let poolSingleton: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (poolSingleton) return poolSingleton;
  poolSingleton = createPool(getDbConfigFromEnv());
  return poolSingleton;
}


