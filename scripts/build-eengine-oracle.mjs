#!/usr/bin/env node
// Builds a differential-testing oracle from eengine (p21eval).
//
// eengine is an independent ISO 10303-11 implementation, so it answers the
// question our own diagnostics cannot: is this schema actually valid EXPRESS?
// Per the documented procedure a schema passes when `--flat` exits 0 AND the
// emitted .flat contains no case-insensitive "nil" (each nil marks an
// unresolved reference).
//
// Usage:
//   node scripts/build-eengine-oracle.mjs \
//     --corpus <stepmod>/schemas --stepmod <stepmod> \
//     [--out test-fixtures/eengine-oracle.json] [--jobs 8] [--resume]
//
// The -mode argument depends on the kind of file, per the documented mode table:
// resource schemas and module MIMs are mim_shortform, module ARMs arm_shortform,
// and the generated long forms arm_longform / mim_longform. Files whose kind is
// not one of these are recorded as skipped rather than guessed at.
//
// The run is long (thousands of eengine invocations), so it writes the fixture
// incrementally and `--resume` continues from whatever is already recorded.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const corpus = resolve(arg("corpus", ""));
const stepmod = resolve(arg("stepmod", ""));
const out = resolve(arg("out", "test-fixtures/eengine-oracle.json"));
const jobs = Math.max(1, Number(arg("jobs", Math.max(1, Math.min(8, availableParallelism() - 2)))));
if (!arg("corpus", "") || !arg("stepmod", "")) {
  console.error("--corpus and --stepmod are required");
  process.exit(2);
}

const home = process.env.HOME;
const p21eval = readdirSync(join(home, "work/eengine"))
  .filter((f) => /^p21eval-.*-sbcl$/.test(f))
  .map((f) => join(home, "work/eengine", f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!p21eval) {
  console.error("no p21eval-*-sbcl build found in ~/work/eengine (never use ~/bin/eengine)");
  process.exit(2);
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".exp") ? [join(dir, e.name)] : []
  );

/** eengine -mode by file kind; undefined when the kind is not classifiable. */
const modeFor = (path) => {
  const base = path.split("/").pop();
  if (path.includes("/resources/")) return "mim_shortform";
  if (path.includes("/modules/")) {
    if (base === "arm.exp") return "arm_shortform";
    if (base === "mim.exp") return "mim_shortform";
    if (base === "arm_lf.exp") return "arm_longform";
    if (base === "mim_lf.exp") return "mim_longform";
  }
  return undefined;
};

const schemas = walk(corpus).sort();
const verdicts = flag("resume") && existsSync(out) ? JSON.parse(readFileSync(out, "utf8")).verdicts ?? {} : {};
const alreadyDone = Object.keys(verdicts).length;

const save = () => {
  const valid = Object.values(verdicts).filter((v) => v.valid).length;
  const skipped = Object.values(verdicts).filter((v) => v.skipped).length;
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  // No absolute paths recorded: this fixture is committed to a public repository.
  writeFileSync(tmp, `${JSON.stringify({ tool: p21eval.split("/").pop(), schemas: schemas.length, valid, skipped, verdicts }, null, 2)}\n`);
  renameSync(tmp, out); // atomic, so a kill never leaves a truncated fixture
};

const flatten = (schema, mode) =>
  new Promise((done) => {
    execFile(p21eval, ["--flat", "-mode", mode, "-schema", schema, "-stepmod", stepmod, "-typeof", "noschema"], { timeout: 600000 }, (err) =>
      done(err ? (typeof err.code === "number" ? err.code : 1) : 0)
    );
  });

let cursor = 0;
let done = alreadyDone;

const worker = async () => {
  for (;;) {
    const i = cursor++;
    if (i >= schemas.length) return;
    const schema = schemas[i];
    const rel = schema.slice(corpus.length + 1);
    if (verdicts[rel]) continue; // --resume
    const mode = modeFor(schema);
    if (!mode) {
      verdicts[rel] = { skipped: true, reason: "no documented -mode for this file kind", valid: false };
    } else {
      const flat = schema.replace(/\.exp$/, ".flat");
      // A .flat may be a tracked artifact in the corpus repository. Preserve its
      // bytes so this script never mutates the tree it is measuring.
      const original = existsSync(flat) ? readFileSync(flat) : undefined;
      const exit = await flatten(schema, mode);
      let nil = null;
      if (existsSync(flat)) {
        nil = (readFileSync(flat, "utf8").match(/nil/gi) ?? []).length;
        if (original) writeFileSync(flat, original);
        else rmSync(flat);
      }
      verdicts[rel] = { mode, exit, nil, valid: exit === 0 && nil === 0 };
    }
    if (++done % 25 === 0) {
      save();
      process.stdout.write(`[${done}/${schemas.length}] `);
    }
  }
};

console.log(`${schemas.length} schemas, ${alreadyDone} already recorded, ${jobs} parallel jobs, tool ${p21eval.split("/").pop()}`);
await Promise.all(Array.from({ length: jobs }, () => worker()));
save();
const valid = Object.values(verdicts).filter((v) => v.valid).length;
const skipped = Object.values(verdicts).filter((v) => v.skipped).length;
console.log(`\ndone: ${schemas.length} schemas, ${valid} judged valid by eengine, ${skipped} skipped -> ${out}`);
