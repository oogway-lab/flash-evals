"use client";

import { useState, type ComponentProps } from "react";
import { SttCanvas } from "./stt-canvas";
import { SttRunLaunch } from "./stt-run-launch";

/**
 * Shares the canvas's unsaved-changes state with the run launcher, so a run
 * can't start from a graph that differs from the saved one.
 */
export function SttWorkflowEditor({
    launch,
    canvas,
}: {
    launch: Omit<ComponentProps<typeof SttRunLaunch>, "disabled">;
    canvas: Omit<ComponentProps<typeof SttCanvas>, "onDirtyChange">;
}) {
    const [dirty, setDirty] = useState(false);
    return (
        <>
            <SttRunLaunch {...launch} disabled={dirty} />
            <SttCanvas {...canvas} onDirtyChange={setDirty} />
        </>
    );
}
