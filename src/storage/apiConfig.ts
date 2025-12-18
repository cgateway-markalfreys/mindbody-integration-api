import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, withTransaction } from "../db/mysql.js";

export interface ApiConfig {
  siteKey: string;
  caymanApiKey: string;
  caymanApiUsername: string;
  caymanApiPassword: string;
  mindbodyApiKey?: string;
  mindbodySourceName?: string;
  mindbodySourcePassword?: string;
  mindbodySiteId?: string;
  updatedAt: Date;
}

const TABLE_NAME = "api_configs";

export const ensureApiConfigTable = async (): Promise<void> => {
  // Schema management handled externally; nothing to do here.
};

const projectRow = (row: ApiConfigRow): ApiConfig => ({
  siteKey: row.site_key,
  caymanApiKey: row.cayman_api_key,
  caymanApiUsername: row.cayman_api_username,
  caymanApiPassword: row.cayman_api_password,
  mindbodyApiKey: row.mindbody_api_key ?? undefined,
  mindbodySourceName: row.mindbody_source_name ?? undefined,
  mindbodySourcePassword: row.mindbody_source_password ?? undefined,
  mindbodySiteId: row.mindbody_site_id ?? undefined,
  updatedAt: row.updated_at
});

interface ApiConfigRow extends RowDataPacket {
  site_key: string;
  cayman_api_key: string;
  cayman_api_username: string;
  cayman_api_password: string;
  mindbody_api_key?: string | null;
  mindbody_source_name?: string | null;
  mindbody_source_password?: string | null;
  mindbody_site_id?: string | null;
  updated_at: Date;
}

export const getApiConfig = async (siteKey: string): Promise<ApiConfig | undefined> => {
  await ensureApiConfigTable();
  const rows = await query<ApiConfigRow[]>(
    `SELECT site_key, cayman_api_key, cayman_api_username, cayman_api_password, mindbody_api_key, mindbody_source_name, mindbody_source_password, mindbody_site_id, updated_at FROM ${TABLE_NAME} WHERE site_key = ? LIMIT 1`,
    [siteKey]
  );

  if (!rows.length) {
    return undefined;
  }

  const row = rows[0];
  return projectRow(row);
};

export const getLatestApiConfig = async (): Promise<ApiConfig | undefined> => {
  const rows = await query<ApiConfigRow[]>(
    `SELECT site_key, cayman_api_key, cayman_api_username, cayman_api_password, mindbody_api_key, mindbody_source_name, mindbody_source_password, mindbody_site_id, updated_at FROM ${TABLE_NAME} ORDER BY updated_at DESC LIMIT 1`
  );

  if (!rows.length) {
    return undefined;
  }

  return projectRow(rows[0]);
};

export interface UpsertApiConfigInput {
  siteKey: string;
  caymanApiKey: string;
  caymanApiUsername: string;
  caymanApiPassword: string;
  mindbodyApiKey: string;
  mindbodySourceName: string;
  mindbodySourcePassword: string;
  mindbodySiteId: string;
}

const updateSql = `
  UPDATE ${TABLE_NAME}
  SET
    cayman_api_key = ?,
    cayman_api_username = ?,
    cayman_api_password = ?,
    mindbody_api_key = ?,
    mindbody_source_name = ?,
    mindbody_source_password = ?,
    mindbody_site_id = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE site_key = ?
  LIMIT 1
`;

const insertSql = `
  INSERT INTO ${TABLE_NAME} (
    site_key,
    cayman_api_key,
    cayman_api_username,
    cayman_api_password,
    mindbody_api_key,
    mindbody_source_name,
    mindbody_source_password,
    mindbody_site_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

export const upsertApiConfig = async (input: UpsertApiConfigInput): Promise<ApiConfig> => {
  await ensureApiConfigTable();

  await withTransaction(async (conn: PoolConnection) => {
    const [updateResult] = await conn.execute<ResultSetHeader>(updateSql, [
      input.caymanApiKey,
      input.caymanApiUsername,
      input.caymanApiPassword,
      input.mindbodyApiKey,
      input.mindbodySourceName,
      input.mindbodySourcePassword,
      input.mindbodySiteId,
      input.siteKey
    ]);

    if (updateResult.affectedRows === 0) {
      // No existing row; insert a new one instead of creating duplicates for updates.
      await conn.execute(insertSql, [
        input.siteKey,
        input.caymanApiKey,
        input.caymanApiUsername,
        input.caymanApiPassword,
        input.mindbodyApiKey,
        input.mindbodySourceName,
        input.mindbodySourcePassword,
        input.mindbodySiteId
      ]);
    }
  });

  const config = await getApiConfig(input.siteKey);
  if (!config) {
    throw new Error("Failed to persist API configuration");
  }

  return config;
};
