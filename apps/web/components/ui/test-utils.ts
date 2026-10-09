import { fireEvent } from "@testing-library/react";

/**
 * Choose a Base UI Select option in jsdom. Base UI only commits a mouse
 * click that started on the item (`pointerdown` first), to tell it apart
 * from the release of the drag that opened the popup; a bare
 * `fireEvent.click` is ignored.
 */
export function pickOption(option: HTMLElement): void {
    fireEvent.pointerDown(option);
    fireEvent.click(option);
}
