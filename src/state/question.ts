// A question the window asks before it sends a command whose effect the
// user may not expect, with the words of each answer.

/** A question to the user, with two answers. */
export interface Question {
  /** What is asked, in one line. */
  readonly heading: string;
  /** What happens if the user goes on. */
  readonly text: string;
  /** The words of the button that goes on. */
  readonly confirm: string;
  /** The words of the button that keeps things as they are. */
  readonly cancel: string;
}
