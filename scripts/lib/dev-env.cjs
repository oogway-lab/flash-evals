/* global __dirname */
// CommonJS also works with Playwright's configuration loader.
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { isIP } = require("node:net");

const root = path.resolve(__dirname, "../..");

function readEnv(relativePath) {
    const file = path.join(root, relativePath);
    return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

const apiEnv = readEnv("apps/api/.env");
const webEnv = readEnv("apps/web/.env");
const devHost =
    process.env.FLASH_EVALS_DEV_BIND_HOST ||
    webEnv.FLASH_EVALS_DEV_BIND_HOST ||
    "127.0.0.1";

const octets = devHost.split(".").map(Number);
if (
    isIP(devHost) !== 4 ||
    !(
        devHost === "127.0.0.1" ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    )
) {
    throw new Error(
        "Development host must be loopback or a private Tailscale IPv4 address.",
    );
}

exports.root = root;
exports.apiEnv = apiEnv;
exports.webEnv = webEnv;
exports.devHost = devHost;
