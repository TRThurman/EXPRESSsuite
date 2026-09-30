#!/usr/bin/env node
// Builds a differential-testing oracle from eengine (p21eval).
//
// eengine is an independent ISO 10303-11 implementation, so it answers the
// question our own diagnostics cannot: is this schema actually valid EXPRESS?
// Per the documented procedure, a resource schema passes when `--flat` exits 0
// AND the emitted .flat contains no case-insensitive "nil" (each nil marks an
// unresolved reference).
//
// Usage:
//   node scripts/build-eengine-oracle.mjs \
//     --corpus <stepmod>/schemas/resources --stepmod <stepmod> \
//     [--out test-fixtures/eengine-oracle.json]
//
// Scope: resource schemas only (-mode mim_shortform). Module ARM/MIM and
// long-form files take different modes; do not guess them here.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const corpus = resolve(arg("corpus", ""));
const stepmod = resolve(arg("stepmod", ""));
const out = resolve(arg("out", "test-fixtures/eengine-oracle.json"));
if (!corpus || !stepmod) {
  console.error("--corpus and --stepmod are required");
  process.exit(2);
}

const home = process.env.HOME;
const candidates = readdirSync(join(home, "work/eengine"))
  .filter((f) => /^p21eval-.*-sbcl$/.test(f))
  .map((f) => join(home, "work/eengine", f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (candidates.length === 0) {
  console.error("no p21eval-*-sbcl build found in ~/work/eengine (never use ~/bin/eengine)");
  process.exit(2);
}
const p21eval = candidates[0];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".exp") ? [join(dir, e.name)] : []
  );

const schemas = walk(corpus).sort();
const verdicts = {};
let valid = 0;

for (const schema of schemas) {
  const rel = schema.slice(corpus.length + 1);
  const flat = schema.replace(/\.exp$/, ".flat");
  const preexisting = existsSync(flat);
  let exit = 0;
  try {
    execFileSync(p21eval, ["--flat", "-mode", "mim_shortform", "-schema", schema, "-stepmod", stepmod, "-typeof", "noschema"], {
      stdio: "ignore",
      timeout: 300000,
    });
  } catch (e) {
    exit = typeof e.status === "number" ? e.status : 1;
  }
  let nil = null;
  if (existsSync(flat)) {
    nil = (readFileSync(flat, "utf8").match(/nil/gi) ?? []).length;
    if (!preexisting) rmSync(flat); // never leave artifacts in the corpus tree
  }
  const ok = exit === 0 && nil === 0;
  if (ok) valid++;
  verdicts[rel] = { exit, nil, valid: ok };
  process.stdout.write(`${ok ? "." : "F"}`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  // No absolute paths recorded: this fixture is committed to a public repository.
  JSON.stringify({ tool: p21eval.split("/").pop(), mode: "mim_shortform", schemas: schemas.length, valid, verdicts }, null, 2)
);
console.log(`\n${schemas.length} schemas, ${valid} judged valid by eengine -> ${out}`);
