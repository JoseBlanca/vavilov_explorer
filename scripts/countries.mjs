// Generates crates/vavilov-core/src/countries/table.rs, the countries the
// country sub-role accepts (docs/design.md, section 6), from Debian's
// iso-codes (ISO 3166-1 and 3166-3), at a pinned release. Run it by hand when ISO
// changes a country, with `node scripts/countries.mjs`, and commit what it
// writes; it is not part of the build or of any check.
//
// The rules:
// - a current country is named by its two- and three-letter codes, its ISO
//   name and official name, and shown by its three-letter code;
// - a former country is named by its ISO name and four-letter code, and by
//   its two- and three-letter codes unless a current country has them; it is
//   shown by its three-letter code, or its four-letter one when a current
//   country has the three-letter one;
// - names are compared in lower case, surrounding spaces removed; a name
//   that two countries would share goes to the current one, and between two
//   current or two former countries is left out, and listed when the script
//   runs;
// - each country shown by a code is listed with its common name, which the
//   windows show, and a current one with its ISO numeric code, which the
//   map's shapes are named by (docs/design.md, section 2.2); a former one
//   has none, since the map does not draw it. The common name is the one of
//   iso-codes, or, where ISO's name is not the common one, the one of
//   COMMON_NAMES below, or else ISO's name; a name shown with a comma is
//   refused, so that a new long name of ISO is given its common one here.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";

const ISO_CODES = "https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/v4.20.1/data";
const OUT = new URL("../crates/vavilov-core/src/countries/table.rs", import.meta.url);

// The SHA-256 of each source, as the committed table was made from them on
// 2 October 2026: a tag or a release moved since is refused rather than
// read. A new release is a new URL and a new hash, written here by hand.
const SHA256 = new Map([
  [
    `${ISO_CODES}/iso_3166-1.json`,
    "f01b812b57fba9f31ff621bf33e7c7570a01964dbeb5be2167e94decf538c89f",
  ],
  [
    `${ISO_CODES}/iso_3166-3.json`,
    "eb92d1cce3e352559f610e60e2acb23687eb1cf07b23675fb112863a5741a6fa",
  ],
]);

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== SHA256.get(url)) {
    throw new Error(
      `${url}: SHA-256 ${hash}, not the ${String(SHA256.get(url))} the script expects`,
    );
  }
  return JSON.parse(bytes.toString("utf8"));
}

const current = (await json(`${ISO_CODES}/iso_3166-1.json`))["3166-1"];
const former = (await json(`${ISO_CODES}/iso_3166-3.json`))["3166-3"];

const currentAlpha2 = new Set(current.map((country) => country.alpha_2));
const currentAlpha3 = new Set(current.map((country) => country.alpha_3));

/** Each name, in lower case, with the codes it is shown as and whether those are current. */
const names = new Map();
function add(name, code, isCurrent) {
  const key = name.trim().toLowerCase();
  if (key === "") return;
  const entry = names.get(key) ?? { current: new Set(), former: new Set() };
  (isCurrent ? entry.current : entry.former).add(code);
  names.set(key, entry);
}

for (const country of current) {
  const code = country.alpha_3;
  for (const name of [country.alpha_2, country.alpha_3, country.name, country.official_name]) {
    if (name !== undefined) add(name, code, true);
  }
}
for (const country of former) {
  const code = currentAlpha3.has(country.alpha_3) ? country.alpha_4 : country.alpha_3;
  add(country.name, code, false);
  add(country.alpha_4, code, false);
  if (!currentAlpha3.has(country.alpha_3)) add(country.alpha_3, code, false);
  if (!currentAlpha2.has(country.alpha_2)) add(country.alpha_2, code, false);
}

const table = [];
const leftOut = [];
for (const [name, { current: now, former: then }] of names) {
  const codes = now.size > 0 ? now : then;
  if (codes.size === 1) {
    table.push([name, [...codes][0]]);
  } else {
    leftOut.push(`${name}: ${[...codes].join(", ")}`);
  }
}
// Sorted by their UTF-8 bytes, the order of Rust's binary search on &str;
// for these names, all in the Basic Multilingual Plane, the order of
// JavaScript's comparison of strings is the same.
table.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The common names of the countries whose ISO name is not the one people
 * use and iso-codes gives no other, by the code they are shown by: written
 * by hand, in the words of CLDR's English names where those fit, but for
 * the former countries, which CLDR names by their successors (decided by
 * the owner on 4 October 2026).
 */
const COMMON_NAMES = new Map([
  ["BES", "Caribbean Netherlands"],
  ["BRN", "Brunei"],
  ["COD", "Democratic Republic of the Congo"],
  ["COG", "Republic of the Congo"],
  ["FLK", "Falkland Islands"],
  ["FSM", "Micronesia"],
  ["MAF", "Saint Martin"],
  ["PSE", "Palestine"],
  ["RUS", "Russia"],
  ["SHN", "Saint Helena"],
  ["SXM", "Sint Maarten"],
  ["VAT", "Vatican City"],
  ["VGB", "British Virgin Islands"],
  ["VIR", "U.S. Virgin Islands"],
  ["BUMM", "Burma"],
  ["BYAA", "Byelorussian SSR"],
  ["CSHH", "Czechoslovakia"],
  ["FXFR", "Metropolitan France"],
  ["HVBF", "Upper Volta"],
  ["SUHH", "Soviet Union"],
  ["VDVN", "North Vietnam"],
  ["YDYE", "South Yemen"],
  ["YUCS", "Yugoslavia"],
  ["ZRCD", "Zaire"],
]);

/** The common name of a country of iso-codes, known by `key`, its code in COMMON_NAMES. */
function commonName(country, key) {
  const name = COMMON_NAMES.get(key) ?? country.common_name ?? country.name;
  if (name.includes(",")) {
    throw new Error(
      `${key}: the name ${name} has a comma; give it its common name in COMMON_NAMES`,
    );
  }
  return name;
}

/** Each country by the code it is shown by: its common name, and its numeric code when current. */
const shown = [
  ...current.map((country) => [
    country.alpha_3,
    commonName(country, country.alpha_3),
    country.numeric,
  ]),
  ...former.map((country) => [
    currentAlpha3.has(country.alpha_3) ? country.alpha_4 : country.alpha_3,
    commonName(country, country.alpha_4),
    null,
  ]),
];
const unused = [...COMMON_NAMES.keys()].filter(
  (key) =>
    !current.some((country) => country.alpha_3 === key) &&
    !former.some((country) => country.alpha_4 === key),
);
if (unused.length > 0) {
  throw new Error(`COMMON_NAMES of no country: ${unused.join(", ")}`);
}
shown.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
for (let index = 1; index < shown.length; index += 1) {
  if (shown[index][0] === shown[index - 1][0]) {
    throw new Error(`two countries shown as ${shown[index][0]}`);
  }
}
for (const [code, , numeric] of shown) {
  if (numeric !== null && !/^[0-9]{3}$/.test(numeric)) {
    throw new Error(`${code}: a numeric code ${String(numeric)} of other than three digits`);
  }
}

const rust = (text) => JSON.stringify(text);
const lines = table.map(([name, code]) => `    (${rust(name)}, ${rust(code)}),`);
const countryLines = shown.map(
  ([code, name, numeric]) =>
    `    (${rust(code)}, ${rust(name)}, ${numeric === null ? "None" : `Some(${rust(numeric)})`}),`,
);
fs.writeFileSync(
  OUT,
  `//! Every name and code of a country the country sub-role accepts, in lower
//! case, with the code the country is shown by, sorted by name; and each
//! country by the code it is shown by, with its common name and, for a
//! current one, its ISO numeric code, sorted by code. Generated by
//! scripts/countries.mjs on ${new Date().toISOString().slice(0, 10)} from Debian's iso-codes v4.20.1
//! (ISO 3166-1 and 3166-3); do not edit it by hand.

/// The names, in lower case, and the code of each country.
pub(crate) const NAMES: &[(&str, &str)] = &[
${lines.join("\n")}
];

/// Each country by the code it is shown by, with its common name and, for
/// a current country, its ISO numeric code of three digits.
pub(crate) const COUNTRIES: &[(&str, &str, Option<&str>)] = &[
${countryLines.join("\n")}
];
`,
);
console.log(
  `${String(table.length)} names of ${String(current.length)} current and ${String(former.length)} former countries`,
);
console.log(
  `left out, shared by two countries: ${leftOut.length === 0 ? "none" : leftOut.join("; ")}`,
);
