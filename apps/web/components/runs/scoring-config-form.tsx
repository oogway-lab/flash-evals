"use client";

import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { IPipelineFieldConfig } from "@/server/db/jsonTypes";
import {
    isMatcherValue,
    updateFieldMatcher,
    updateGenerativeField,
    updateNumericTolerance,
} from "./scoring-config-helpers";
import { SCORING_KIND_LABELS } from "@/lib/labels";

export function ScoringConfigForm({
    fieldConfigs,
    onChange,
}: {
    fieldConfigs: IPipelineFieldConfig[];
    onChange: (configs: IPipelineFieldConfig[]) => void;
}) {
    if (fieldConfigs.length === 0) {
        return (
            <p className="text-copy-14 text-muted-foreground">
                This prompt bundle has no field scoring config.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {fieldConfigs.map((config, index) => (
                <Card
                    key={config.field}
                    variant="inset"
                    className="flex flex-col gap-3 p-4"
                >
                    <div className="flex items-center gap-2">
                        <span className="text-mono-13 text-on-surface">
                            {config.field}
                        </span>
                        <span className="text-label-12 text-muted-foreground">
                            {SCORING_KIND_LABELS[config.kind]}
                        </span>
                    </div>

                    {config.kind === "factual" ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor={`matcher-${index}`}>
                                    Matcher
                                </Label>
                                <Select
                                    value={config.spec?.matcher ?? "none"}
                                    onValueChange={(value) => {
                                        if (!isMatcherValue(value)) return;
                                        onChange(
                                            updateFieldMatcher(
                                                fieldConfigs,
                                                index,
                                                value,
                                            ),
                                        );
                                    }}
                                >
                                    <SelectTrigger id={`matcher-${index}`}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">
                                            Not scored
                                        </SelectItem>
                                        <SelectItem value="exact">
                                            Exact match
                                        </SelectItem>
                                        <SelectItem value="numeric_tolerance">
                                            Numeric tolerance
                                        </SelectItem>
                                        <SelectItem value="set_overlap">
                                            Set overlap
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {config.spec?.matcher === "numeric_tolerance" && (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor={`tolerance-${index}`}>
                                        Tolerance (relative fraction)
                                    </Label>
                                    <Input
                                        id={`tolerance-${index}`}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="max-w-[200px]"
                                        value={config.spec.tolerance}
                                        onChange={(e) =>
                                            onChange(
                                                updateNumericTolerance(
                                                    fieldConfigs,
                                                    index,
                                                    Number(e.target.value),
                                                ),
                                            )
                                        }
                                    />
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor={`rubric-${index}`}>
                                    Rubric
                                </Label>
                                <Textarea
                                    id={`rubric-${index}`}
                                    rows={2}
                                    className="font-sans"
                                    value={config.rubric}
                                    onChange={(e) =>
                                        onChange(
                                            updateGenerativeField(
                                                fieldConfigs,
                                                index,
                                                {
                                                    rubric: e.target.value,
                                                },
                                            ),
                                        )
                                    }
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor={`judge-model-${index}`}>
                                    Judge model
                                </Label>
                                <Input
                                    id={`judge-model-${index}`}

                                    value={config.modelId}
                                    onChange={(e) =>
                                        onChange(
                                            updateGenerativeField(
                                                fieldConfigs,
                                                index,
                                                {
                                                    modelId: e.target.value,
                                                },
                                            ),
                                        )
                                    }
                                />
                            </div>
                        </div>
                    )}
                </Card>
            ))}
        </div>
    );
}
