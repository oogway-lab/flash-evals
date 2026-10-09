import type { ReactNode } from "react";

export type StepStatus = "done" | "active" | "todo";

export interface IJourneyStep {
    title: string;
    description?: string;
    status: StepStatus;
    children?: ReactNode;
}
