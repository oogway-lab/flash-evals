export { isRecord } from "@/lib/objects";

export const PROTOTYPE_POLLUTION_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);
