import pg from "pg";

export interface DbConfig {
  databaseUrl: string;
  maxPoolSize: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getDbConfigFromEnv(): DbConfig {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    maxPoolSize: Number(process.env.PG_POOL_MAX ?? "10")
  };
}

export function createPool(config: DbConfig): pg.Pool {
  const needsSsl =
    process.env.PG_SSL === "true" ||
    config.databaseUrl.includes("neon.tech") ||
    config.databaseUrl.includes("sslmode=require");

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.maxPoolSize,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? "10000"),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? "30000"),
    keepAlive: true,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined
  });

  // Prevent unhandled 'error' events from crashing the process.
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("pg pool error", err);
  });

  return pool;
}


