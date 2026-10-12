import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

let pool: Pool | undefined;
const cloudflarePools = new WeakMap<object, Pool>();
const cloudflareContextKey = Symbol.for("__cloudflare-context__");

declare global {
    interface CloudflareEnv {
        HYPERDRIVE?: { connectionString: string };
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

    const connectionString = context.env.HYPERDRIVE?.connectionString?.trim();
    if (!connectionString) {
        throw new Error("HYPERDRIVE binding is not configured");
    }

    // Workers cannot reuse TCP sockets across requests. The request-scoped
    // client connects to Hyperdrive, which owns the upstream pool. Its resource
    // must use verify-full for the Supabase origin. Do not configure driver TLS
    // here: this socket terminates at Hyperdrive, not at Supabase.
    const requestPool = new Pool({
        connectionString,
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
