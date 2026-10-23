import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
    mkdtempSync,
    writeFileSync,
    readFileSync,
    readdirSync,
    existsSync,
    mkdirSync,
    copyFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { root } from "./lib/dev-env.cjs";

test(
    "launcher drains a slow worker and wrappers forward a group signal only once",
    { timeout: 15000 },
    async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "flash-evals-shutdown-"));
        const events = path.join(dir, "events");
        const wrapper = path.join(root, "scripts/node-with-supabase-ca.mjs");
        const fakePnpm = `#!${process.execPath}
const {spawn}=require('node:child_process');
const worker=process.argv.includes('worker');
require('node:fs').appendFileSync(${JSON.stringify(events)},JSON.stringify({event:'config',worker,origin:process.env.FLASH_EVALS_DEV_WEB_ORIGIN,cors:process.env.CORS_ORIGINS})+'\\n');
const source=\`
const fs=require('node:fs');
const log=(event)=>fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify({worker:\${worker},event})+String.fromCharCode(10));
let stopping=false;
process.on('SIGTERM',()=>{if(stopping){log('forced');process.exit(1);}stopping=true;log('term');setTimeout(()=>{log('drained');process.exit(0);},\${worker?2500:0});});
setInterval(()=>{},1000);log('ready');
\`;
const child=spawn(process.execPath,[${JSON.stringify(wrapper)},'--eval',source],{stdio:'inherit'});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',(code)=>process.exit(code??0));
`;
        writeFileSync(path.join(dir, "pnpm"), fakePnpm, { mode: 0o755 });
        const child = spawn(
            process.execPath,
            [path.join(root, "scripts/dev.mjs"), "--port", "4000"],
            {
                cwd: root,
                env: {
                    ...process.env,
                    PATH: `${dir}:${process.env.PATH}`,
                    FLASH_EVALS_PACKAGES_BUILT: "1",
                    CORS_ORIGINS: "",
                },
                stdio: "pipe",
            },
        );
        const completion = once(child, "exit");
        let output = "";
        child.stdout.on("data", (chunk) => {
            output += chunk;
        });
        child.stderr.on("data", (chunk) => {
            output += chunk;
        });
        try {
            const deadline = Date.now() + 5000;
            while (
                !existsSync(events) ||
                readFileSync(events, "utf8")
                    .trim()
                    .split("\n")
                    .map(JSON.parse)
                    .filter((row) => row.event === "ready").length < 3
            ) {
                assert(
                    Date.now() < deadline,
                    output || "Children did not become ready",
                );
                await delay(30);
            }
            const start = Date.now();
            child.kill("SIGTERM");
            const [code] = await completion;
            assert.equal(code, 143, output);
            assert(
                Date.now() - start >= 2400,
                "Worker was killed before draining",
            );
            const rows = readFileSync(events, "utf8")
                .trim()
                .split("\n")
                .map(JSON.parse);
            assert.equal(
                rows.filter((r) => r.worker && r.event === "term").length,
                1,
            );
            assert(rows.some((r) => r.worker && r.event === "drained"));
            assert(!rows.some((r) => r.event === "forced"));
            const origin = rows.find(
                (row) => row.event === "config" && !row.worker && row.origin,
            )?.origin;
            const cors = rows.find(
                (row) => row.event === "config" && row.cors,
            )?.cors;
            assert.equal(new URL(origin).port, "4000");
            assert(cors.split(",").includes(origin));
        } finally {
            child.kill("SIGTERM");
            await completion;
            rmSync(dir, { recursive: true, force: true });
        }
    },
);

test("failed database backup resumes development and publishes no incomplete snapshot", {
    // backup-dev.sh needs util-linux flock and bash 4; it is Linux-only.
    skip: process.platform !== "linux" && "backup helper is Linux-only",
}, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "flash-evals-backup-"));
    try {
        for (const folder of ["scripts/lib", "apps/api", "apps/web", "bin"])
            mkdirSync(path.join(dir, folder), { recursive: true });
        for (const file of [
            "scripts/backup-dev.sh",
            "scripts/lib/dev-env.cjs",
            "scripts/lib/dev-host.cjs",
        ])
            copyFileSync(path.join(root, file), path.join(dir, file));
        const url =
            "postgres://synthetic:synthetic@localhost:54322/flash_evals";
        writeFileSync(
            path.join(dir, "apps/api/.env"),
            `DATABASE_URL=${url}\nFLASH_EVALS_STORAGE_ADAPTER=local\n`,
        );
        writeFileSync(
            path.join(dir, "apps/web/.env"),
            `FLASH_EVALS_WEB_DATABASE_URL=${url}\n`,
        );
        writeFileSync(
            path.join(dir, "bin/systemctl"),
            '#!/bin/sh\ncase "$*" in *show*) echo active;; *stop*) echo stop >> "$FLASH_EVALS_TEST_EVENTS";; *start*) echo start >> "$FLASH_EVALS_TEST_EVENTS";; esac\n',
            { mode: 0o755 },
        );
        writeFileSync(path.join(dir, "bin/docker"), "#!/bin/sh\nexit 1\n", {
            mode: 0o755,
        });
        const events = path.join(dir, "events");
        const result = spawnSync(
            "bash",
            [path.join(dir, "scripts/backup-dev.sh")],
            {
                env: {
                    ...process.env,
                    PATH: `${dir}/bin:${process.env.PATH}`,
                    FLASH_EVALS_TEST_EVENTS: events,
                },
                encoding: "utf8",
            },
        );
        assert.equal(result.status, 1);
        assert.equal(readFileSync(events, "utf8"), "stop\nstart\n");
        assert(!result.stdout.includes("Private backup saved"));
        assert.deepEqual(readdirSync(path.join(dir, ".dev.local/backups")), [
            ".lock",
        ]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
