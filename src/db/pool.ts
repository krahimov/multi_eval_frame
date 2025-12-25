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
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.maxPoolSize
  });
}


