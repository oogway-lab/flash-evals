import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { devHost, root } from "./lib/dev-env.cjs";

// Boot order varies: Docker and Tailscale can take longer than the user manager.
// A failed check is retried by systemd; it never migrates or seeds the database.
for (let attempt = 0; attempt < 18; attempt += 1) {
    const interfaceReady = Object.values(networkInterfaces())
        .flat()
        .some((address) => address?.address === devHost);
    if (interfaceReady) {
        const database = spawnSync(
            "docker",
            [
                "compose",
                "exec",
                "-T",
                "postgres",
                "pg_isready",
                "-U",
                "flash_evals",
                "-d",
                "flash_evals",
            ],
            { cwd: root, stdio: "ignore", timeout: 5000 },
        );
        if (database.status === 0) process.exit(0);
    }
    if (attempt === 0)
        console.info("Waiting for the private interface and PostgreSQL…");
    await delay(5000);
}
console.error(
    "Private interface or PostgreSQL unavailable; systemd will retry.",
);
process.exit(1);
