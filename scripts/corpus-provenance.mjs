// Records which corpus state a fixture was measured against.
//
// A fixture pins verdicts from one snapshot of the STEP schema collection, which
// is a live repository that moves. Without provenance a stale fixture looks
// identical to a current one, and a later mismatch gives no clue whether the tool
// changed or the schemas did.
import { execFileSync } from "node:child_process";

export const corpusProvenance = (corpusRoot) => {
  const git = (...args) => execFileSync("git", ["-C", corpusRoot, ...args], { encoding: "utf8" }).trim();
  try {
    return {
      commit: git("rev-parse", "HEAD"),
      // A dirty tree means the measurement cannot be reproduced from the commit
      // alone, so record it rather than pretending the snapshot is clean.
      dirty: git("status", "--porcelain").length > 0,
      describedAt: new Date().toISOString().slice(0, 10),
    };
  } catch {
    return { commit: null, dirty: null, describedAt: new Date().toISOString().slice(0, 10) };
  }
};
