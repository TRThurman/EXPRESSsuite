import { describe, expect, test } from "vitest";
import { census, defaultSettings, loadCorpusWorkspace } from "./smrlv8-corpus-support.js";

/**
 * XS-PUB-010. The publication checks over the SMRL v8 schemas (test-fixtures/smrlv8), loaded with the default
 * settings, pin their counts. These public schemas carry no description blocks after END_SCHEMA apart from four
 * unkeyed remarks, so each publication rule finds nothing: a rule that starts to report here is a false positive
 * on plain EXPRESS, or a change of the corpus, and shows as a diff of this test.
 *
 * The rules' counts on the description blocks of the ISO 10303 SRL resource schemas (metanorma/iso-10303
 * 665a96c330) are measured by hand, outside the repository, because that text is not public domain; the fixtures
 * of src/test/annotation-publication.test.ts are synthetic.
 */
describe("SMRL v8 corpus, publication checks", () => {
  test(
    "no publication rule reports, and the annotation findings are the pinned four",
    async () => {
      const docs = await loadCorpusWorkspace(defaultSettings());
      const byCode = census(docs, { lines: false }).byCode;
      const annotation = Object.fromEntries(Object.entries(byCode).filter(([code]) => code.startsWith("annotation-")));
      expect(annotation).toEqual({ "annotation-unkeyed-remark": 4 });
      for (const code of [
        "annotation-continuation-without-list",
        "annotation-glued-continuation",
        "annotation-block-macro-inline",
        "annotation-open-block-delimiter",
        "annotation-list-chain-macro",
      ]) {
        expect(byCode[code], code).toBeUndefined();
      }
    },
    600_000
  );
});
