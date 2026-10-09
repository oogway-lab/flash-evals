import { startRunWorker } from "../server/jobs/runQueue";
import { startWorkflowRunWorker } from "../server/jobs/workflowRunQueue";

let shuttingDown = false;

async function main() {
    await startRunWorker();
    await startWorkflowRunWorker();
    console.info("mosaic run and workflow workers listening");
}

function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`mosaic run worker received ${signal}`);
    process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

main().catch((err) => {
    console.error("mosaic run worker failed to start", err);
    process.exit(1);
});
