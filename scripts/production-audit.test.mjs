import assert from "node:assert/strict";
import { test } from "node:test";
import {
    keySegments,
    parseBunLock,
    productionAdvisories,
    productionVersions,
} from "./lib/production-audit.mjs";

const lockText = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "root", "devDependencies": { "lint-tool": "^1.0.0", }, },
    "apps/api": {
      "name": "api",
      "dependencies": { "server": "^2.0.0", "shared": "workspace:*", },
      "devDependencies": { "builder": "^1.0.0", },
    },
    "packages/shared": { "name": "shared", "dependencies": { "@scope/util": "^1.0.0", }, },
  },
  "packages": {
    "builder": ["builder@1.0.0", "", { "dependencies": { "glob": "1.0.0" } }, "sha"],
    "glob": ["glob@1.0.0", "", {}, "sha"],
    "lint-tool": ["lint-tool@1.0.0", "", { "dependencies": { "glob": "1.0.0" } }, "sha"],
    "server": ["server@2.0.0", "", { "dependencies": { "qs": "6.0.0" } }, "sha"],
    "server/qs": ["qs@6.0.0", "", {}, "sha"],
    "qs": ["qs@6.20.0", "", {}, "sha"],
    "shared": ["shared@workspace:packages/shared"],
    "@scope/util": ["@scope/util@1.2.0", "", { "dependencies": { "qs": "6.20.0" } }, "sha"],
  },
}`;

test("parses bun.lock and splits scoped package keys", () => {
    assert.equal(parseBunLock(lockText).lockfileVersion, 1);
    assert.deepEqual(keySegments("a/@scope/b/c"), ["a", "@scope/b", "c"]);
});

test("keeps runtime dependencies and drops devDependency-only packages", () => {
    const versions = productionVersions(parseBunLock(lockText));
    assert.deepEqual(
        Object.fromEntries([...versions].map(([n, v]) => [n, [...v].sort()])),
        {
            server: ["2.0.0"],
            qs: ["6.0.0", "6.20.0"],
            "@scope/util": ["1.2.0"],
        },
    );
    assert.equal(versions.has("glob"), false);
    assert.equal(versions.has("builder"), false);
});

test("reports only production advisories at or above the level", () => {
    const versions = productionVersions(parseBunLock(lockText));
    const audit = {
        glob: [
            {
                severity: "high",
                vulnerable_versions: "<2.0.0",
                title: "dev only",
            },
        ],
        qs: [
            {
                severity: "high",
                vulnerable_versions: "<6.10.0",
                title: "old qs",
            },
            {
                severity: "moderate",
                vulnerable_versions: "<7.0.0",
                title: "minor",
            },
        ],
    };
    const satisfies = (version, range) =>
        range === "<6.10.0"
            ? Number(version.split(".")[1]) < 10 && version.startsWith("6.")
            : range === "<2.0.0"
              ? version.startsWith("1.")
              : true;
    const findings = productionAdvisories(audit, versions, satisfies, "high");
    assert.deepEqual(
        findings.map((f) => [f.name, f.versions, f.advisory.title]),
        [["qs", ["6.0.0"], "old qs"]],
    );
});
