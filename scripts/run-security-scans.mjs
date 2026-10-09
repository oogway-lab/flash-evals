import { spawnSync } from "node:child_process";

// Keep these in step with the Gitleaks, Semgrep, and audit steps in
// .github/workflows/ci.yml so a local pass means a CI pass.
const scans = [
    {
        name: "gitleaks",
        command: "gitleaks",
        args: [
            "detect",
            "--source",
            ".",
            "--config",
            ".gitleaks.toml",
            "--no-git",
            "--redact",
        ],
        installHint:
            "brew install gitleaks (or see https://github.com/gitleaks/gitleaks#installing)",
    },
    {
        name: "semgrep",
        command: "semgrep",
        args: [
            "scan",
            "--config",
            "semgrep.yml",
            "--config",
            "p/nodejs",
            "--config",
            "p/typescript",
            "--error",
            "--metrics=off",
        ],
        installHint: "brew install semgrep (or pipx install semgrep)",
    },
    {
        name: "pnpm audit",
        command: "pnpm",
        args: ["audit", "--prod", "--audit-level=high"],
        installHint: "pnpm ships with the repo toolchain; run corepack enable",
    },
];

const strict = process.argv.includes("--strict");
let failures = 0;
const skipped = [];

for (const scan of scans) {
    if (!commandExists(scan.command)) {
        skipped.push(scan);
        continue;
    }

    console.log(`\n▶ ${scan.name}`);
    const result = spawnSync(scan.command, scan.args, {
        stdio: "inherit",
        shell: false,
    });
    if (result.status !== 0) failures += 1;
}

if (skipped.length > 0) {
    const lines = [
        "",
        "!".repeat(72),
        `!! SECURITY SCANS SKIPPED: ${skipped.map((scan) => scan.name).join(", ")}`,
        "!! These checks did NOT run, so this result does not match CI.",
        ...skipped.map((scan) => `!!   ${scan.name}: ${scan.installHint}`),
        strict
            ? "!! Failing because --strict was passed."
            : "!! Pass --strict (pnpm run security -- --strict) to fail instead.",
        "!".repeat(72),
        "",
    ];
    console.warn(lines.join("\n"));
    if (strict) failures += skipped.length;
}

if (failures > 0) {
    process.exit(1);
}

function commandExists(command) {
    const result = spawnSync("which", [command], {
        stdio: "ignore",
    });
    return result.status === 0;
}
