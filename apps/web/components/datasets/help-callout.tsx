import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function HelpCallout({
    title,
    children,
}: {
    title?: string;
    children: ReactNode;
}) {
    return (
        <Alert role="note">
            <Info aria-hidden="true" />
            {title && <AlertTitle>{title}</AlertTitle>}
            <AlertDescription>{children}</AlertDescription>
        </Alert>
    );
}
