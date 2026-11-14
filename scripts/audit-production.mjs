#!/usr/bin/env bun
// Production dependency audit: `bun audit`, limited to packages that ship.
// Usage: bun scripts/audit-production.mjs [--audit-level=high]
/* global Bun */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
    parseBunLock,
    productionAdvisories,
    productionVersions,
    readAuditReport,
} from "./lib/production-audit.mjs";

if (typeof Bun === "undefined") {
    console.error("Run this script with bun: bun scripts/audit-production.mjs");
    process.exit(2);
}

const levelArg = process.argv.find((arg) => arg.startsWith("--audit-level="));
const level = levelArg ? levelArg.split("=")[1] : "high";

// `--ignore=<CVE>` arguments are passed through to bun audit.
const ignores = process.argv.filter((arg) => arg.startsWith("--ignore="));
const audit = spawnSync("bun", ["audit", "--json", ...ignores], {
    encoding: "utf8",
});
let report;
try {
    report = readAuditReport(audit);
} catch (error) {
    console.error(error.message);
    process.exit(2);
}

const versions = productionVersions(
    parseBunLock(readFileSync("bun.lock", "utf8")),
);
const findings = productionAdvisories(
    report,
    versions,
    (version, range) => Bun.semver.satisfies(version, range),
    level,
);

if (findings.length === 0) {
    console.log(`No ${level}+ advisories in production dependencies.`);
    process.exit(0);
}
for (const { name, versions: affected, advisory } of findings) {
    console.log(
        `${advisory.severity.toUpperCase()} ${name}@${affected.join(", ")}: ${advisory.title}\n  ${advisory.url}`,
    );
}
console.log(
    `\n${findings.length} ${level}+ advisories in production dependencies.`,
);
process.exit(1);
