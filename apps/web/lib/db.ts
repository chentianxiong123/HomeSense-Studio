// HomeSense v5 — 平台数据库（PostgreSQL）统一连接。
//
// 架构：平台数据（token 用量 pico_usage + 钱包/流水 + 单价/配额）统一存 PG；
// 用户数据（聊天历史 pico_messages）留 per-tenant SQLite。
// 连接串：HOMESENSE_DATABASE_URL，缺省本地 docker hs-pg。

import { Pool, type PoolClient, type QueryResultRow } from "pg"

const DATABASE_URL =
  process.env.HOMESENSE_DATABASE_URL ||
  "postgres://postgres:hsense2026@127.0.0.1:5432/homesense"

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never[] | undefined)
  return res.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | undefined> {
  const rows = await query<T>(text, params)
  return rows[0]
}

/** 事务：fn(cli) 内执行多个查询；任一步抛错则回滚。 */
export async function withTransaction<T>(
  fn: (q: TransactionQuery) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query("BEGIN")
    const run: TransactionQuery = (text, params) =>
      client.query(text, params as never[] | undefined).then((r) => r.rows)
    const result = await fn(run)
    await client.query("COMMIT")
    return result
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

interface TransactionQuery {
  <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>
}

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS pico_usage (
    tenant_id     TEXT NOT NULL,
    session_id    TEXT NOT NULL DEFAULT '',
    model         TEXT NOT NULL DEFAULT '',
    task          TEXT NOT NULL DEFAULT '',
    requests      BIGINT NOT NULL DEFAULT 0,
    input_tokens  BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, session_id, model, task)
);
CREATE INDEX IF NOT EXISTS idx_pico_usage_tenant_last ON pico_usage(tenant_id, last_seen);

CREATE TABLE IF NOT EXISTS wallets (
    tenant_id   TEXT PRIMARY KEY,
    balance_cents BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
    id                 BIGSERIAL PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    kind               TEXT NOT NULL,
    model              TEXT,
    input_tokens       BIGINT NOT NULL DEFAULT 0,
    output_tokens      BIGINT NOT NULL DEFAULT 0,
    amount_cents       BIGINT NOT NULL,
    balance_after_cents BIGINT NOT NULL,
    note               TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant ON wallet_ledger(tenant_id, id DESC);

CREATE TABLE IF NOT EXISTS billing_config (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    model_prices      JSONB NOT NULL DEFAULT '{}'::jsonb,
    monthly_quota     JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_models  JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 旧表若已存在，补列（幂等 ALTER）
ALTER TABLE billing_config ADD COLUMN IF NOT EXISTS published_models JSONB NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO billing_config (id, model_prices, monthly_quota, published_models) VALUES (1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
`

let migratePromise: Promise<void> | null = null

/** 幂等建表；并行调用只跑一次。 */
export async function migrate(): Promise<void> {
  if (!migratePromise) {
    migratePromise = (async () => {
      await pool.query(SCHEMA_DDL)
    })().catch((e) => {
      migratePromise = null
      throw e
    })
  }
  return migratePromise
}