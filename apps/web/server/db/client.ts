import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | undefined;

function getPool(): Pool {
    if (!pool) {
        // Build-phase fallback only: `next build` evaluates modules without a live
        // DB. Gate strictly on NEXT_PHASE so a runtime process with a missing
        // DATABASE_URL still fails loudly instead of dialing a placeholder.
        const url =
            process.env.DATABASE_URL ??
            (process.env.NEXT_PHASE === "phase-production-build"
                ? "postgres://build:build@127.0.0.1:1/build"
                : undefined);
        if (!url) throw new Error("DATABASE_URL is not set");
        pool = new Pool({
            connectionString: url,
            // Production Supabase session pooling is limited to 15 clients.
            // The worker also owns two pg-boss pools, so keep this shared app
            // pool below the remaining connection budget.
            max: 4,
            idleTimeoutMillis: 30_000,
            // Fast-fail instead of hanging when the pool is exhausted.
            connectionTimeoutMillis: 5_000,
        });
    }
    return pool;
}

const lazyPool = new Proxy({} as Pool, {
    get(_target, prop, receiver) {
        const value = Reflect.get(getPool(), prop, receiver);
        return typeof value === "function" ? value.bind(getPool()) : value;
    },
});

export const db = drizzle(lazyPool, { schema });
export { schema };

export async function closeDatabasePool(): Promise<void> {
    const current = pool;
    pool = undefined;
    if (current) await current.end();
}
