import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SUPABASE_ROOT_CA } from "./supabase-ca";
import * as schema from "./schema";

let pool: Pool | undefined;
const cloudflarePools = new WeakMap<object, Pool>();
const cloudflareContextKey = Symbol.for("__cloudflare-context__");

function getVerifiedWorkerConnectionString(url: string): string {
    const connectionUrl = new URL(url);
    for (const parameter of [
        "ssl",
        "sslmode",
        "sslrootcert",
        "sslcert",
        "sslkey",
        "sslpassword",
        "sslnegotiation",
        "uselibpqcompat",
    ]) {
        connectionUrl.searchParams.delete(parameter);
    }
    return connectionUrl.toString();
}

declare global {
    interface CloudflareEnv {
        MOSAIC_WEB_DATABASE_URL?: string;
    }
}

function getCloudflarePool(): Pool | undefined {
    // OpenNext installs this request-scoped context accessor in the Worker.
    // Keeping Node dev/build behavior available avoids requiring Cloudflare
    // bindings for next dev or static build evaluation.
    if (!(cloudflareContextKey in globalThis)) return undefined;

    const context = getCloudflareContext();
    const request = context.ctx as object;
    const existing = cloudflarePools.get(request);
    if (existing) return existing;

    // OpenNext's local Worker runner exposes .env values on process.env while
    // production secrets are available as Worker bindings.
    const url =
        context.env.MOSAIC_WEB_DATABASE_URL?.trim() ||
        process.env.MOSAIC_WEB_DATABASE_URL?.trim();
    if (!url) throw new Error("MOSAIC_WEB_DATABASE_URL is not set");

    // Workers cannot reuse TCP sockets across requests. The pool is keyed by
    // this request's OpenNext execution context, and retires each connection
    // after one use. Supabase transaction pooler supplies backend pooling.
    const requestPool = new Pool({
        // Don't let URL query options replace the TLS config below. Workers
        // verify the Supabase root and hostname for every Postgres connection.
        connectionString: getVerifiedWorkerConnectionString(url),
        ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
        max: 1,
        maxUses: 1,
        idleTimeoutMillis: 0,
        connectionTimeoutMillis: 5_000,
    });
    cloudflarePools.set(request, requestPool);
    return requestPool;
}

function getPool(): Pool {
    const requestPool = getCloudflarePool();
    if (requestPool) return requestPool;

    if (!pool) {
        // Build-phase fallback only: `next build` evaluates modules without a live
        // DB. Gate strictly on NEXT_PHASE so a runtime process with a missing
        // DATABASE_URL still fails loudly instead of dialing a placeholder.
        const url =
            process.env.MOSAIC_WEB_DATABASE_URL ??
            process.env.DATABASE_URL ??
            (process.env.NEXT_PHASE === "phase-production-build"
                ? "postgres://build:build@127.0.0.1:1/build"
                : undefined);
        if (!url) {
            throw new Error(
                "MOSAIC_WEB_DATABASE_URL or DATABASE_URL is not set",
            );
        }
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
    getPrototypeOf() {
        return Object.getPrototypeOf(getPool());
    },
});

export const db = drizzle(lazyPool, { schema });
export { schema };

export async function closeDatabasePool(): Promise<void> {
    const current = pool;
    pool = undefined;
    if (current) await current.end();
}
