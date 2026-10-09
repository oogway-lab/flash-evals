"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function RunSubmitButton({ disabled }: { disabled: boolean }) {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            disabled={disabled}
            loading={pending}
            loadingText="Starting…"
        >
            Run evaluation
        </Button>
    );
}
