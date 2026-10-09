import { pgEnum } from "drizzle-orm/pg-core";

export const costSource = pgEnum("cost_source", ["computed", "unavailable"]);
export const scorerType = pgEnum("scorer_type", [
    "field_diff",
    "judge",
    "transcript_metric",
    "transcript_judge",
]);
