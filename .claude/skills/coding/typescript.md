# TypeScript

The rules of the language for every part of the frontend: the compiler
and its options, the rules of the code, the names, errors, and the lint.
They are popnei_web's
(`/Users/jose/devel/popnei_web/.claude/skills/coding/typescript.md`),
with the engines of a desktop app in place of a list of browsers.

## The engines

The frontend runs in the system's web view, not in a browser the user
chose: WKWebView on macOS, WebView2 (Chromium, updated with Edge) on
Windows, WebKitGTK on Linux (`docs/design.md`, section 10). The oldest
engine sets what the code may use. Decided by the owner on 2 October
2026:

| platform | oldest supported | its engine |
|---|---|---|
| macOS | 14, Sonoma | WebKit of Safari 17 |
| Windows | 10 and 11 | WebView2, a recent Chromium, updated by itself |
| Linux | Ubuntu 24.04, or WebKitGTK 2.44 | about Safari 17 |

So the floor is Safari 17. A function added to JavaScript after it fails
on that engine and only there, since Vite rewrites newer syntax but adds
no missing function. Before using an API that is new, read its row in
MDN's compatibility table, for Safari, and keep the version in the
commit message. Easy to miss, and above the floor: `Promise.withResolvers`
and `Object.groupBy` (Safari 17.4), `using` (not in Safari). The `Set`
methods such as `union` came in Safari 17, and are at the floor.

## The compiler

TypeScript 6.0. The options, in `tsconfig.json`, beyond the template's:

```json
"target": "ES2022",
"lib": ["ES2023", "DOM", "DOM.Iterable"],
"verbatimModuleSyntax": true,
"erasableSyntaxOnly": true,
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitReturns": true,
"noImplicitOverride": true,
"noPropertyAccessFromIndexSignature": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"allowUnreachableCode": false,
"noUncheckedSideEffectImports": true
```

- **`noUncheckedIndexedAccess`**: `array[i]` has the type `T | undefined`.
  Walk arrays with `for...of`, `map`, `entries()`; when an index is
  needed, check the value, and a missing one the code makes impossible is
  a defect (below). Not `array[i]!` and not `array[i] ?? 0`: the first
  silences the check, the second turns a bug into a zero that looks like
  a value. A typed array, `Float32Array`, is indexed the same way. An
  element the code knows is there, by a length it checked or the way it
  built the array, is read with `at(values, index)` of `src/state/at.ts`,
  which throws the defect.
- **`exactOptionalPropertyTypes`**: an optional field may be absent but
  not `undefined`.
- **`verbatimModuleSyntax` and `erasableSyntaxOnly`**: Vite removes the
  types of each file on its own, so an import used only as a type says
  `import type`, and enums, namespaces and parameter properties, which
  emit code, are refused.
- Vite does not type check, so a window that runs can still have type
  errors; `npx tsc --noEmit` is a check of its own.

## The rules of the code

- **No `any`.** A value whose type is not known is `unknown`, narrowed
  with `typeof`, `in`, `Array.isArray`, `instanceof` before it is used.
- **Every message from the backend is decoded by one function** in
  `src/backend/`, which checks its length, its kind and its revision
  before anything reads it. The backend is our own code, so a message
  that does not decode is a defect, thrown (below), not a value; it is
  checked because a defect found where it enters is found at once, and one
  found three windows later is not.
- **Discriminated unions for states and results.** A thing that can be in
  several states is a union whose members share a literal `kind`, each
  with only what that state has:

  ```ts
  type Import =
    | { readonly kind: "none" }
    | { readonly kind: "reading"; readonly fileName: string }
    | { readonly kind: "failed"; readonly error: ImportError }
    | { readonly kind: "done"; readonly numRows: number };
  ```

  not an object with `isReading`, `error?` and `numRows?`, which allows
  combinations that mean nothing. A `switch` on `kind` has no `default`,
  and the lint fails when a member is not handled.
- **No enums.** A finite set is a union of string literals; when the list
  is needed at run time, an `as const` array, and the type is taken from
  it.
- **Branded types for values of one primitive that must not mix**: a row
  index and a column id are both numbers; `type ColumnId = number & {
  readonly __brand: "ColumnId" }`, made only by the decoder, so that a row
  passed where a column goes does not compile. This is the newtype of
  `rust.md`.
- **`interface` for the shape of an object, `type` for a union.**
- **Exported functions declare their return type.**
- **`null` for "not set"**, `undefined` only where a library gives it.
- **Conditions are booleans**: `count > 0`, `name !== ""`, `value !== null`,
  never `if (count)`, which is false for a real count of 0.
- **No classes of our own** unless a library asks for one. A thing with
  state and a lifetime, a controller, the handle of a plot, the window's
  copy of the state, is an object of functions returned by a function
  that holds the state in its closure: nothing outside can reach into it,
  and there is no `this` to lose when a method is passed as a callback.
- **Named exports only**, no `export default`, outside the configuration
  files that need one.
- **Imports are relative, with the `.ts` extension**, and there are no
  barrel files, `index.ts` that re-export a folder, which hide where a name
  comes from and make cycles easy.
- **Every exported function, type and field has a doc comment**, `/** */`,
  as the `writing` skill describes them.
- **A lint is silenced on one line**, `// eslint-disable-next-line <rule>
  -- <reason>`, never for a file, and never `@ts-ignore`; a
  `@ts-expect-error` with a reason where the compiler is wrong.
- **Text from the user's files is never HTML.** A group can be named
  `<img onerror=…>`. lit-html escapes what it is given in a binding, and
  `unsafeHTML` is never used; D3 sets it with `.text()`, the DOM with
  `textContent`, never `innerHTML`.
- **No plain object is indexed by a string from the user's files**, which
  can be `__proto__` or `constructor`: such data is a `Map`.
- **Arrays are sorted with a comparator, into a copy**, `toSorted((a, b)
  => a - b)`: `sort()` with no comparator sorts numbers as text. Text the
  user sees is compared with `localeCompare`; anything that must be the
  same everywhere, with `<`.

## Names

- A name says what the value is, `numRows`, `activeClassification`,
  never `n`, `data`, `tmp`, `val`.
- The things of the app have the names of `docs/design.md`, section 1,
  and the same names as in Rust, in camelCase.
- `camelCase` for values, functions and fields, `PascalCase` for types,
  `UPPER_SNAKE_CASE` for a module constant that is a default or a fixed
  list. Files are `camelCase.ts`; a component's two files are
  `name.view.ts` and `name.controller.ts` (`SKILL.md`).
- A default that changes what the user gets is a named constant with a
  doc comment that says where it comes from.

## Errors

Two kinds of failure, handled in two ways.

**What can go wrong with good code is a value.** A file that cannot be
imported, a project of a newer version, a command the backend refused:
these are expected, the user is told, and the window shows them. A
function that can fail this way returns a `Result`, defined once in
`src/state/result.ts`:

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

and `E` is a discriminated union of the ways it fails, each with its
facts, which for a command are the backend's `CommandError` (`tauri.md`).
The text the user reads is written from it in one function beside the
type, so the tests assert the kind and the facts, not the wording. No
library for it: the type above is all of it.

**A defect is thrown.** A state the code makes impossible, a message that
does not decode, an index that cannot be out of range, throws an `Error`
whose message starts with `Vavilov Explorer defect:` and says what was
expected. Nothing catches it but the outermost handler of each window,
on the window's `error` and `unhandledrejection` events, and a command
the backend refused as a `Defect`. It shows the red bar the owner decided
on (`docs/design.md`, section 12): "Vavilov Explorer hit an internal
error. Your data has not been changed. Please save your work and report
this.", with a button that copies the technical details, the defect's
message, where it was thrown and the app's version, for the report. A
defect caught and passed over would hide a bug.

- Only `Error` objects are thrown.
- **A promise is awaited or returned, never left floating**: a promise
  nobody awaits loses its error. `void invoke(...)` is the floating
  promise this rule is for; the windowing spike wrote it, and a failed
  command there would have said nothing. An event handler that starts
  something asynchronous awaits it inside a function whose error reaches
  the handler above.
- `catch (error)` gives an `unknown`; it is narrowed with `instanceof
  Error` before its message is read.

## ESLint

`eslint.config.js`, with typescript-eslint's `strictTypeChecked` and
`stylisticTypeChecked` and type information from the project
(`parserOptions.projectService`), and these rules on top:

- `@typescript-eslint/no-floating-promises` (in the strict set),
  `switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions:
  false`, `strict-boolean-expressions` with strings and numbers not
  allowed as conditions, `consistent-type-imports`,
  `explicit-module-boundary-types`;
- `eqeqeq`, `prefer-const`, `no-console` but `warn` and `error`,
  `no-param-reassign` with `props: true`, and default exports refused;
- `consistent-type-assertions` set to `never` in `src/state` and
  `src/backend`, where a type assertion, `x as T`, would claim what was
  never checked; `as const` stays allowed. In the windows and the plots an
  assertion is sometimes the only way to type the DOM, and is then on one
  line with the reason;
- `no-restricted-imports` for each layer, from the table of `SKILL.md`,
  and for `@tauri-apps/api` outside `src/backend`;
- `linterOptions.reportUnusedDisableDirectives: "error"`.

popnei_web's `eslint.config.js`, described in its
`.claude/skills/coding/configs.md`, is the model for the layered
`no-restricted-imports`.

## Prettier

Prettier formats every TypeScript, CSS, HTML and JSON file, with its
defaults and `printWidth: 100`. The documents under `docs/` and the skills
are prose wrapped by hand and are left out (`.prettierignore`).
