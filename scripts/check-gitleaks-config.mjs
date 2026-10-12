import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the real detector, including its allowlist, before trusting a clean scan.
// All input is manufactured in a temporary directory and removed afterward.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configFlag = process.argv.indexOf("--config");
const configPath =
    configFlag === -1
        ? join(root, ".gitleaks.toml")
        : resolve(process.argv[configFlag + 1]);
const docker = process.argv.includes("--docker");
const image =
    "ghcr.io/gitleaks/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854";
const historicalIgnore = readFileSync(join(root, ".gitleaksignore"), "utf8");
const temporary = mkdtempSync(join(tmpdir(), "flash-evals-gitleaks-"));

try {
    const publicRoot = "48f9644ed975fc9efce8e9b86161cc6ab18250e3";
    const approvedFixtures = [
        "apps/web/app/api/images/[...key]/route.test.ts:18",
        "apps/web/server/runs/executor.test.ts:503",
        "apps/web/server/runs/executor.test.ts:645",
        "apps/web/server/storage/objects.supabase.test.ts:4",
        "apps/web/server/storage/objects.test.ts:21",
        "packages/secrets/src/redact.test.ts:13",
        "packages/secrets/src/redact.test.ts:17",
    ].map(
        (entry) =>
            `${publicRoot}:${entry.replace(/:(\d+)$/, ":generic-api-key:$1")}`,
    );
    assert.deepEqual(
        historicalIgnore
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"))
            .sort(),
        approvedFixtures.sort(),
        "Historical ignores must remain the seven reviewed commit/path/rule/line identities",
    );
    const config = readFileSync(configPath, "utf8");
    // Deliberately fake PAT-shaped data; never use a credential here.
    const fakePat = ["ghp", "Q8n4gR2mT6pL9vX1zB5cD7fH3jK0sW4yE6uA"].join("_");
    const detection = scan("default-rules", config, [
        `github_token = "${fakePat}"`,
    ]);
    assert.equal(
        detection.status,
        1,
        "Gitleaks must reject the fake PAT canary",
    );
    assert.ok(
        detection.findings.some((finding) => finding.RuleID === "github-pat"),
        "The built-in github-pat rule must run; an allowlist-only config is unsafe",
    );

    // Reconstruct a known fake historical storage UUID at a different path/line.
    // Its old fingerprint must never hide a new occurrence of the same value.
    const oldFakeUuid = [
        "8f14e45f",
        "ceea",
        "467a",
        "9c1e",
        "a2d43a0f9d1c",
    ].join("-");
    const freshFixture = scan("fresh-historical-value", config, [
        "# A new occurrence is intentionally outside the historical baseline.",
        `api_key = "${oldFakeUuid}"`,
    ]);
    assert.equal(freshFixture.status, 1);
    assert.ok(
        freshFixture.findings.some(
            (finding) =>
                finding.RuleID === "generic-api-key" && finding.StartLine === 2,
        ),
    );

    const placeholders = [
        "sk_test_...",
        "pk_test_...",
        "service-role-key",
        "change-me",
        "https://test-user:example-password@router.example/v1",
    ];
    // This additional rule makes every placeholder detectable, so the test
    // proves the production allowlist is exact even for low-entropy examples.
    const probeConfig = `${config}\n[[rules]]
id = "placeholder-boundary-regression"
description = "Temporary synthetic allowlist probe"
regex = '''placeholder_probe=(.+)'''
secretGroup = 1
`;
    const allowed = scan(
        "exact-placeholders",
        probeConfig,
        placeholders.map((value) => `placeholder_probe=${value}`),
    );
    assert.equal(
        allowed.status,
        0,
        "Exact documented placeholders must be allowed",
    );
    assert.equal(allowed.findings.length, 0);

    const nearMisses = placeholders.flatMap((value) => [
        `prefix-${value}`,
        `${value}-suffix`,
    ]);
    const rejected = scan(
        "placeholder-boundaries",
        probeConfig,
        nearMisses.map((value) => `placeholder_probe=${value}`),
    );
    assert.equal(rejected.status, 1, "Near-miss placeholders must be rejected");
    const probeLines = rejected.findings
        .filter(
            (finding) => finding.RuleID === "placeholder-boundary-regression",
        )
        .map((finding) => finding.StartLine)
        .sort((a, b) => a - b);
    assert.deepEqual(
        probeLines,
        nearMisses.map((_, index) => index + 1),
        "Allowlist patterns must not suppress prefixed or suffixed values",
    );
    console.log(
        "Gitleaks config regression passed: default rule, 7 exact historical fingerprints, fresh historical value, 5 exact placeholders, 10 near misses.",
    );
} finally {
    rmSync(temporary, { recursive: true, force: true });
}

function scan(name, config, lines) {
    const directory = join(temporary, name);
    const input = join(directory, "input");
    mkdirSync(input, { recursive: true });
    writeFileSync(join(input, "synthetic.txt"), `${lines.join("\n")}\n`);
    writeFileSync(join(directory, ".gitleaks.toml"), config);
    writeFileSync(join(directory, ".gitleaksignore"), historicalIgnore);
    const source = docker ? "/scan/input" : input;
    const report = docker
        ? "/scan/report.json"
        : join(directory, "report.json");
    const args = [
        "detect",
        "--source",
        source,
        "--config",
        docker ? "/scan/.gitleaks.toml" : join(directory, ".gitleaks.toml"),
        "--no-git",
        "--redact",
        "--no-banner",
        "--no-color",
        "--gitleaks-ignore-path",
        docker ? "/scan/.gitleaksignore" : join(directory, ".gitleaksignore"),
        "--report-format",
        "json",
        "--report-path",
        report,
    ];
    const result = spawnSync(
        docker ? "docker" : "gitleaks",
        docker
            ? ["run", "--rm", "-v", `${directory}:/scan`, image, ...args]
            : args,
        { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.ok(
        result.status === 0 || result.status === 1,
        `Gitleaks ${name} failed: ${result.stderr}`,
    );
    return {
        status: result.status,
        findings: JSON.parse(
            readFileSync(join(directory, "report.json"), "utf8"),
        ),
    };
}
