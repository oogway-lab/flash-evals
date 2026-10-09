import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
    CardGridSkeleton,
    FormSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "./skeletons";

afterEach(cleanup);

describe("LoadingRegion", () => {
    it("marks the region busy and announces what is loading", () => {
        const { container } = render(
            <LoadingRegion label="datasets">
                <PageHeaderSkeleton />
            </LoadingRegion>,
        );
        expect(container.firstElementChild).toHaveAttribute(
            "aria-busy",
            "true",
        );
        expect(screen.getByRole("status")).toHaveTextContent(
            "Loading datasets",
        );
    });
});

describe("PageHeaderSkeleton", () => {
    it("only renders requested parts and leaves spacing to its parent", () => {
        const { container } = render(<PageHeaderSkeleton action />);
        const root = container.firstElementChild;
        expect(root).not.toHaveClass("mb-10");
        // title + action
        expect(root?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
            2,
        );
    });
});

describe("TableSkeleton", () => {
    it("renders a header plus the requested rows and columns", () => {
        render(<TableSkeleton columns={4} rows={3} />);
        const rows = screen.getAllByRole("row");
        expect(rows).toHaveLength(4);
        expect(rows[0].querySelectorAll("th")).toHaveLength(4);
        expect(rows[1].querySelectorAll("td")).toHaveLength(4);
    });
});

describe("CardGridSkeleton", () => {
    it("uses the grid classes it is given", () => {
        const { container } = render(
            <CardGridSkeleton
                count={2}
                className="grid gap-4 md:grid-cols-2"
            />,
        );
        const grid = container.firstElementChild;
        expect(grid).toHaveClass("md:grid-cols-2");
        expect(grid?.children).toHaveLength(2);
    });
});

describe("FormSkeleton", () => {
    it("renders a 40px control per field and an optional submit button", () => {
        const { container } = render(<FormSkeleton fields={2} />);
        expect(container.querySelectorAll(".h-10")).toHaveLength(3);
    });
});
