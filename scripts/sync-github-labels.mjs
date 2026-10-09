import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const source = readFileSync(".github/labels.yml", "utf8");
const labels = parseLabels(source);

if (labels.length === 0) {
    throw new Error("No labels found in .github/labels.yml");
}

for (const label of labels) {
    const args = [
        "api",
        `repos/{owner}/{repo}/labels/${encodeURIComponent(label.name)}`,
        "--method",
        "PATCH",
        "--field",
        `new_name=${label.name}`,
        "--field",
        `color=${label.color}`,
        "--field",
        `description=${label.description}`,
    ];

    if (dryRun) {
        console.log(`Would sync label: ${label.name}`);
        continue;
    }

    try {
        execFileSync("gh", args, { stdio: "inherit" });
    } catch {
        execFileSync(
            "gh",
            [
                "api",
                "repos/{owner}/{repo}/labels",
                "--method",
                "POST",
                "--field",
                `name=${label.name}`,
                "--field",
                `color=${label.color}`,
                "--field",
                `description=${label.description}`,
            ],
            { stdio: "inherit" },
        );
    }
}

function parseLabels(yaml) {
    const lines = yaml.split("\n");
    const parsed = [];
    let current;

    for (const line of lines) {
        const name = line.match(/^\s+- name:\s*(.+?)\s*$/);
        if (name) {
            if (current) parsed.push(current);
            current = { name: unquote(name[1]) };
            continue;
        }

        if (!current) continue;

        const color = line.match(/^\s+color:\s*(.+?)\s*$/);
        if (color) {
            current.color = unquote(color[1]);
            continue;
        }

        const description = line.match(/^\s+description:\s*(.+?)\s*$/);
        if (description) {
            current.description = unquote(description[1]);
        }
    }

    if (current) parsed.push(current);

    return parsed.filter((label) => label.name && label.color && label.description);
}

function unquote(value) {
    return value.replace(/^["']|["']$/g, "");
}
