import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    copyFileSync,
    readFileSync,
    writeFileSync,
    existsSync,
    statSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import test from "node:test";
import { root } from "./lib/dev-env.cjs";

function checkout(t) {
    const dir = mkdtempSync(path.join(tmpdir(), "flash-evals-setup-"));
    for (const folder of ["scripts/lib", "apps/api", "apps/web"])
        mkdirSync(path.join(dir, folder), { recursive: true });
    for (const file of ["scripts/setup-local.mjs", "scripts/lib/dev-host.cjs"])
        copyFileSync(path.join(root, file), path.join(dir, file));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function setup(dir, ...args) {
    return spawnSync(
        process.execPath,
        [path.join(dir, "scripts/setup-local.mjs"), ...args],
        { cwd: tmpdir(), encoding: "utf8" },
    );
}

for (const host of ["127.0.0.1", "100.64.0.10"]) {
    test(`fresh configuration works for ${host} without cloud credentials`, (t) => {
        const dir = checkout(t);
        const result = setup(dir, "--host", host);
        assert.equal(result.status, 0, result.stderr);
        const apiFile = path.join(dir, "apps/api/.env");
        const webFile = path.join(dir, "apps/web/.env");
        const api = parseEnv(readFileSync(apiFile, "utf8"));
        const web = parseEnv(readFileSync(webFile, "utf8"));
        assert.equal(api.DATABASE_URL, web.FLASH_EVALS_WEB_DATABASE_URL);
        assert.equal(api.INTERNAL_API_TOKEN, web.INTERNAL_API_TOKEN);
        assert.equal(Buffer.from(api.INTERNAL_API_TOKEN, "base64").length, 32);
        assert.equal(
            Buffer.from(api.FLASH_EVALS_SECRETS_ENC_KEY, "base64").length,
            32,
        );
        assert.equal(api.FLASH_EVALS_API_BIND_HOST, host);
        assert.equal(web.FLASH_EVALS_DEV_BIND_HOST, host);
        assert.equal(api.FLASH_EVALS_API_PUBLIC_URL, web.API_BASE_URL);
        assert.equal(web.API_BASE_URL, web.NEXT_PUBLIC_API_BASE_URL);
        assert.equal(api.CORS_ORIGINS, web.FLASH_EVALS_DEV_WEB_ORIGIN);
        assert.equal(api.FLASH_EVALS_TENANCY_MODE, "isolated");
        assert.equal(web.FLASH_EVALS_TENANCY_MODE, "isolated");
        assert.equal(api.FLASH_EVALS_MAX_RUN_CELLS, "50");
        assert.equal(api.FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD, "2");
        assert.equal(api.OPENROUTER_API_KEY, "");
        assert.equal(statSync(apiFile).mode & 0o777, 0o600);
        assert.equal(statSync(webFile).mode & 0o777, 0o600);
        assert(!result.stdout.includes(api.INTERNAL_API_TOKEN));
        assert(!result.stdout.includes(api.FLASH_EVALS_SECRETS_ENC_KEY));
        assert(result.stdout.includes(`http://${host}:3000`));
        assert(result.stdout.includes("node scripts/build-packages.mjs"));
    });
}

for (const existing of ["api", "web"]) {
    test(`existing ${existing} configuration is preserved without creating its counterpart`, (t) => {
        const dir = checkout(t);
        const file = path.join(dir, `apps/${existing}/.env`);
        writeFileSync(file, "KEEP_EXISTING_CONFIGURATION=true\n", {
            mode: 0o600,
        });
        const result = setup(dir);
        assert.equal(result.status, 1);
        assert.equal(
            readFileSync(file, "utf8"),
            "KEEP_EXISTING_CONFIGURATION=true\n",
        );
        assert(
            !existsSync(
                path.join(
                    dir,
                    `apps/${existing === "api" ? "web" : "api"}/.env`,
                ),
            ),
        );
    });
}

test("public host binding is rejected and help makes no files", (t) => {
    const dir = checkout(t);
    assert.notEqual(setup(dir, "--host", "0.0.0.0").status, 0);
    assert.equal(setup(dir, "--help").status, 0);
    assert(!existsSync(path.join(dir, "apps/api/.env")));
    assert(!existsSync(path.join(dir, "apps/web/.env")));
});
