/**
 * Unit tests for the `?` → `$n` rewriter.
 *
 * Every case here is a way the rewriter can be wrong without the compiler or the
 * database noticing at build time. The first one is a regression: that exact string
 * once hung the process in an out-of-memory loop because the `?` branch did not
 * advance its cursor, and it passed an earlier round of testing because the largest
 * SQL string in the codebase contains no placeholders and never entered the branch.
 *
 * Run without a database — `sql.ts` is pure, which is why it is not in `pool.ts`.
 */

import { toPostgres } from "../src/db/sql.js";

type Case = { input: string; want?: string; throws?: boolean; why: string };

const CASES: Case[] = [
  {
    input: "SELECT id, username, email, role, invited_by FROM profiles WHERE id = ?",
    want: "SELECT id, username, email, role, invited_by FROM profiles WHERE id = $1",
    why: "regression: a single placeholder once looped until the heap was exhausted",
  },
  {
    input: "SELECT a FROM t WHERE x = ? AND y = ? AND z = ?",
    want: "SELECT a FROM t WHERE x = $1 AND y = $2 AND z = $3",
    why: "numbering follows appearance order, which is how pg binds values",
  },
  {
    input: "WHERE note LIKE '%?%' AND id = ?",
    want: "WHERE note LIKE '%?%' AND id = $1",
    why: "a ? inside a string literal is data and must not be renumbered",
  },
  {
    input: "-- the deployment's schema\nSELECT ? FROM t",
    want: "-- the deployment's schema\nSELECT $1 FROM t",
    why: "an apostrophe in a line comment must not open a literal that swallows the rest",
  },
  {
    input: "/* a ? in a block comment */ SELECT ?",
    want: "/* a ? in a block comment */ SELECT $1",
    why: "block comments are opaque",
  },
  {
    input: "/* outer /* nested ? */ still comment */ ?",
    want: "/* outer /* nested ? */ still comment */ $1",
    why: "Postgres block comments nest; scanning for the first terminator exits early",
  },
  {
    input: 'SELECT "weird?col" FROM t WHERE x = ?',
    want: 'SELECT "weird?col" FROM t WHERE x = $1',
    why: "quoted identifiers are names, not literals",
  },
  {
    input: "SELECT 'it''s ? fine', ?",
    want: "SELECT 'it''s ? fine', $1",
    why: "'' is an escaped quote, not the end of the literal",
  },
  {
    input: "SELECT $$body ? here$$, ?",
    want: "SELECT $$body ? here$$, $1",
    why: "dollar-quoted bodies are opaque, as used for trigger definitions",
  },
  {
    input: "SELECT $tag$body ? here$tag$, ?",
    want: "SELECT $tag$body ? here$tag$, $1",
    why: "tagged dollar quoting must match its own closing tag",
  },
  {
    input: "SELECT $1, ?",
    throws: true,
    why: "mixing $n with ? renumbers from 1 and binds values to the wrong positions",
  },
  { input: "", want: "", why: "empty SQL is not an error" },
  { input: "?", want: "$1", why: "a lone placeholder" },
  { input: "??", want: "$1$2", why: "adjacent placeholders still number independently" },
  {
    input: "UPDATE t SET a = ?, b = ?",
    want: "UPDATE t SET a = $1, b = $2",
    why: "the shape used by every UPDATE in the routes",
  },
];

let failed = 0;

for (const c of CASES) {
  let got: string | undefined;
  let threw = false;
  try {
    got = toPostgres(c.input);
  } catch {
    threw = true;
  }

  const ok = c.throws ? threw : !threw && got === c.want;
  if (!ok) {
    failed += 1;
    console.log(`  FAIL: ${c.why}`);
    console.log(`    input ${JSON.stringify(c.input)}`);
    console.log(
      c.throws
        ? `    expected a throw, got ${JSON.stringify(got)}`
        : `    want ${JSON.stringify(c.want)}\n    got  ${JSON.stringify(threw ? "<threw>" : got)}`
    );
  }
}

console.log(
  failed === 0
    ? `  PASS: ${CASES.length}/${CASES.length} rewriter cases`
    : `\n  FAIL: ${failed}/${CASES.length}`
);
process.exit(failed === 0 ? 0 : 1);
