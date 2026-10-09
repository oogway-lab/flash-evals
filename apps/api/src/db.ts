import pg from "pg";
import type { IApiConfig } from "./config.js";

export interface IDb {
    query<T extends pg.QueryResultRow = pg.QueryResultRow>(
        text: string,
        values?: unknown[],
    ): Promise<pg.QueryResult<T>>;
}

export interface ITransactionalDb extends IDb {
    transaction<T>(run: (tx: IDb) => Promise<T>): Promise<T>;
}

export function isTransactionalDb(db: IDb): db is ITransactionalDb {
    return "transaction" in db && typeof db.transaction === "function";
}

export function withTransaction<T>(
    db: IDb,
    run: (tx: IDb) => Promise<T>,
): Promise<T> {
    return isTransactionalDb(db) ? db.transaction(run) : run(db);
}

export function createDb(config: IApiConfig): ITransactionalDb {
    const pool = new pg.Pool({
        connectionString: config.databaseUrl,
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });
    return {
        query: (text, values) => pool.query(text, values),
        async transaction(run) {
            const client = await pool.connect();
            try {
                await client.query("begin");
                const result = await run({
                    query: (text, values) => client.query(text, values),
                });
                await client.query("commit");
                return result;
            } catch (err) {
                await client.query("rollback");
                throw err;
            } finally {
                client.release();
            }
        },
    };
}
