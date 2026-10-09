#!/usr/bin/env node
// Flags UI code in apps/web that drifts from DESIGN.md. Pure Node, so
// contributors do not need ripgrep installed. Prints each match as
// `path:line:text`, then one "DESIGN DRIFT:" line per failed rule, and exits 1
// if any rule matched.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const APP = "apps/web";

// Match ripgrep's file selection (the old shell version used `rg`): skip
// git-ignored files, hidden directories, and binary files. Inside a
// git checkout, `git ls-files` gives the tracked plus untracked-but-not-ignored
// set; outside one (e.g. a source tarball) fall back to walking the tree.
const FALLBACK_IGNORED_DIRS = new Set([
    "node_modules",
    ".next",
    ".open-next",
    ".wrangler",
    ".turbo",
    "coverage",
    "dist",
    "playwright-report",
    "test-results",
]);

function hiddenParts(file) {
    const parts = path.relative(repoRoot, file).split(path.sep);
    return {
        inHiddenDir: parts.slice(0, -1).some((part) => part.startsWith(".")),
        isHiddenFile: parts[parts.length - 1].startsWith("."),
    };
}

function listWithGit(dir) {
    const result = spawnSync(
        "git",
        [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            dir,
        ],
        { cwd: repoRoot, encoding: "utf8" },
    );
    if (result.error || result.status !== 0) return undefined;
    return [...new Set(result.stdout.split("\0").filter(Boolean))]
        .filter((file) => !file.split("/").includes("node_modules"))
        .map((file) => path.join(repoRoot, file));
}

function walk(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (FALLBACK_IGNORED_DIRS.has(entry.name)) continue;
            files.push(...walk(full));
        } else if (entry.isFile()) {
            files.push(full);
        }
    }
    return files;
}

function listFiles(dir) {
    const files = listWithGit(dir) ?? walk(path.join(repoRoot, dir));
    return (
        files
            .filter((file) => !hiddenParts(file).inHiddenDir)
            // lstat, not stat: ripgrep does not follow symlinks by default, so a
            // symlink git lists is skipped rather than scanned twice.
            .filter((file) => existsSync(file) && lstatSync(file).isFile())
            .sort()
    );
}

function readText(file) {
    const buffer = readFileSync(file);
    // ripgrep skips binary files; treat a NUL byte as binary like it does.
    if (buffer.includes(0)) return undefined;
    return buffer.toString("utf8");
}

const allFiles = listFiles(APP);
const appFiles = allFiles.filter((file) => !hiddenParts(file).isHiddenFile);
// ripgrep's `--glob '*.tsx'` also matches hidden .tsx files (but not files
// inside hidden directories), so the .tsx-only rules keep them.
const tsxFiles = allFiles.filter((file) => file.endsWith(".tsx"));
const sourceFiles = allFiles.filter((file) => /\.(ts|tsx|mjs)$/.test(file));
const buttonFile = path.join(repoRoot, APP, "components/ui/button.tsx");
// Component source under app/ and components/. Tests are left out because they
// assert on the class names the rules below forbid elsewhere.
const uiSourceFiles = tsxFiles.filter((file) => {
    const relative = path.relative(path.join(repoRoot, APP), file);
    return (
        /^(app|components)\//.test(relative) && !relative.endsWith(".test.tsx")
    );
});
// Component and route code (.ts and .tsx) under app/ and components/, without
// tests. UI copy lives here, so the copy rules scan it.
const uiCopyFiles = sourceFiles.filter((file) => {
    const relative = path.relative(path.join(repoRoot, APP), file);
    return (
        /^(app|components)\//.test(relative) && !/\.test\.tsx?$/.test(relative)
    );
});
const COMMENT_LINE = /^\s*(\/\/|\/?\*)/;
// Overlay primitives are the only surfaces that keep the larger radius.
const ROUNDED_MD_ALLOWED = new Set(
    ["alert-dialog", "dialog", "dropdown-menu", "select", "sheet"].map((name) =>
        path.join(repoRoot, APP, `components/ui/${name}.tsx`),
    ),
);

const RULES = [
    {
        pattern: /@radix-ui\/|from\s+["']radix-ui["']|\basChild\b/,
        files: sourceFiles,
        message:
            "Radix import or asChild found (primitives are Base UI: compose with the render prop, or buttonVariants on a Link)",
    },
    {
        pattern: /shadow-(lg|xl|2xl)|drop-shadow|shadow-\[/,
        files: appFiles,
        message: "heavy or arbitrary shadow utilities found",
    },
    {
        pattern: /backdrop-blur|bg-gradient/,
        files: appFiles,
        message: "glassmorphism/gradient patterns found",
    },
    {
        pattern: /bg-\[#|text-\[#|border-\[#/,
        files: appFiles,
        message: "arbitrary color values found",
    },
    {
        pattern: /rounded-full|h-\[54px\]/,
        files: existsSync(buttonFile) ? [buttonFile] : [],
        message: "button.tsx uses legacy pill or 54px CTA styling",
    },
    {
        pattern:
            /font-inter|font-roboto|font-lora|font-dm-sans|--font-lora|--font-dm-sans/i,
        files: appFiles,
        message: "non-Geist or legacy brand fonts found",
    },
    {
        pattern:
            /(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]/,
        files: tsxFiles,
        message: "Tailwind default palette found (use semantic tokens)",
    },
    {
        pattern: /bg-white/,
        files: tsxFiles,
        message: "bg-white found (use bg-neutral or bg-card)",
    },
    {
        pattern: /rounded-md/,
        files: uiSourceFiles.filter((file) => !ROUNDED_MD_ALLOWED.has(file)),
        message:
            "rounded-md outside overlay primitives (use rounded-sm for cards, controls and inline surfaces)",
    },
    {
        pattern: /(?<![\w-])text-(xs|sm|base|lg|xl|2xl)(?![\w-])/,
        files: uiSourceFiles,
        message:
            "raw Tailwind type size found (use named type roles such as text-copy-14)",
    },
    {
        pattern:
            /(?<![\w-])text-(headline-(display|lg|md|sm)|body-(lg|md|sm)|label-(lg|md|sm)|nav-link|stat-value)(?![\w-])/,
        files: appFiles,
        message:
            "removed type token found (use text-heading-32/24/20/16, text-copy-16/14, text-label-14/12, text-mono-13 or text-stat-32)",
    },
    {
        pattern: /(?<![\w-])(oklch|light-dark)\(/,
        files: tsxFiles,
        message:
            "raw oklch()/light-dark() in TSX (define a semantic token in globals.css)",
    },
    {
        pattern: /(?<![\w-])(bg|text)-black(?![\w-])/,
        files: tsxFiles,
        message: "bg-black or text-black found (use semantic tokens)",
    },
    {
        pattern: /focus-visible:ring-/,
        files: tsxFiles,
        message:
            "focus-visible:ring- found (use focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring)",
    },
    {
        pattern: /\.\.\."/,
        files: uiSourceFiles,
        message:
            'ASCII "..." in a string literal (use the ellipsis character "…")',
    },
    {
        pattern: /\u2014/,
        files: uiCopyFiles,
        skipLine: (line) => COMMENT_LINE.test(line),
        message:
            "em dash in UI copy (use a period, comma, colon or parentheses; missing values use the en dash from MISSING_VALUE)",
    },
    {
        pattern:
            /(?<![\w:\]-])font-mono(?![\w-]).*(?<![\w-])text-(copy|label|heading|stat)-\d+|(?<![\w-])text-(copy|label|heading|stat)-\d+.*(?<![\w:\]-])font-mono(?![\w-])/,
        files: uiSourceFiles,
        message:
            "font-mono combined with a type role (use text-mono-13 alone for IDs and code; numbers are Geist Sans)",
    },
    {
        pattern:
            /(?<![\w-])-?(p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y)-(5|7|9|11)(?![\w.-])/,
        files: uiSourceFiles,
        message:
            "off-scale spacing found (scale is 1, 2, 3, 4, 6, 8, 10, 12, 16; no *-5, *-7, *-9 or *-11)",
    },
    {
        pattern:
            /(?<![\w-])font-(thin|light|normal|medium|semibold|bold|extrabold)(?![\w-])/,
        files: uiSourceFiles,
        message:
            "font-weight utility found (weight lives in the type role; do not add font-medium or font-semibold)",
    },
];

let failed = false;

for (const rule of RULES) {
    let matched = false;
    for (const file of rule.files) {
        const text = readText(file);
        if (text === undefined) continue;
        text.split(/\r?\n/).forEach((line, index) => {
            if (rule.skipLine?.(line)) return;
            if (rule.pattern.test(line)) {
                matched = true;
                const relative = path.relative(repoRoot, file);
                console.log(`${relative}:${index + 1}:${line}`);
            }
        });
    }
    if (matched) {
        console.log(`DESIGN DRIFT: ${rule.message}`);
        failed = true;
    }
}

if (failed) {
    process.exit(1);
}
console.log("Design drift check passed.");
