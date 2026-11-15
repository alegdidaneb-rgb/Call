/**
 * SQL text rewriting, isolated from the connection pool.
 *
 * This is a pure function of a string, and it lives in its own module so that the
 * checks in `scripts/` can exercise it without importing `pool.ts` — which builds a
 * connection pool at module scope and therefore requires `DATABASE_URL` to be set.
 * A test that needs a database URL to validate string rewriting will not run in CI,
 * and a check nobody can run is a check that rots.
 */

/**
 * Rewrites SQLite-style `?` placeholders to Postgres-style `$1, $2, …`.
 *
 * A `?` is a placeholder only where it appears as SQL code. Everything else is
 * copied through untouched:
 *
 *   - `'string literals'`, where `''` is an escaped quote rather than the end of
 *     the literal. Postgres runs with `standard_conforming_strings` on, so a
 *     backslash is *not* an escape inside `'…'` and doubling is the only form.
 *   - `"quoted identifiers"`. A column may legitimately be named with a `?`, and
 *     rewriting inside the name would corrupt it.
 *   - `-- line comments` and block comments. These matter more than they look: a
 *     comment containing an apostrophe ("the deployment's schema") would otherwise
 *     read as opening a string literal, and every `?` after it would be skipped.
 *     The query would reach Postgres with unreplaced placeholders and fail with
 *     "there is no parameter $1" — a long way from the comment that caused it.
 *     Block comments nest in Postgres, so the depth is tracked rather than scanned
 *     for the first terminator.
 *   - `$$dollar-quoted$$` bodies, used for function and trigger definitions.
 *
 * Numbering follows appearance order, which is the order `pg` expects `values` in.
 */
export function toPostgres(sql: string): string {
  let out = "";
  let index = 0;
  let blockDepth = 0;
  let i = 0;

  /** Copies the current character verbatim and advances. */
  const copy = (): void => {
    out += sql[i];
    i += 1;
  };

  /** Copies a quoted run, honouring doubling as the in-quote escape. */
  const copyQuoted = (quote: string): void => {
    out += quote;
    i += 1;
    while (i < sql.length) {
      if (sql[i] === quote) {
        if (sql[i + 1] === quote) {
          out += quote + quote;
          i += 2;
          continue;
        }
        out += quote;
        i += 1;
        return;
      }
      copy();
    }
    // Unterminated quote: stop rather than guess, and let Postgres report it.
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    // Termination guard. Every branch below must consume at least one character; if
    // one ever fails to, the loop would append to `out` until the heap is exhausted
    // and take the process down with an out-of-memory crash rather than an error.
    // That is not hypothetical: the `?` branch shipped once without advancing `i`,
    // and it passed a first round of testing because the largest SQL string in the
    // codebase contains no placeholders and so never entered that branch. Turning
    // the failure into a thrown error costs one comparison per character.
    const before = i;

    // Inside a block comment: watch only for nesting and the terminator.
    if (blockDepth > 0) {
      if (ch === "/" && next === "*") {
        blockDepth += 1;
        out += "/*";
        i += 2;
      } else if (ch === "*" && next === "/") {
        blockDepth -= 1;
        out += "*/";
        i += 2;
      } else {
        copy();
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      blockDepth = 1;
      out += "/*";
      i += 2;
      continue;
    }

    // Line comment: copy to end of line, apostrophes and question marks and all.
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") copy();
      continue;
    }

    if (ch === "'") {
      copyQuoted("'");
      continue;
    }

    if (ch === '"') {
      copyQuoted('"');
      continue;
    }

    if (ch === "$") {
      /**
       * A `$n` already present in the input is a hard error, not something to
       * renumber around.
       *
       * Placeholders are numbered from 1 by counting the `?` this function
       * converts, so SQL that mixes an existing `$1` with a `?` produces two `$1`s.
       * `pg` binds `values` positionally, which means the second parameter would be
       * read into the first slot and every later value shifted — a query that runs,
       * returns rows, and is quietly wrong. Nothing downstream can detect that.
       *
       * Mixed input means the SQL was written for Postgres and should never have
       * been routed through a SQLite-compatibility rewriter at all, so the useful
       * response is to name the mistake rather than guess at an intent.
       *
       * Tested against `next` rather than a regex over a slice: this branch runs for
       * every `$` in every query, and slicing the remainder each time would make the
       * rewriter quadratic on placeholder-heavy SQL.
       */
      if (next !== undefined && next >= "0" && next <= "9") {
        throw new Error(
          "toPostgres received SQL that already contains $" + next + " placeholders. " +
            "Use either ? or $n in a query, not both: mixing them renumbers from 1 " +
            "and binds parameters to the wrong positions. Near: " +
            JSON.stringify(sql.slice(Math.max(0, i - 32), i + 32))
        );
      }

      // Dollar quoting. Only an opening tag of the form $$ or $tag$ starts a body.
      const startsTag =
        next === "$" ||
        next === "_" ||
        (next !== undefined && ((next >= "A" && next <= "Z") || (next >= "a" && next <= "z")));
      if (startsTag) {
        const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
        if (tag) {
          const end = sql.indexOf(tag, i + tag.length);
          const stop = end === -1 ? sql.length : end + tag.length;
          out += sql.slice(i, stop);
          i = stop;
          continue;
        }
      }
    }

    if (ch === "?") {
      index += 1;
      out += `$${index}`;
      // Advancing here is the whole step. Omitting it leaves `i` pointing at the
      // same `?` forever, appending `$1$2$3…` until the heap is exhausted — an
      // infinite loop, not a wrong result, so it takes the process down rather than
      // returning a bad query. It survived a first round of testing because the DDL
      // block, the largest SQL string in the codebase, contains no placeholders at
      // all and so never entered this branch.
      i += 1;
      continue;
    }

    copy();

    if (i <= before) {
      throw new Error(
        `toPostgres did not advance at offset ${before} of ${sql.length} ` +
          `(near ${JSON.stringify(sql.slice(before, before + 24))})`
      );
    }
  }

  return out;
}
