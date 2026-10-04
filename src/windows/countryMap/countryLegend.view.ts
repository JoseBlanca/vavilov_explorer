import { html, nothing } from "lit-html";
import type { TemplateResult } from "lit-html";

import { classOf } from "../shared/classOf.ts";
import styles from "./countryLegend.module.css";

/** What the legend of a map of countries shows. */
export interface CountryLegendProps {
  /** The most individuals in one country, 0 with none counted. */
  readonly largest: number;
  /** The groups whose individuals are counted, "in ESP and PER", or `null` for every individual. */
  readonly groups: string | null;
  /** Writes a count in the user's language. */
  readonly countWords: (value: number) => string;
}

/**
 * The legend over the map of countries: the colour of a country of no
 * individual, then the scale from one individual to the most in a country,
 * with its two ends written, or the colour of one alone when the most is
 * one (docs/design.md, section 2.2). With groups selected, a line under
 * its heading names them, "in ESP and PER". A screen reader is given the
 * scale as a sentence, "From 1 to 5 individuals", "From 1 to 5 individuals
 * in ESP and PER" (decided by the owner on 4 October 2026).
 */
export function countryLegendView(props: CountryLegendProps): TemplateResult {
  const { largest, groups, countWords } = props;
  const inGroups = groups === null ? "" : ` ${groups}`;
  return html`<section class=${classOf(styles, "legend")} aria-labelledby="legend-heading">
    <h2 id="legend-heading" class=${classOf(styles, "heading")}>Individuals per country</h2>
    ${groups === null ? nothing : html`<p class=${classOf(styles, "groups")}>${groups}</p>`}
    <p class=${classOf(styles, "row")}>
      <span class=${classOf(styles, "empty")} aria-hidden="true"></span>
      No individuals
    </p>
    ${
      largest === 0
        ? nothing
        : largest === 1
          ? html`<p class=${classOf(styles, "row")}>
              <span class=${classOf(styles, "one")} aria-hidden="true"></span>
              1 individual
            </p>`
          : html`<p class=${classOf(styles, "row")}>
              <span aria-hidden="true">1</span>
              <span class=${classOf(styles, "scale")} aria-hidden="true"></span>
              <span aria-hidden="true">${countWords(largest)}</span>
              <span class=${classOf(styles, "hidden")}
                >From 1 to ${countWords(largest)} individuals${inGroups}</span
              >
            </p>`
    }
  </section>`;
}
