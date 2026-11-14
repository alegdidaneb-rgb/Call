#!/usr/bin/env node
/**
 * Generates `frontend/src/data/countries.ts` from the `world-countries` package
 * (an ISO 3166-1 dataset).
 *
 * The package is ~20 MB unpacked because it ships JSON, CSV, XML, YAML and flag
 * artwork. Depending on it at runtime would put all of that on the critical path
 * of a browser bundle, so instead it is used as a build-time source: this script
 * trims it to the fields the lead form needs and writes a plain, committed
 * TypeScript module (~250 entries, no runtime dependency).
 *
 * Usage:
 *   npm i --no-save world-countries   # not a dependency of the app on purpose
 *   npm run gen:countries
 *
 * Regenerate when the upstream dataset changes, or when a country is renamed,
 * gains independence, or is reassigned a dialling code.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(repoRoot, "frontend", "src", "data", "countries.ts");

let countries;
try {
  countries = require("world-countries");
} catch {
  console.error(
    "world-countries is not installed. Run:\n\n  npm i --no-save world-countries\n"
  );
  process.exit(1);
}

/**
 * International dialling prefix.
 *
 * The dataset splits a code into `idd.root` and `idd.suffixes`. Most countries
 * have exactly one suffix, which completes the prefix (GB is "+4" + "4"). The
 * NANP-style countries list every area code as a suffix, and for those the root
 * alone is the correct prefix (US is "+1", not "+1201").
 *
 * Two territories (AQ, HM) have no dialling code assigned; they get "" so the
 * UI can still record the country without inventing a prefix.
 */
function diallingCode(entry) {
  const root = entry.idd?.root ?? "";
  if (!root) return "";
  const suffixes = entry.idd?.suffixes ?? [];
  return suffixes.length === 1 ? `${root}${suffixes[0]}` : root;
}

const rows = countries
  .filter((entry) => entry.cca2 && entry.name?.common)
  .map((entry) => ({
    code: entry.cca2,
    name: entry.name.common,
    dial: diallingCode(entry),
    region: entry.region ?? "",
    // Used only to resolve shared dialling prefixes below; deliberately not
    // emitted, because nothing at runtime needs it.
    sovereign: Boolean(entry.independent && entry.unMember),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

const seen = new Set();
for (const row of rows) {
  if (seen.has(row.code)) throw new Error(`Duplicate country code: ${row.code}`);
  seen.add(row.code);
}

/**
 * Resolves each dialling prefix to a single country, or to null when the prefix
 * genuinely cannot identify one.
 *
 * Prefixes are shared: "+44" covers the UK, Guernsey, Jersey and the Isle of
 * Man; "+1" covers 26 NANP members. Rather than guess, prefer the one sovereign
 * UN member state in the group -- that resolves "+44" to GB and "+61" to AU over
 * Christmas Island and the Cocos Islands. Where several sovereign states share a
 * prefix, such as "+7" (Russia and Kazakhstan) or "+1" (the US, Canada and the
 * Caribbean), the answer stays null instead of silently picking one and getting
 * it wrong on a dialer where the country drives compliance rules.
 *
 * Computing this here keeps the policy in one reviewable place and means the
 * browser bundle never needs sovereignty data.
 */
const dialGroups = new Map();
for (const row of rows) {
  if (!row.dial) continue;
  const group = dialGroups.get(row.dial) ?? [];
  group.push(row);
  dialGroups.set(row.dial, group);
}

const dialPrimary = new Map();
for (const [dial, group] of dialGroups) {
  if (group.length === 1) {
    dialPrimary.set(dial, group[0].code);
    continue;
  }
  const sovereign = group.filter((entry) => entry.sovereign);
  dialPrimary.set(dial, sovereign.length === 1 ? sovereign[0].code : null);
}

const ambiguous = [...dialPrimary.entries()].filter(([, code]) => code === null);
console.log(
  `${rows.length} countries, ${dialPrimary.size} distinct dialling prefixes, ` +
    `${ambiguous.length} left ambiguous (${ambiguous.map(([dial]) => dial).join(", ")})`
);

const header = `/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Source: the \`world-countries\` package (ISO 3166-1), trimmed at build time by
 * \`scripts/generate-countries.mjs\`. Regenerate with \`npm run gen:countries\`.
 *
 * ${rows.length} countries and territories, sorted by English common name.
 */

export interface Country {
  /** ISO 3166-1 alpha-2 code. This is what \`leads.country\` stores. */
  code: string;
  /** English common name, for display. */
  name: string;
  /** International dialling prefix, e.g. "+44". Empty where none is assigned. */
  dial: string;
  /** UN geoscheme region. */
  region: string;
}

`;

const body =
  `export const COUNTRIES: Country[] = [\n` +
  rows
    .map(
      (row) =>
        `  { code: ${JSON.stringify(row.code)}, name: ${JSON.stringify(row.name)}, ` +
        `dial: ${JSON.stringify(row.dial)}, region: ${JSON.stringify(row.region)} },`
    )
    .join("\n") +
  `\n];\n`;

const helpers = `
/** O(1) lookup by ISO alpha-2 code. */
export const COUNTRY_BY_CODE: Record<string, Country> = Object.fromEntries(
  COUNTRIES.map((country) => [country.code, country])
);

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRY_BY_CODE[code.toUpperCase()]?.name ?? code;
}

export function diallingCodeFor(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRY_BY_CODE[code.toUpperCase()]?.dial ?? "";
}

/**
 * Flag from an alpha-2 code, using Unicode regional indicator symbols.
 * Computed rather than stored: it needs no image assets and no extra data.
 */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(
    ...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
  );
}

/**
 * Dialling prefix -> the single country it identifies, or null when it does not
 * identify one. Generated; see the note in scripts/generate-countries.mjs.
 */
export const DIAL_PRIMARY: Record<string, string | null> = __DIAL_PRIMARY__;

/** Longest dialling prefix in the table, e.g. "+1868" for Trinidad and Tobago. */
const MAX_DIAL_LENGTH = Math.max(
  ...Object.keys(DIAL_PRIMARY).map((dial) => dial.length),
  2
);

/**
 * Best guess at a country from a stored phone number, used to pre-fill the
 * picker for leads saved before \`country\` existed.
 *
 * Tries the longest prefix first, so "+1868" resolves to Trinidad and Tobago
 * rather than stopping at the shared "+1". Returns null when the number is not
 * in international format or its prefix is genuinely ambiguous -- callers should
 * then leave the choice to the user rather than assume.
 */
export function countryFromPhone(phone: string | null | undefined): Country | null {
  if (!phone) return null;
  const normalised = phone.replace(/[\\s().-]/g, "");
  if (!normalised.startsWith("+")) return null;

  for (let length = MAX_DIAL_LENGTH; length >= 2; length--) {
    const prefix = normalised.slice(0, length);
    if (!(prefix in DIAL_PRIMARY)) continue;
    const code = DIAL_PRIMARY[prefix];
    return code ? (COUNTRY_BY_CODE[code] ?? null) : null;
  }
  return null;
}
`;

const dialPrimaryLiteral =
  "{\n" +
  [...dialPrimary.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([dial, code]) =>
        `  ${JSON.stringify(dial)}: ${code ? JSON.stringify(code) : "null"},`
    )
    .join("\n") +
  "\n}";

const output = header + body + helpers.replace("__DIAL_PRIMARY__", dialPrimaryLiteral);

// The data directory is created here rather than committed empty, since git does
// not track directories and a fresh clone would otherwise fail to generate.
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output, "utf8");

console.log(
  `Wrote ${outPath} (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB source)`
);
