import type { Answer } from "../../backend/connection.ts";

/**
 * What a component does with the answer of a command it sent: when the
 * command was not applied, it draws again, so that a control the user
 * changed, a dropdown that already shows the choice, shows again what the
 * backend holds. A refusal is written to the console; the words the user
 * reads for it are not written yet.
 */
export function answered(what: string, redraw: () => void): (answer: Answer) => void {
  return (answer) => {
    if (answer.ok && answer.value === "applied") {
      return;
    }
    if (!answer.ok) {
      console.warn(`Vavilov Explorer: ${what} was refused`, answer.error);
    }
    redraw();
  };
}
