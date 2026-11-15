/**
 * Two checks for the bug class a sync-to-async port introduces and `tsc` cannot see.
 *
 * This exists because `tsc` cannot catch the bug. Porting a synchronous database
 * facade to an asynchronous one means a missed `await` turns a row into a Promise,
 * and a Promise is an object — always truthy. So `if (!row)` silently becomes
 * "never taken", `if (row)` silently becomes "always taken", and both typecheck
 * perfectly because the expression is a legal boolean coercion of an object.
 *
 * The result is an authorisation check that always passes, or a 404 branch that
 * never fires. Neither is a type error, so the compiler reports success on a
 * backend whose access control has been inverted.
 *
 * Positions inspected: `if`/`while`/`do`/`for` tests, the conditional operator's
 * test, unary `!`, and both operands of `&&`/`||`.
 */

import ts from "typescript";
import path from "node:path";

const configPath = path.resolve("tsconfig.lint.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));

const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

function isPromiseLike(type: ts.Type): boolean {
  // Structural rather than nominal: anything with a `then` method is awaited by the
  // runtime, so anything with a `then` method is wrong in a boolean position.
  const then = type.getProperty("then");
  if (!then) return false;
  const thenType = checker.getTypeOfSymbolAtLocation(then, then.valueDeclaration!);
  return thenType.getCallSignatures().length > 0;
}

function flag(node: ts.Node, position: string): void {
  const type = checker.getTypeAtLocation(node);
  if (!isPromiseLike(type)) return;
  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  const text = node.getText().split("\n")[0].slice(0, 72);
  console.log(`  ${node.getSourceFile().fileName}:${line + 1}  [${position}]  ${text}`);
  found += 1;
}

let found = 0;

/**
 * A `.get()`/`.all()`/`.run()`/`.exec()` call whose promise nobody awaits.
 *
 * Also invisible to `tsc`. Discarding the result of `.run()` is legal TypeScript —
 * the promise is simply never observed. The query still executes, but a rejection
 * becomes an unhandled one, and any code that assumed the write had landed now runs
 * before it has. On a serverless platform the instance can be frozen mid-flight and
 * the write never happens at all.
 *
 * `void expr` is accepted as deliberate fire-and-forget.
 */
const DB_METHODS = new Set(["get", "all", "run", "exec"]);

/**
 * Whether a type is one of ours from the database facade.
 *
 * Matching on method name alone is not enough, and the first run proved it: it
 * reported `router.get(...)`, `app.get(...)` and `regex.exec(...)` as unawaited
 * database calls. Those names are ubiquitous in Express code, so a name test
 * produces nothing but noise — and a checker that cries wolf gets ignored, which
 * is worse than not having it.
 *
 * The receiver's declaring file is unambiguous. `db.prepare(...)` yields a
 * `Statement` and `db` itself is a `Db`, both declared in `src/db/pool.ts`;
 * Express's `Router` and the built-in `RegExp` are declared elsewhere. This also
 * survives renaming the methods, which a name list would not.
 */
function isOurDbType(type: ts.Type): boolean {
  const seen = new Set<ts.Type>();
  const queue = [type];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const symbol of [current.getSymbol(), current.aliasSymbol]) {
      const decls = symbol?.declarations ?? [];
      if (decls.some((d) => d.getSourceFile().fileName.replace(/\\/g, "/").endsWith("src/db/pool.ts"))) {
        return true;
      }
    }
    // Look through unions and generic instantiations to the members underneath.
    if (current.isUnion()) queue.push(...current.types);
    const typeArgs = (current as ts.TypeReference).typeArguments;
    if (typeArgs) queue.push(...typeArgs);
  }
  return false;
}

function isDbCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr) || !DB_METHODS.has(expr.name.text)) return false;
  return isOurDbType(checker.getTypeAtLocation(expr.expression));
}

function checkUnawaited(node: ts.Node): void {
  if (!isDbCall(node)) return;
  const parent = node.parent;
  if (ts.isAwaitExpression(parent)) return;
  if (ts.isVoidExpression(parent)) return;
  // `return db.prepare(...).run(...)` inside an async function is fine: the caller
  // gets the promise. Same for yielding it or passing it on.
  if (ts.isReturnStatement(parent) || ts.isYieldExpression(parent)) return;
  if (ts.isCallExpression(parent) || ts.isPropertyAccessExpression(parent)) return;
  if (ts.isArrowFunction(parent) && parent.body === node) return;
  // A variable declaration is only safe if something later awaits it; that is a
  // dataflow question this pass does not attempt, so report it for a human.
  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  console.log(
    `  ${node.getSourceFile().fileName}:${line + 1}  [unawaited]  ` +
      node.getText().split("\n")[0].slice(0, 72)
  );
  unawaited += 1;
}

let unawaited = 0;

function walk(node: ts.Node): void {
  checkUnawaited(node);
  if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    flag(node.expression, "if/while/do-test");
  } else if (ts.isForStatement(node) && node.condition) {
    flag(node.condition, "for-condition");
  } else if (ts.isConditionalExpression(node)) {
    flag(node.condition, "ternary-test");
  } else if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken
  ) {
    flag(node.operand, "unary-!");
  } else if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    const label =
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? "??" : "&&/||";
    flag(node.left, `${label}-left`);
    flag(node.right, `${label}-right`);
  }
  ts.forEachChild(node, walk);
}

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (sf.fileName.includes("node_modules")) continue;
  walk(sf);
}

if (unawaited > 0) console.log(`\n  ${unawaited} unawaited db call(s)`);
const failed = found + unawaited;
console.log(
  failed === 0
    ? "\n  PASS: no Promise in a boolean position, no unawaited db call"
    : `\n  FAIL: ${found} promise-boolean, ${unawaited} unawaited`
);
process.exit(failed === 0 ? 0 : 1);
