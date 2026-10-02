/** What can go wrong with good code: a value, either what was asked for or why not. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
