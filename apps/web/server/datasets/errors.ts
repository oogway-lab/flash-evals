import { errorMessage } from "../lib/errors";

export const DELETE_ITEM_BLOCKED_MESSAGE =
    "This item is used by an evaluation run and cannot be deleted.";
export const DUPLICATE_ITEM_SOURCE_NAME_MESSAGE =
    "An item with this filename already exists in the dataset.";

export class DeleteItemBlockedError extends Error {
    constructor(message = DELETE_ITEM_BLOCKED_MESSAGE) {
        super(message);
        this.name = "DeleteItemBlockedError";
    }
}

export class DuplicateItemSourceNameError extends Error {
    constructor(message = DUPLICATE_ITEM_SOURCE_NAME_MESSAGE) {
        super(message);
        this.name = "DuplicateItemSourceNameError";
    }
}

export function importFailureReason(err: unknown): string {
    if (err instanceof DuplicateItemSourceNameError) {
        return DUPLICATE_ITEM_SOURCE_NAME_MESSAGE;
    }
    return errorMessage(err);
}
