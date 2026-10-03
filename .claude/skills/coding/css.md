# CSS

How the styles are written. They are popnei_web's rules
(`/Users/jose/devel/popnei_web/.claude/skills/coding/css.md`), for
lit-html in place of React and the engines of a desktop app in place of a
list of browsers. The colours of the points and bars are a decision of
the owner (`docs/design.md`, section 5), and their tokens are written
here once it is made.

Plain CSS: design tokens as custom properties in `src/styles/tokens.css`,
a CSS Module beside each component, and the global classes of the plots
in `src/plots/plots.css`. No Tailwind, no Sass, no CSS in JavaScript.

## Which CSS the engines have

The floor is the engine of Safari 17 (`typescript.md`, "The engines").
A feature an engine lacks does not fail loudly: the rule, or the whole
block, is ignored, and the window looks broken only on that platform.
This table is the check, from MDN's compatibility data:

| feature | first in Safari | here |
|---|---|---|
| custom properties, grid, flex with `gap`, `clamp()`, `min()`, `max()`, `:is()`, `:where()`, `:focus-visible`, `aspect-ratio`, logical properties, `prefers-color-scheme`, `prefers-reduced-motion` | before 15 | allowed |
| container queries, `@container` | 16 | allowed |
| `:has()` | 15.4 | allowed |
| `color-mix()`, `oklch()` | 16.2, 15.4 | allowed, and a colour is still written only in `tokens.css` |
| `subgrid` | 16 | allowed |
| the `popover` attribute | 17 | allowed |
| nesting, `&` | 17.2 | **not used**: above the floor |
| `light-dark()` | 17.5 | **not used**: the dark values are written out (below) |
| `@starting-style`, `text-wrap: balance` | 17.5 | **not used** |

A feature not in the table is looked up before it is used, and added
here with its version. When the floor rises, this table is revised first.

## The tokens

`src/styles/tokens.css` is the one place where a colour, a length of the
spacing, a size of type, a radius or a duration is written as a value.
Every other file uses the tokens, so that a change of the look is a
change there.

- **Colours are named by their role**, `--color-text-muted`,
  `--color-surface`, `--color-accent`, not by their hue, `--grey-600`.
  The colour of a group is not a token: it is part of the document,
  saved in the project, and the user can change it (`docs/design.md`,
  section 5). The fixed list a new group takes its colour from is a
  constant of the core, which assigns it.
- **Lengths are in `rem`**, and `px` only for borders and the focus ring.
- **No magic numbers.** A length in a component is a token, a `calc()` of
  tokens, `0`, `100%` or an `fr`. A value that is truly particular is
  written with a comment that says where it comes from. A number repeated
  in two files is a missing token.

## Light and dark

The app follows the system's appearance, light or dark, and has a
setting of its own, system, light or dark, as the owner decided on
2 October 2026 (`docs/design.md`, section 12). The setting belongs to the
app, not to a project: the backend keeps it with the app's settings and
sends it to every window like any other shared state, and each window
sets it as the attribute `data-theme` of `<html>`, absent for "system".
The dark theme is the same tokens with other values:

```css
:root { color-scheme: light dark; /* the light values */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; /* the dark values */ }
}
:root[data-theme="dark"] { color-scheme: dark; /* the same dark values */ }
:root[data-theme="light"] { color-scheme: light; }
```

The dark values are written twice, because the floor lacks
`light-dark()`, the one way to write them once; a Vitest test reads
`tokens.css` and checks that the two blocks declare the same values, so
that they cannot drift (as popnei_web does). `color-scheme` makes the
engine draw its own parts, scroll bars and the native controls, in the
same theme.

- A dark theme is not the light one inverted: surfaces that sit higher
  are lighter, pure black and white are avoided, and every pair of
  colours is measured again in the dark (below).
- The point views draw with WebGL, which reads no CSS: they read the
  tokens they use, the background and the ring around each point, with
  `getComputedStyle` when they are made and again when the appearance
  changes, by the system (a `matchMedia` listener) or by the setting (a
  message of the backend), and draw again.

## CSS Modules

Each component has its styles in a module of the same name,
`groupsPanel.module.css` beside its view, imported as
`import styles from "./groupsPanel.module.css"`. Vite renames every
class to a name of its own, so a class of one component cannot reach
another.

- **Only classes, in a module**: no element selectors, no ids, no
  `:global`. An element selector in a module reaches the elements of
  every child component.
- **Class names in camelCase**, named by what the element is,
  `.warningCount`, not by how it looks, `.yellowBadge`.
- **A class is read as `classOf(styles, "list")`**, a function of
  `src/windows/shared/classOf.ts` that throws a defect for a name the
  module does not have. Vite types a module as an object of any name, so
  `styles.list` cannot tell a class that exists from a misspelt one, and
  `noPropertyAccessFromIndexSignature` refuses it anyway (popnei_web met
  this and wrote `classOf`).
- **Flat and short selectors**: a class, a class with a state,
  `.row[aria-selected="true"]`. Specificity stays low and equal, and no
  `!important`.
- **Global CSS is three files**: `tokens.css`; `src/styles/base.css`, a
  small reset, the body and the default focus ring; and
  `src/plots/plots.css`, the `plot-` classes D3 writes.

## Layout

- **Grid for two dimensions**, the main window's panel and table; **flex
  for one**, a row of buttons.
- **Space between siblings is `gap` on the parent**, not a margin on the
  child.
- **No fixed heights on anything that holds text**, but the table's rows,
  whose height is fixed for the scrolling (`frontend.md`) and holds one
  line that is cut with an ellipsis and shown whole on hover or focus.
- **A plot's element** gets its size from CSS, a width and a height from
  its container, and the plot reads it (`frontend.md`).
- Views where a drag means rotate, pan, brush or lasso have
  `user-select: none`, or a drag selects the labels' text
  (`docs/prototype-lessons.md`, "CSS pitfalls"). A `fieldset` gets
  `min-width: 0`, or it overflows a narrow panel.

## Focus

- **The focus ring is never removed.** `outline: none` appears only in a
  rule that draws another ring. A user of the keyboard without a ring does
  not know where they are.
- `:focus-visible`, so the ring shows for the keyboard and not after a
  click; an `outline`, 2px, with an offset, in `--color-focus`, at least
  3:1 against the background in both themes.
- A `<dialog>` takes the focus when it opens and gives it back when it
  closes.

## Contrast and colour

At WCAG 2.2 level AA, as the owner decided, in both themes:

| what | against what is next to it |
|---|---|
| text | 4.5:1 |
| large text, 24px, or 18.66px bold | 3:1 |
| the parts of a control that show it is one, and its states | 3:1 |
| the marks of a plot that carry its meaning, points and bars | 3:1 against the background |
| the focus ring | 3:1 |

- A Vitest test computes the ratios of the pairs of tokens used together,
  with the formula of WCAG, in both themes, and fails below the limit. A
  pair is added when a component starts to use it.
- **Colour is never the only sign.** The groups differ in colour and
  in shape (`prototype-lessons.md`, the five shapes of the point views),
  and the legend names them; an error has its words; a selected row has
  its state in `aria-selected` and a mark, not only a colour.
- The list of colours of the groups starts from Okabe and Ito's,
  which the common kinds of colour blindness can tell apart, as the owner
  decided; past its end it repeats in a lighter or darker shade
  (`docs/design.md`, section 5). The exact shades are chosen when the list
  is written, and shown to the owner.

## Size of the targets

A control aimed at with the pointer is at least 24 by 24 CSS px, or has
that much space clear around it, so that it is not missed.

## Motion

Transitions are short, take their duration from a token, and change
colour or opacity, not the layout. With reduced motion on, the duration
tokens are zero, in one `@media (prefers-reduced-motion: reduce)` rule in
`tokens.css`.

## Fonts

The fonts of the system, as the owner decided: `system-ui` and
`ui-monospace`, with nothing to download and the look each platform's
users know. Numbers in the table
use `font-variant-numeric: tabular-nums`, so that the digits of a column
line up.
