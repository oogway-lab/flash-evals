import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const localCheck = path.join(root, "scripts/check-split-deployment-readiness.sh");
const liveCheck = path.join(root, "scripts/check-live-split-deployment-readiness.sh");
const r2Origin =
    "https://mosaic-media.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
const testSecret = "synthetic-secret-never-print-this";

function makeR2Env(kind, prefix = "flash-evals") {
    const common =
        kind === "api"
            ? {
                  DATABASE_URL: "postgres://synthetic:synthetic@db.example.test:5432/test",
                  CLERK_SECRET_KEY: "sk_test_synthetic",
                  MOSAIC_ALLOWED_EMAIL_DOMAIN: "example.test",
                  CORS_ORIGINS: "https://app.example.test",
                  MOSAIC_API_START_WORKER: "false",
              }
            : {
                  NEXT_PUBLIC_API_BASE_URL: "https://api.example.test",
                  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic",
                  CLERK_SECRET_KEY: "sk_test_synthetic",
              };
    return {
        ...common,
        NODE_ENV: "production",
        INTERNAL_API_TOKEN: "synthetic-internal-token",
        MOSAIC_STORAGE_ADAPTER: "r2",
        R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        R2_ACCESS_KEY_ID: "synthetic-access-id",
        R2_SECRET_ACCESS_KEY: testSecret,
        R2_BUCKET: "mosaic-media",
        R2_STORAGE_PREFIX: prefix,
        ...(kind === "web" ? { MOSAIC_CSP_STORAGE_ORIGIN: r2Origin } : {}),
    };
}

function makeSupabaseEnv(kind, prefix = "flash-evals") {
    const common =
        kind === "api"
            ? {
                  DATABASE_URL: "postgres://synthetic:synthetic@db.example.test:5432/test",
                  CLERK_SECRET_KEY: "sk_test_synthetic",
                  MOSAIC_ALLOWED_EMAIL_DOMAIN: "example.test",
                  CORS_ORIGINS: "https://app.example.test",
                  MOSAIC_API_START_WORKER: "false",
              }
            : {
                  NEXT_PUBLIC_API_BASE_URL: "https://api.example.test",
                  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic",
                  CLERK_SECRET_KEY: "sk_test_synthetic",
              };
    return {
        ...common,
        NODE_ENV: "production",
        INTERNAL_API_TOKEN: "synthetic-internal-token",
        MOSAIC_STORAGE_ADAPTER: "supabase",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-supabase-service-role",
        SUPABASE_STORAGE_BUCKET: "mosaic-private",
        SUPABASE_STORAGE_PREFIX: prefix,
        ...(kind === "web"
            ? { MOSAIC_CSP_STORAGE_ORIGIN: "https://project.supabase.co" }
            : {}),
    };
}

function withTempDir(callback) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-readiness-test-"));
    try {
        return callback(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function writeEnv(file, env) {
    fs.writeFileSync(
        file,
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n",
        { mode: 0o600 },
    );
}

function runLocal(apiEnv, webEnv) {
    return withTempDir((dir) => {
        const apiFile = path.join(dir, "api.env");
        const webFile = path.join(dir, "web.env");
        writeEnv(apiFile, apiEnv);
        writeEnv(webFile, webEnv);
        return spawnSync("bash", [localCheck], {
            cwd: root,
            encoding: "utf8",
            env: { ...process.env, API_ENV: apiFile, WEB_ENV: webFile },
        });
    });
}

function makeLiveFixture(dir, apiEnv, workerEnv, webEnv) {
    const apiFile = path.join(dir, "api-variables.json");
    const workerFile = path.join(dir, "worker-variables.json");
    const webFile = path.join(dir, "cloudflare.env");
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(binDir);
    fs.writeFileSync(apiFile, railwayJson(apiEnv), { mode: 0o600 });
    fs.writeFileSync(workerFile, railwayJson(workerEnv), { mode: 0o600 });
    writeEnv(webFile, webEnv);

    const railway = path.join(binDir, "railway");
    fs.writeFileSync(
        railway,
        `#!/bin/sh\nservice=\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--service" ]; then service="$2"; shift 2; else shift; fi\ndone\nprintf '%s\\n' "$service" >> "$MOCK_RAILWAY_CALL_LOG"\ncase "$service" in\n  api) cat "$MOCK_RAILWAY_API_FILE" ;;\n  worker) cat "$MOCK_RAILWAY_WORKER_FILE" ;;\n  *) exit 4 ;;\nesac\n`,
        { mode: 0o700 },
    );
    const wrangler = path.join(dir, "wrangler-mock");
    fs.writeFileSync(wrangler, "#!/bin/sh\n[ \"$1\" = whoami ]\n", { mode: 0o700 });
    return { apiFile, workerFile, webFile, binDir, wrangler };
}

function railwayJson(env) {
    return JSON.stringify(
        Object.entries(env).map(([name, value]) => ({ name, value })),
    );
}

function runLive(apiEnv, workerEnv, webEnv) {
    return withTempDir((dir) => {
        const fixture = makeLiveFixture(dir, apiEnv, workerEnv, webEnv);
        const callLog = path.join(dir, "railway-calls.log");
        const result = spawnSync("bash", [liveCheck], {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${fixture.binDir}:${process.env.PATH}`,
                RAILWAY_PROJECT_ID: "synthetic-project",
                RAILWAY_ENVIRONMENT: "production",
                RAILWAY_API_SERVICE: "api",
                RAILWAY_WORKER_SERVICE: "worker",
                CLOUDFLARE_WEB_ENV: fixture.webFile,
                WRANGLER_BIN: fixture.wrangler,
                MOCK_RAILWAY_API_FILE: fixture.apiFile,
                MOCK_RAILWAY_WORKER_FILE: fixture.workerFile,
                MOCK_RAILWAY_CALL_LOG: callLog,
            },
        });
        return {
            result,
            calls: fs.existsSync(callLog)
                ? fs.readFileSync(callLog, "utf8").trim().split(/\r?\n/)
                : [],
        };
    });
}

test("local check accepts R2 without any Supabase storage variables", () => {
    const result = runLocal(makeR2Env("api"), makeR2Env("web"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Split deployment readiness check passed/);
    assert.doesNotMatch(result.stdout + result.stderr, /SUPABASE_(?:URL|SERVICE_ROLE_KEY|STORAGE_BUCKET)/);
});

test("local check keeps the Supabase adapter requirements", () => {
    const api = makeSupabaseEnv("api");
    api.SUPABASE_URL += "/";
    const result = runLocal(api, makeSupabaseEnv("web"));
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const invalidUrl = makeSupabaseEnv("web");
    invalidUrl.SUPABASE_URL += "/unexpected-path";
    const invalid = runLocal(makeSupabaseEnv("api"), invalidUrl);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /SUPABASE_URL must be a project origin/);

    const web = makeSupabaseEnv("web");
    delete web.SUPABASE_SERVICE_ROLE_KEY;
    const missing = runLocal(makeSupabaseEnv("api"), web);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Web environment is missing SUPABASE_SERVICE_ROLE_KEY/);
});

test("local check rejects noncanonical Supabase prefixes even when services agree", () => {
    const api = makeSupabaseEnv("api", "/flash-evals/");
    const web = makeSupabaseEnv("web", "/flash-evals/");
    const result = runLocal(api, web);
    assert.notEqual(result.status, 0);
    assert.match(
        result.stderr,
        /API environment SUPABASE_STORAGE_PREFIX must be canonical/,
    );
    assert.match(
        result.stderr,
        /Web environment SUPABASE_STORAGE_PREFIX must be canonical/,
    );
});

test("local check rejects mismatched internal tokens without disclosure", () => {
    const api = makeR2Env("api");
    const web = makeR2Env("web");
    api.INTERNAL_API_TOKEN = "api-only-synthetic-token";
    web.INTERNAL_API_TOKEN = "web-only-synthetic-token";
    const result = runLocal(api, web);
    assert.notEqual(result.status, 0);
    assert.match(
        result.stdout + result.stderr,
        /apps\/api\/\.env and apps\/web\/\.env INTERNAL_API_TOKEN values do not match/,
    );
    assert.doesNotMatch(
        result.stdout + result.stderr,
        /api-only-synthetic-token|web-only-synthetic-token/,
    );
});

test("local check reports missing R2 keys without printing configured secrets", () => {
    const api = makeR2Env("api");
    delete api.R2_SECRET_ACCESS_KEY;
    const result = runLocal(api, makeR2Env("web"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /API environment is missing R2_SECRET_ACCESS_KEY/);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-never-print-this/);

    const blankApi = makeR2Env("api");
    blankApi.R2_ACCESS_KEY_ID = "   ";
    const blankResult = runLocal(blankApi, makeR2Env("web"));
    assert.notEqual(blankResult.status, 0);
    assert.match(blankResult.stderr, /API environment is missing R2_ACCESS_KEY_ID/);
    assert.doesNotMatch(blankResult.stdout + blankResult.stderr, /synthetic-secret-never-print-this/);
});

test("local check rejects adapter, prefix, and CSP-origin mismatches", () => {
    const web = makeR2Env("web", "different-prefix");
    web.MOSAIC_CSP_STORAGE_ORIGIN = "https://wrong.example.test";
    const result = runLocal(makeR2Env("api"), web);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /R2_STORAGE_PREFIX does not match/);
    assert.match(result.stderr, /MOSAIC_CSP_STORAGE_ORIGIN does not match/);

    const wrongAdapter = makeSupabaseEnv("web");
    const adapterResult = runLocal(makeR2Env("api"), wrongAdapter);
    assert.notEqual(adapterResult.status, 0);
    assert.match(adapterResult.stderr, /storage adapter does not match/);
});

test("local check rejects local and insecure deployment modes", () => {
    const localApi = makeR2Env("api");
    localApi.MOSAIC_STORAGE_ADAPTER = "local";
    const localResult = runLocal(localApi, makeR2Env("web"));
    assert.notEqual(localResult.status, 0);
    assert.match(localResult.stderr, /must not use the local storage adapter/);

    const insecureApi = makeR2Env("api");
    insecureApi.MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS = "true";
    const insecureResult = runLocal(insecureApi, makeR2Env("web"));
    assert.notEqual(insecureResult.status, 0);
    assert.match(insecureResult.stderr, /must not enable MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS/);

    const authBypassWeb = makeR2Env("web");
    authBypassWeb.AUTH_DEV = "true";
    authBypassWeb.AUTH_DEV_ALLOW_INSECURE = "1";
    const authResult = runLocal(makeR2Env("api"), authBypassWeb);
    assert.notEqual(authResult.status, 0);
    assert.match(authResult.stderr, /local AUTH_DEV bypass settings/);

    const localEndpointApi = makeR2Env("api");
    localEndpointApi.R2_ENDPOINT = "http://127.0.0.1:9000";
    const endpointResult = runLocal(localEndpointApi, makeR2Env("web"));
    assert.notEqual(endpointResult.status, 0);
    assert.match(endpointResult.stderr, /local-test-only R2_ENDPOINT/);
});

test("live check reads separate API and worker Railway services with R2 only", () => {
    const { result, calls } = runLive(
        makeR2Env("api"),
        makeR2Env("api"),
        makeR2Env("web"),
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Live split deployment readiness check passed/);
    assert.match(result.stdout, /worker uses pnpm run worker with no HTTP health check/);
    assert.deepEqual(calls, ["api", "worker"]);
    assert.doesNotMatch(result.stdout + result.stderr, /SUPABASE_(?:URL|SERVICE_ROLE_KEY|STORAGE_BUCKET)/);
});

test("live check accepts consistent Supabase configuration", () => {
    const { result } = runLive(
        makeSupabaseEnv("api"),
        makeSupabaseEnv("api"),
        makeSupabaseEnv("web"),
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("live check rejects a Supabase API prefix that only matches after normalization", () => {
    const api = makeSupabaseEnv("api", "/flash-evals/");
    const worker = makeSupabaseEnv("api", "flash-evals");
    const web = makeSupabaseEnv("web", "flash-evals");
    const { result } = runLive(api, worker, web);
    assert.notEqual(result.status, 0);
    assert.match(
        result.stderr,
        /Railway API service SUPABASE_STORAGE_PREFIX must be canonical/,
    );
});

test("live check requires matching API and web internal tokens without disclosure", () => {
    const web = makeR2Env("web");
    web.INTERNAL_API_TOKEN = "different-synthetic-internal-token";
    const { result } = runLive(makeR2Env("api"), makeR2Env("api"), web);
    assert.notEqual(result.status, 0);
    assert.match(
        result.stderr,
        /Railway API service and Cloudflare web environment INTERNAL_API_TOKEN values do not match/,
    );
    assert.doesNotMatch(
        result.stdout + result.stderr,
        /synthetic-internal-token|different-synthetic-internal-token/,
    );
});

test("live check fails closed on malformed Railway JSON", () => {
    return withTempDir((dir) => {
        const fixture = makeLiveFixture(
            dir,
            makeR2Env("api"),
            makeR2Env("api"),
            makeR2Env("web"),
        );
        fs.writeFileSync(fixture.apiFile, "not-json", { mode: 0o600 });
        const result = spawnSync("bash", [liveCheck], {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${fixture.binDir}:${process.env.PATH}`,
                RAILWAY_PROJECT_ID: "synthetic-project",
                RAILWAY_ENVIRONMENT: "production",
                RAILWAY_API_SERVICE: "api",
                RAILWAY_WORKER_SERVICE: "worker",
                CLOUDFLARE_WEB_ENV: fixture.webFile,
                WRANGLER_BIN: fixture.wrangler,
                MOCK_RAILWAY_API_FILE: fixture.apiFile,
                MOCK_RAILWAY_WORKER_FILE: fixture.workerFile,
            },
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Railway API service returned malformed variable JSON/);
        assert.doesNotMatch(
            result.stdout + result.stderr,
            /synthetic-internal-token|synthetic-secret-never-print-this/,
        );
    });
});

test("live check rejects missing, mismatched, and insecure Railway values without disclosure", () => {
    const workerMissing = makeR2Env("api");
    delete workerMissing.R2_SECRET_ACCESS_KEY;
    const missing = runLive(makeR2Env("api"), workerMissing, makeR2Env("web"));
    assert.notEqual(missing.result.status, 0);
    assert.match(missing.result.stderr, /Railway worker service is missing R2_SECRET_ACCESS_KEY/);
    assert.doesNotMatch(missing.result.stdout + missing.result.stderr, /synthetic-secret-never-print-this/);

    const workerMismatch = makeR2Env("api", "other-prefix");
    const mismatch = runLive(makeR2Env("api"), workerMismatch, makeR2Env("web"));
    assert.notEqual(mismatch.result.status, 0);
    assert.match(mismatch.result.stderr, /Railway worker service R2_STORAGE_PREFIX does not match/);

    const insecureApi = makeR2Env("api");
    insecureApi.MOSAIC_API_START_WORKER = "true";
    insecureApi.MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS = "true";
    const insecure = runLive(insecureApi, makeR2Env("api"), makeR2Env("web"));
    assert.notEqual(insecure.result.status, 0);
    assert.match(insecure.result.stderr, /MOSAIC_API_START_WORKER=false/);
    assert.match(insecure.result.stderr, /must not enable MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS/);
});

test("live check rejects a same-service API/worker topology", () => {
    return withTempDir((dir) => {
        const fixture = makeLiveFixture(dir, makeR2Env("api"), makeR2Env("api"), makeR2Env("web"));
        const result = spawnSync("bash", [liveCheck], {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                RAILWAY_PROJECT_ID: "synthetic-project",
                RAILWAY_API_SERVICE: "api",
                RAILWAY_WORKER_SERVICE: "api",
                CLOUDFLARE_WEB_ENV: fixture.webFile,
                WRANGLER_BIN: fixture.wrangler,
            },
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /must identify separate services/);
    });
});
