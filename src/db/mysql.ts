import mysql, { Pool, PoolConnection, PoolOptions, ResultSetHeader, RowDataPacket } from "mysql2/promise";

interface ParsedUrlConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
}

interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

let pool: Pool | undefined;

const verifyPoolConnection = async (createdPool: Pool): Promise<void> => {
  const connection = await createdPool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
};

const parseDatabaseUrl = (): ParsedUrlConfig => {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.trim()) {
    return {};
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "mysql:") {
      throw new Error("DATABASE_URL must use the mysql:// scheme");
    }

    const hostname = parsed.hostname || undefined;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : undefined;
    const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, "") : undefined;

    const searchParams = parsed.searchParams;
    const poolSizeRaw =
      searchParams.get("pool") ??
      searchParams.get("poolSize") ??
      searchParams.get("connectionLimit") ??
      undefined;
    const connectionLimit = poolSizeRaw ? Number.parseInt(poolSizeRaw, 10) : undefined;

    return {
      host: hostname,
      port: Number.isFinite(port) && port ? port : undefined,
      user,
      password,
      database,
      connectionLimit: Number.isFinite(connectionLimit) && (connectionLimit as number) > 0 ? connectionLimit : undefined
    } satisfies ParsedUrlConfig;
  } catch (error) {
    console.error("[mysql] Failed to parse DATABASE_URL", error);
    throw error;
  }
};

const getConfig = (): MysqlConfig => {
  const urlConfig = parseDatabaseUrl();

  const host = urlConfig.host ?? process.env.MYSQL_HOST ?? "localhost";
  const port = urlConfig.port ?? Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10);
  const user = urlConfig.user ?? process.env.MYSQL_USER ?? process.env.MYSQL_USERNAME ?? "root";
  const password = urlConfig.password ?? process.env.MYSQL_PASSWORD ?? "";
  const database = urlConfig.database ?? process.env.MYSQL_DATABASE ?? "cg_integration";
  const connectionLimitEnv = Number.parseInt(process.env.MYSQL_POOL_SIZE ?? "10", 10);
  const connectionLimit = urlConfig.connectionLimit ?? connectionLimitEnv;

  if (!user) {
    throw new Error("Database user is required (set via DATABASE_URL or MYSQL_USER)");
  }

  if (!database) {
    throw new Error("Database name is required (set via DATABASE_URL or MYSQL_DATABASE)");
  }

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Database port must be a positive integer");
  }

  return {
    host,
    port,
    user,
    password,
    database,
    connectionLimit: Number.isFinite(connectionLimit) && connectionLimit > 0 ? connectionLimit : 10
  };
};

const createPool = (): Pool => {
  const config = getConfig();
  const options: PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    queueLimit: 0
  };

  const createdPool = mysql.createPool(options);

  console.log(`[mysql] Attempting MySQL connection to ${config.host}:${config.port}/${config.database}`);

  verifyPoolConnection(createdPool)
    .then(() => {
      console.log(`[mysql] Connected to ${config.host}:${config.port}/${config.database}`);
    })
    .catch((error) => {
      console.error(`[mysql] Failed to establish initial database connection to ${config.host}:${config.port}/${config.database}`, error);
    });

  return createdPool;
};

export const getPool = (): Pool => {
  if (!pool) {
    pool = createPool();
  }
  return pool;
};

export const query = async <T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> => {
  const [rows] = await getPool().query<RowDataPacket[]>(sql, params);
  return rows as T;
};

export const execute = async <T extends ResultSetHeader | RowDataPacket[] = ResultSetHeader>(sql: string, params: unknown[] = []): Promise<T> => {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params);
  return result as T;
};

export const withConnection = async <R>(handler: (conn: PoolConnection) => Promise<R>): Promise<R> => {
  const connection = await getPool().getConnection();
  try {
    return await handler(connection);
  } finally {
    connection.release();
  }
};

export const withTransaction = async <R>(handler: (conn: PoolConnection) => Promise<R>): Promise<R> => {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await handler(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
};
