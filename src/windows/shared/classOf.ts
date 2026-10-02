import { defect } from "../../state/defect.ts";

/**
 * The class `name` of a CSS module, which Vite renames. A module is typed
 * as an object of any name, so `styles.name` cannot tell a class that
 * exists from a misspelt one (.claude/skills/coding/css.md).
 *
 * @throws A defect for a name the module does not have.
 */
export function classOf(styles: Readonly<Record<string, string>>, name: string): string {
  const value = Object.hasOwn(styles, name) ? styles[name] : undefined;
  if (value === undefined) {
    throw defect(`a CSS module without the class ${name}`);
  }
  return value;
}
