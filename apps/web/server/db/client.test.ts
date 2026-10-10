import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    context: undefined as
        | {
              env: { HYPERDRIVE?: { connectionString: string } };
              ctx: object;
          }
        | undefined,
    pools: [] as Array<{
        options: unknown;
        query: ReturnType<typeof vi.fn>;
        connect: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock("@opennextjs/cloudflare", () => ({
    getCloudflareContext: () => {
        if (!state.context) throw new Error("No Cloudflare request context");
        return state.context;
    },
}));

vi.mock("pg", () => ({
    Pool: class MockPool {
        readonly options: unknown;
        readonly query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
        readonly connect = vi.fn(async () => ({
            query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
            release: vi.fn(),
        }));
        readonly end = vi.fn(async () => undefined);

        constructor(options: unknown) {
            this.options = options;
            state.pools.push(this);
        }
    },
}));

const cloudflareContextKey = Symbol.for("__cloudflare-context__");
const originalWebDatabaseUrl = process.env.MOSAIC_WEB_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;

function useCloudflareContext(
    connectionString: string | undefined,
    request = {},
): void {
    state.context = {
        env: connectionString ? { HYPERDRIVE: { connectionString } } : {},
        ctx: request,
    };
    Object.defineProperty(globalThis, cloudflareContextKey, {
        configurable: true,
        value: state.context,
    });
}

describe("web database client", () => {
    beforeEach(() => {
        vi.resetModules();
        state.context = undefined;
        state.pools.length = 0;
        Reflect.deleteProperty(globalThis, cloudflareContextKey);
        delete process.env.MOSAIC_WEB_DATABASE_URL;
        delete process.env.DATABASE_URL;
    });

    afterEach(() => {
        if (originalWebDatabaseUrl === undefined) {
            delete process.env.MOSAIC_WEB_DATABASE_URL;
        } else {
            process.env.MOSAIC_WEB_DATABASE_URL = originalWebDatabaseUrl;
        }
        if (originalDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = originalDatabaseUrl;
        }
        Reflect.deleteProperty(globalThis, cloudflareContextKey);
    });

    it("uses Hyperdrive through a one-use pool bound to the current Worker request", async () => {
        useCloudflareContext(
            "postgres://hyperdrive.internal:5432/postgres",
            {},
        );
        const { db } = await import("./client");

        await db.execute(sql.raw("SELECT 1"));
        await db.execute(sql.raw("SELECT 2"));

        expect(state.pools).toHaveLength(1);
        expect(state.pools[0]?.options).toEqual({
            connectionString: "postgres://hyperdrive.internal:5432/postgres",
            max: 1,
            maxUses: 1,
            idleTimeoutMillis: 0,
            connectionTimeoutMillis: 5_000,
        });

        useCloudflareContext("postgres://hyperdrive.internal:5432/second", {});
        await db.execute(sql.raw("SELECT 3"));

        expect(state.pools).toHaveLength(2);
        expect(state.pools[1]?.options).toMatchObject({
            maxUses: 1,
            connectionString: "postgres://hyperdrive.internal:5432/second",
        });
    });

    it("fails closed when a Worker request has no database binding", async () => {
        process.env.MOSAIC_WEB_DATABASE_URL = "postgres://must-not-fallback";
        process.env.DATABASE_URL = "postgres://must-not-fallback";
        useCloudflareContext(undefined);
        await expect(import("./client")).rejects.toThrow(
            "HYPERDRIVE binding is not configured",
        );
        expect(state.pools).toHaveLength(0);
    });

    it("keeps a Drizzle transaction on one request-scoped client", async () => {
        useCloudflareContext(
            "postgres://hyperdrive.internal:5432/postgres",
            {},
        );
        const { db } = await import("./client");

        await db.transaction(async (transaction) => {
            await transaction.execute(sql.raw("SELECT 1"));
        });

        expect(state.pools).toHaveLength(1);
        expect(state.pools[0]?.connect).toHaveBeenCalledOnce();
    });

    it("keeps Node processes on the existing bounded pool", async () => {
        process.env.MOSAIC_WEB_DATABASE_URL = "postgres://local-web-node";
        process.env.DATABASE_URL = "postgres://local-node";
        const { db } = await import("./client");

        await db.execute(sql.raw("SELECT 1"));

        expect(state.pools).toHaveLength(1);
        expect(state.pools[0]?.options).toMatchObject({
            connectionString: "postgres://local-web-node",
            max: 4,
        });
    });
});
