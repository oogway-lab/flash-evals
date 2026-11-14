import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Says so when Bifrost is set up but its model list couldn't be fetched:
 * no model is offered on Bifrost until it can be.
 */
export function BifrostModelListNotice({
    error,
}: {
    error: string | undefined;
}) {
    if (!error) return null;
    return (
        <Alert variant="warning">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
        </Alert>
    );
}
