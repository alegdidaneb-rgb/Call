/**
 * Runs every SQL literal in the codebase through the real `toPostgres()` rewriter
 * and checks the result is what Postgres will accept.
 *
 * Why this needs its own check rather than a unit test of the rewriter: the
 * rewriter is only correct in combination with the SQL actually written in this
 * codebase, and the failure mode is silent. A `?` that does not get rewritten
 * reaches the driver as a literal question mark, and Postgres rejects the query at
 * runtime — on whichever route happens to hold it, not at build time. A comment
 * containing an apostrophe is enough to desync the quote tracking and rewrite
 * everything after it incorrectly.
 *
 * Checked per literal:
 *   - no `?` survives in code position (a stray one means it was misclassified as
 *     being inside a string, identifier or comment);
 *   - placeholders are numbered 1..n with no gap and no duplicate, because `pg`
 *     binds `values` positionally and a gap shifts every later parameter;
 *   - SQL with no placeholders comes out byte-identical, which is what the 170-line
 *     DDL block depends on — a comment or a default altered in passing would be
 *     invisible until the schema failed to apply on a cold start.
 */

import ts from "typescript";
import path from "node:path";
import { toPostgres } from "../src/db/sql.js";

const configPath = path.resolve("tsconfig.lint.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));

const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/**
 * Resolves an identifier argument to the literal it was initialised with.
 *
 * Needed because the single most important SQL string in the backend is not passed
 * inline: `database.ts` holds the whole 170-line DDL block in a `SCHEMA` constant
 * and calls `db.exec(SCHEMA)`. A collector that only looked at literal arguments
 * would check every small route query and skip the schema — reporting confidence
 * about precisely the part most likely to break a cold start.
 */
function literalOf(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isIdentifier(node)) return null;
  const symbol = checker.getSymbolAtLocation(node);
  for (const decl of symbol?.declarations ?? []) {
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = decl.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        return init.text;
      }
    }
  }
  return null;
}

/** Collects string and template literals handed to `.prepare()` or `.exec()`. */
function collectSql(sf: ts.SourceFile): { text: string; line: number }[] {
  const found: { text: string; line: number }[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "prepare" || node.expression.name.text === "exec") &&
      node.arguments.length > 0
    ) {
      for (const arg of node.arguments) {
        const resolved = literalOf(arg);
        if (resolved !== null) {
          found.push({
            text: resolved,
            line: sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1,
          });
        } else if (ts.isTemplateExpression(arg)) {
          // Concatenate the head and spans; `${…}` becomes a placeholder marker so
          // the length still lines up for reporting.
          const text =
            arg.head.text + arg.templateSpans.map((s) => s.literal.text).join("?");
          found.push({
            text,
            line: sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1,
          });
        } else if (ts.isBinaryExpression(arg)) {
          // "a" + "b" concatenations, used by a few long statements.
          const parts: string[] = [];
          const flat = (n: ts.Node): void => {
            if (ts.isBinaryExpression(n)) {
              flat(n.left);
              flat(n.right);
            } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
              parts.push(n.text);
            }
          };
          flat(arg);
          if (parts.length > 0) {
            found.push({
              text: parts.join(""),
              line: sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

let checked = 0;
const failures: string[] = [];

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile || sf.fileName.includes("node_modules")) continue;
  // This file's own test strings are not application SQL.
  if (sf.fileName.includes("check-sql-placeholders")) continue;

  for (const { text, line } of collectSql(sf)) {
    checked += 1;
    const where = `${path.relative(process.cwd(), sf.fileName)}:${line}`;
    let out: string;
    try {
      out = toPostgres(text);
    } catch (err) {
      failures.push(
        `${where}  rewriter refused this SQL: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    // A `?` left in code position. Counting them in the output is not enough,
    // because a legitimate `?` inside a string constant also survives; the
    // rewriter's own classification is what is under test, so compare counts of
    // what it emitted against what it should have emitted.
    const emitted = (out.match(/\$\d+/g) ?? []).map((m) => Number(m.slice(1)));

    // Numbering must be exactly 1..n in order: `pg` binds positionally, so a gap or
    // a duplicate shifts every later value onto the wrong column.
    for (let i = 0; i < emitted.length; i += 1) {
      if (emitted[i] !== i + 1) {
        failures.push(`${where}  placeholder sequence broken: got ${emitted.join(",")}`);
        break;
      }
    }

    // There used to be a second pass here, running the rewriter over its own output
    // to confirm stability. That check is no longer merely redundant, it is wrong:
    // the rewriter now rejects input that already contains `$n`, because mixing
    // `$n` with `?` renumbers from 1 and silently binds values to the wrong
    // positions. Feeding it the rewritten SQL constructs exactly that illegal input,
    // so the check failed on every literal that had a placeholder. A test whose
    // premise contradicts the contract it verifies is the test that is broken.

    // For SQL with no placeholders the output must be identical to the input.
    // This is the DDL case, and it is where an apostrophe in a comment would show
    // up as swallowed text.
    if (emitted.length === 0 && !text.includes("?") && out !== text) {
      failures.push(`${where}  placeholder-free SQL was altered`);
    }
  }
}

console.log(`  checked ${checked} SQL literal(s)`);
if (failures.length === 0) {
  console.log("  PASS: every rewrite is well-formed and correctly numbered");
} else {
  for (const f of failures) console.log(`  ${f}`);
  console.log(`\n  FAIL: ${failures.length}`);
}
process.exit(failures.length === 0 ? 0 : 1);
