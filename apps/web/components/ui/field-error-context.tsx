"use client";

import * as React from "react";

const FieldErrorIdsContext = React.createContext<
    Record<string, string | undefined>
>({});

/**
 * Lets a form tell controls rendered by someone else (e.g. `children`) which
 * element describes their error, keyed by field name.
 */
export function FieldErrorIdsProvider({
    ids,
    children,
}: {
    ids: Record<string, string | undefined>;
    children: React.ReactNode;
}) {
    return (
        <FieldErrorIdsContext.Provider value={ids}>
            {children}
        </FieldErrorIdsContext.Provider>
    );
}

/** Id of the element describing `name`'s current error, if any. */
export function useFieldErrorId(name: string | undefined) {
    const ids = React.useContext(FieldErrorIdsContext);
    return name ? ids[name] : undefined;
}
