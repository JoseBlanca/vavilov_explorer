// The check of a value the backend serialised as an object with a `kind`,
// the name of a case of a Rust enum, and the fields of that case
// (crates/vavilov-core/src/error.rs), shared by the refusals of a command
// and those of a file.

/**
 * Whether `value` is an object with a `kind` that `fieldsOfKind` knows, and
 * exactly the fields of that kind, each of its type by `hasType`.
 */
export function hasFieldsOf<T extends string>(
  value: unknown,
  fieldsOfKind: ReadonlyMap<string, Readonly<Record<string, T>>>,
  hasType: (field: unknown, type: T) => boolean,
): boolean {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const { kind } = value;
  if (typeof kind !== "string") {
    return false;
  }
  const fields = fieldsOfKind.get(kind);
  if (fields === undefined) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== Object.keys(fields).length + 1) {
    return false;
  }
  return entries.every(([name, field]) => {
    if (name === "kind") {
      return true;
    }
    const type = Object.hasOwn(fields, name) ? fields[name] : undefined;
    return type !== undefined && hasType(field, type);
  });
}
