import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root } from "./lib/dev-env.cjs";

function run(command, args) {
    const result = spawnSync(command, args, { stdio: "inherit", cwd: root });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

// Pin the installed Node directory rather than following the updater's symlink.
const node = realpathSync(process.execPath);
const runtimePath = `${path.dirname(node)}:${homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`;
const quote = (value) => JSON.stringify(value.replaceAll("%", "%%"));
const unitDir = path.join(homedir(), ".config/systemd/user");
mkdirSync(unitDir, { recursive: true });
const common = `WorkingDirectory=${root.replaceAll("%", "%%")}
Environment=${quote(`PATH=${runtimePath}`)}
UMask=0077`;

writeFileSync(
    path.join(unitDir, "flash-evals-dev.service"),
    `[Unit]
Description=Flash Evals development web, API and worker
StartLimitIntervalSec=0

[Service]
Type=exec
${common}
ExecStartPre=${quote(node)} ${quote(path.join(root, "scripts/dev-ready.mjs"))}
# This is the same launcher as pnpm run dev. Make it the main process so it
# stays alive throughout worker draining instead of a pnpm wrapper exiting early.
ExecStart=${quote(node)} ${quote(path.join(root, "scripts/dev.mjs"))}
Restart=on-failure
RestartSec=10
KillMode=mixed
TimeoutStartSec=180
TimeoutStopSec=330

[Install]
WantedBy=default.target
`,
);
writeFileSync(
    path.join(unitDir, "flash-evals-backup.service"),
    `[Unit]
Description=Private Flash Evals development snapshot

[Service]
Type=oneshot
${common}
ExecStart=/usr/bin/bash ${quote(path.join(root, "scripts/backup-dev.sh"))}
TimeoutStartSec=15min
`,
);
writeFileSync(
    path.join(unitDir, "flash-evals-backup.timer"),
    `[Unit]
Description=Daily Flash Evals development snapshot

[Timer]
# Host local time; contributors override the schedule with a timer drop-in.
OnCalendar=*-*-* 04:00:00
# Avoid an unexpected pause while working after a missed backup or reboot.
Persistent=false
Unit=flash-evals-backup.service

[Install]
WantedBy=timers.target
`,
);

// Validate the files before stopping a running application.
run("systemd-analyze", [
    "--user",
    "verify",
    path.join(unitDir, "flash-evals-dev.service"),
    path.join(unitDir, "flash-evals-backup.service"),
    path.join(unitDir, "flash-evals-backup.timer"),
]);
// Stop the old transient unit only after the persistent files are in place.
const existing = spawnSync(
    "systemctl",
    [
        "--user",
        "show",
        "flash-evals-dev.service",
        "-p",
        "ActiveState",
        "--value",
    ],
    { encoding: "utf8" },
);
if (
    ["active", "activating", "reloading", "deactivating"].includes(
        existing.stdout.trim(),
    )
) {
    run("systemctl", ["--user", "stop", "flash-evals-dev.service"]);
}
run("systemctl", ["--user", "daemon-reload"]);
run("systemctl", [
    "--user",
    "enable",
    "--now",
    "flash-evals-dev.service",
    "flash-evals-backup.timer",
]);
console.info(
    "Installed persistent development service and daily 04:00 (host local time) backup. Node: " +
        node,
);
