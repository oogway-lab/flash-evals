"use client";

import { useEffect } from "react";
import type { IActionState } from "@/app/actions";

const fieldOrder = [
    "datasetId",
    "promptVersionId",
    "judgePromptVersionId",
    "judgeModelId",
    "judgeReasoningEffort",
    "judgeRubric",
    "sttModelId",
    "referenceModel",
    "maxTokens",
];

export function useFocusFirstRunError(
    fieldErrors: IActionState["fieldErrors"],
) {
    useEffect(() => {
        if (!fieldErrors) return;
        const remainingKeys = Object.keys(fieldErrors).filter(
            (key) => !fieldOrder.includes(key),
        );
        const orderedKeys = [...fieldOrder, ...remainingKeys];
        const firstErrorKey = orderedKeys.find(
            (key) => fieldErrors[key]?.length,
        );
        if (!firstErrorKey) return;
        document.getElementById(firstErrorKey)?.focus();
    }, [fieldErrors]);
}
