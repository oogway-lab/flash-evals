import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Alert, AlertDescription, AlertTitle } from "./alert";

afterEach(cleanup);

describe("Alert", () => {
    it("lets destructive descriptions and titles inherit the destructive color", () => {
        render(
            <Alert variant="destructive">
                <AlertTitle>Save failed</AlertTitle>
                <AlertDescription>Something broke</AlertDescription>
            </Alert>,
        );
        const alert = screen.getByRole("alert");
        expect(alert).toHaveClass(
            "text-error",
            "[&_[data-slot=alert-description]]:text-inherit",
            "[&_[data-slot=alert-title]]:text-inherit",
        );
        expect(screen.getByText("Something broke")).toHaveAttribute(
            "data-slot",
            "alert-description",
        );
        expect(screen.getByText("Save failed")).toHaveAttribute(
            "data-slot",
            "alert-title",
        );
    });

    it("keeps muted descriptions in the default variant", () => {
        render(
            <Alert>
                <AlertDescription>Heads up</AlertDescription>
            </Alert>,
        );
        expect(screen.getByRole("alert")).not.toHaveClass(
            "[&_[data-slot=alert-description]]:text-inherit",
        );
        expect(screen.getByText("Heads up")).toHaveClass(
            "text-muted-foreground",
        );
    });
});
