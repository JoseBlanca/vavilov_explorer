// Which elements take Escape themselves, so that the window's own uses of
// it, releasing + or − and clearing the selection, leave it to them
// (docs/design.md, section 2.1).

/** The types of `<input>` the user types text into, where Escape belongs to the field. */
const TEXT_INPUTS: ReadonlySet<string> = new Set([
  "text",
  "search",
  "number",
  "email",
  "url",
  "tel",
  "password",
]);

/**
 * Whether `target` takes Escape itself: a field the user types text into.
 * A checkbox, a button or a closed dropdown does not, so Escape there
 * acts for the window: it releases + or −, or clears the selection.
 */
export function takesEscape(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
