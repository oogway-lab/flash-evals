import type {
    IBenchmarkCriterion,
    IBenchmarkRubricTask,
    IBenchmarkTask,
    IJsonSchemaObject,
} from "@flash-evals/api-contract";
import { textFields } from "./rule-checks";

export function emptyCriterion(n = 1): IBenchmarkCriterion {
    return { key: `criterion_${n}`, name: `Criterion ${n}` };
}

export function addCriterion(task: IBenchmarkRubricTask): IBenchmarkRubricTask {
    let n = task.criteria.length + 1;
    while (task.criteria.some((c) => c.key === `criterion_${n}`)) n++;
    return { ...task, criteria: [...task.criteria, emptyCriterion(n)] };
}

export function trimCriterion(
    criterion: IBenchmarkCriterion,
): IBenchmarkCriterion {
    const description = criterion.description?.trim();
    return {
        key: criterion.key.trim(),
        name: criterion.name.trim(),
        ...(description ? { description } : {}),
    };
}

/**
 * Criteria that suit most write-ups of a conversation, read from every text
 * field. Prompt-specific criteria (sections, official names) are added by
 * hand, and context the judge needs goes in the task's notes.
 */
export function starterRubricTask(
    schema: IJsonSchemaObject | undefined,
    existing: IBenchmarkTask[],
): IBenchmarkRubricTask {
    let key = "rubric";
    for (let n = 2; existing.some((task) => task.key === key); n++)
        key = `rubric_${n}`;
    return {
        key,
        name: "Rubric",
        description:
            "A judge scores each answer 1–5 on every criterion, today's model's included.",
        method: "rubric",
        paths: textFields(schema),
        criteria: [
            {
                key: "grounded",
                name: "Grounded in the input",
                description:
                    "5: every statement is supported by the input. Lower for anything invented, guessed or contradicted.",
            },
            {
                key: "coverage",
                name: "Covers what matters",
                description:
                    "5: every point that matters to the reader is captured. Lower for each important point missed.",
            },
            {
                key: "numbers",
                name: "Numbers right",
                description:
                    "5: prices, quantities and dates match what was said. Lower for each wrong or merged number.",
            },
            {
                key: "attribution",
                name: "Right person said it",
                description:
                    "5: each statement, request and objection is credited to the person who made it.",
            },
            {
                key: "usefulness",
                name: "Useful to the reader",
                description:
                    "5: clear and easy to scan on a phone, with the actions and follow-ups easy to find.",
            },
        ],
    };
}
