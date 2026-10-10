// Keep the real worker entrypoint and shutdown logic; replace external queues
// and database access so the launch-command regression needs no credentials.
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const fixtures = {
    "../server/db/client": `
        exports.closeDatabasePool = async () => {
            clearInterval(globalThis.workerFixtureTimer);
            console.log(JSON.stringify({ event: "fixture.database_closed" }));
        };
    `,
    "../server/jobs/runQueue": `
        exports.startRunWorker = async () => {};
        exports.stopRunWorker = async () => {
            await new Promise(resolve => setTimeout(resolve, 600));
            console.log(JSON.stringify({ event: "fixture.queue_drained" }));
            return { remainingInFlight: 0 };
        };
    `,
    "../server/jobs/workflowRunQueue": `
        exports.startWorkflowRunWorker = async () => {};
        exports.stopWorkflowRunWorker = async () => ({ remainingInFlight: 0 });
    `,
    "../server/jobs/workerObservability": `
        globalThis.workerFixtureTimer = setInterval(() => {}, 1000);
        exports.logWorkerEvent = (level, event, fields) => {
            console.log(JSON.stringify({ level, event, fields, pid: process.pid,
                parentPid: process.ppid, extraCaCerts: process.env.NODE_EXTRA_CA_CERTS }));
        };
        exports.safeWorkerError = () => ({});
    `,
};
const urls = new Map();
for (const [specifier, source] of Object.entries(fixtures)) {
    const file = join(
        process.env.MOSAIC_WORKER_TEST_FIXTURES,
        `${specifier.split("/").at(-1)}.cjs`,
    );
    writeFileSync(file, source);
    urls.set(specifier, pathToFileURL(file).href);
}
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (
            context.parentURL?.endsWith("/scripts/worker.ts") &&
            Object.hasOwn(fixtures, specifier)
        ) {
            return { url: urls.get(specifier), shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
