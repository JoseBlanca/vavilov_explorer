/**
 * A defect of the app: a state the code is meant to make impossible, such as
 * a message from the backend that does not decode. It is thrown, never
 * returned, and only the outermost handler of a window catches it
 * (`.claude/skills/coding/typescript.md`, "Errors").
 */
export function defect(what: string): Error {
  return new Error(`Vavilov Explorer defect: ${what}`);
}
