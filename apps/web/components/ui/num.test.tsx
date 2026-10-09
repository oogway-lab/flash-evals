import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MISSING_VALUE } from "@/lib/format";
import { Num } from "./num";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "./table";

afterEach(cleanup);

describe("Num", () => {
    it("renders tabular digits in Geist Sans, never mono", () => {
        render(<Num>12</Num>);
        expect(screen.getByText("12")).toHaveClass("tabular-nums");
        expect(screen.getByText("12")).not.toHaveClass("font-mono");
    });

    it("dims the missing marker and names it for screen readers", () => {
        const { container } = render(<Num>{MISSING_VALUE}</Num>);
        const num = container.querySelector('[data-slot="num"]');
        expect(num).toHaveClass("text-muted-foreground");
        expect(screen.getByText(MISSING_VALUE)).toHaveAttribute(
            "aria-hidden",
            "true",
        );
        expect(screen.getByText("not available")).toHaveClass("sr-only");
    });
});

describe("Table numeric columns", () => {
    it("uses tabular digits and right-aligns numeric cells", () => {
        render(
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead align="numeric">Cost</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow>
                        <TableCell>a</TableCell>
                        <TableCell align="numeric">$1.00</TableCell>
                    </TableRow>
                </TableBody>
            </Table>,
        );
        expect(screen.getByRole("table")).toHaveClass("tabular-nums");
        expect(screen.getByRole("columnheader", { name: "Cost" })).toHaveClass(
            "text-right",
        );
        expect(
            screen.getByRole("columnheader", { name: "Name" }),
        ).not.toHaveClass("text-right");
        expect(screen.getByRole("cell", { name: "$1.00" })).toHaveClass(
            "text-right",
        );
    });
});
