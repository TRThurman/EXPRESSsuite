import { AstUtils, EmptyFileSystem, LangiumDocument, URI } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { domainOf } from "../language/express-p11-domains.js";
import { EntityDefinition, ExpressFile, isEntityDefinition } from "../language/generated/ast.js";

/**
 * A stepmod / SMRL module tree holds several domains that reuse the same schema names:
 * the arm.exp short forms; the mim.exp short forms with the resource schemas; each
 * concatenated file; each long form. Each workspace folder is one checkout. A name resolves only
 * inside the domain of the referencing document (express-p11-domains.ts).
 */

const doc = (path: string) =>
  ({ uri: URI.parse(`file://${path}`), parseResult: { value: undefined, parserErrors: [], lexerErrors: [] } }) as unknown as LangiumDocument;

describe("domainOf: the domain of a document", () => {
  const folders = ["file:///checkout_a", "file:///checkout_b"];
  const of = (path: string) => domainOf(doc(path), folders);

  test("the arm.exp files of one workspace folder are one domain", () => {
    expect(of("/checkout_a/modules/m1/arm.exp")).toBe(of("/checkout_a/modules/m2/arm.exp"));
  });

  test("the mim.exp files and the resource schemas of one workspace folder are one domain, apart from the arm.exp files", () => {
    expect(of("/checkout_a/modules/m1/mim.exp")).toBe(of("/checkout_a/resources/product_definition_schema/product_definition_schema.exp"));
    expect(of("/checkout_a/modules/m1/mim.exp")).not.toBe(of("/checkout_a/modules/m1/arm.exp"));
  });

  test("each concatenated file and each long form is a domain of its own", () => {
    const own = [
      "/checkout_a/modules/m1/arm_concatenated.exp",
      "/checkout_a/modules/m2/arm_concatenated.exp",
      "/checkout_a/modules/m1/mim_concatenated.exp",
      "/checkout_a/modules/m1/concatenated_mim.exp",
      "/checkout_a/modules/m1/arm_lf.exp",
      "/checkout_a/modules/m1/mim_lf.exp",
      "/checkout_a/modules/m1/mim_lf_patched.exp",
    ].map(of);
    expect(new Set(own).size).toBe(own.length);
    expect(own).not.toContain(of("/checkout_a/modules/m1/arm.exp"));
    expect(own).not.toContain(of("/checkout_a/modules/m1/mim.exp"));
  });

  test("two workspace folders (two checkouts) never share a domain", () => {
    expect(of("/checkout_a/modules/m1/arm.exp")).not.toBe(of("/checkout_b/modules/m1/arm.exp"));
    expect(of("/checkout_a/modules/m1/mim.exp")).not.toBe(of("/checkout_b/modules/m1/mim.exp"));
  });

  test("a file whose schema name ends in _lf is a long form, whatever the file is called", () => {
    const longForm = {
      uri: URI.parse("file:///checkout_a/delivery/ap242.exp"),
      parseResult: { value: { $type: "ExpressFile", schemas: [{ name: "ap242_mim_lf" }] } },
    } as unknown as LangiumDocument;
    expect(domainOf(longForm, folders)).not.toBe(of("/checkout_a/delivery/other.exp"));
  });
});

/** Builds the documents as one workspace and returns each one's error messages by path. */
async function build(files: Record<string, string>, folders: string[] = ["file:///w"]) {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder, WorkspaceManager } = services.shared.workspace;
  WorkspaceManager.initialize({ capabilities: {}, processId: null, rootUri: null, workspaceFolders: folders.map((uri) => ({ uri, name: uri })) });
  const documents = Object.entries(files).map(([path, text]) => {
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`file://${path}`));
    LangiumDocuments.addDocument(document);
    return document;
  });
  await DocumentBuilder.build(documents, { validation: true });
  const errors: Record<string, string[]> = {};
  for (const document of documents) {
    expect(document.parseResult.parserErrors, `${document.uri.path} must parse`).toHaveLength(0);
    errors[document.uri.path] = (document.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => String(d.message));
  }
  return { documents, errors };
}

function entityIn(document: LangiumDocument, name: string): EntityDefinition {
  const file = document.parseResult.value as ExpressFile;
  const found = AstUtils.streamAst(file).find((node): node is EntityDefinition => isEntityDefinition(node) && node.name === name);
  if (!found) throw new Error(`no entity ${name}`);
  return found;
}

const baseShortForm = `
  SCHEMA base_arm;
  ENTITY thing;
    x : INTEGER;
  END_ENTITY;
  END_SCHEMA;`;

const userShortForm = `
  SCHEMA user_arm;
  USE FROM base_arm;
  ENTITY part SUBTYPE OF (thing);
  WHERE
    wr1 : SELF.x > 0;
  END_ENTITY;
  END_SCHEMA;`;

// A concatenated file of another module: its own copy of base_arm, which differs from the short form.
const concatenated = `
  SCHEMA base_arm;
  ENTITY thing;
    y : REAL;
  END_ENTITY;
  END_SCHEMA;
  SCHEMA other_arm;
  USE FROM base_arm;
  ENTITY piece SUBTYPE OF (thing);
  WHERE
    wr1 : SELF.y > 0.0;
  END_ENTITY;
  END_SCHEMA;`;

describe("names resolve inside the domain of the referencing document", () => {
  test("a short form finds the short-form schema, not the same-named copy in a concatenated file", async () => {
    const { documents, errors } = await build({
      "/w/modules/base/arm.exp": baseShortForm,
      "/w/modules/user/arm.exp": userShortForm,
      "/w/modules/zz_other/arm_concatenated.exp": concatenated,
    });
    expect(errors["/w/modules/user/arm.exp"]).toEqual([]);
    const part = entityIn(documents[1], "part");
    const supertype = part.types?.supertypes?.entities?.[0]?.entity.ref;
    expect(supertype && AstUtils.getDocument(supertype).uri.path).toBe("/w/modules/base/arm.exp");
  });

  test("a concatenated file finds its own copies, not the short forms", async () => {
    const { documents, errors } = await build({
      "/w/modules/base/arm.exp": baseShortForm,
      "/w/modules/zz_other/arm_concatenated.exp": concatenated,
    });
    expect(errors["/w/modules/zz_other/arm_concatenated.exp"]).toEqual([]);
    const piece = entityIn(documents[1], "piece");
    const supertype = piece.types?.supertypes?.entities?.[0]?.entity.ref;
    expect(supertype && AstUtils.getDocument(supertype).uri.path).toBe("/w/modules/zz_other/arm_concatenated.exp");
  });

  test("a schema that only another domain declares is not found", async () => {
    const { errors } = await build({
      // y is declared only by the concatenated copy of base_arm, which is not in this domain.
      "/w/modules/user/arm.exp": userShortForm.replace("SELF.x > 0", "SELF.y > 0.0"),
      "/w/modules/zz_other/arm_concatenated.exp": concatenated,
    });
    expect(errors["/w/modules/user/arm.exp"].length).toBeGreaterThan(0);
  });

  test("two checkouts opened together: each finds its own schemas", async () => {
    const otherBase = baseShortForm.replace("x : INTEGER;", "z : INTEGER;");
    const { documents, errors } = await build(
      {
        "/a/modules/base/arm.exp": baseShortForm,
        "/a/modules/user/arm.exp": userShortForm,
        "/b/modules/base/arm.exp": otherBase,
        "/b/modules/user/arm.exp": userShortForm,
      },
      ["file:///a", "file:///b"]
    );
    expect(errors["/a/modules/user/arm.exp"]).toEqual([]);
    // In checkout b, thing has no attribute x.
    expect(errors["/b/modules/user/arm.exp"].length).toBeGreaterThan(0);
    const supertypeA = entityIn(documents[1], "part").types?.supertypes?.entities?.[0]?.entity.ref;
    const supertypeB = entityIn(documents[3], "part").types?.supertypes?.entities?.[0]?.entity.ref;
    expect(supertypeA && AstUtils.getDocument(supertypeA).uri.path).toBe("/a/modules/base/arm.exp");
    expect(supertypeB && AstUtils.getDocument(supertypeB).uri.path).toBe("/b/modules/base/arm.exp");
  });
});
