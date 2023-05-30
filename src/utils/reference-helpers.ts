import { Reference_clause, Schema_decl, isReference_clause } from "../language-server/generated/ast";
import { schemaHasSpecifications } from "./schema-helpers";

export const getReferenceDeclarations = (schema: Schema_decl): Reference_clause[] => {
  if (!schemaHasSpecifications(schema)) return [];
  var referenceSpecifications = schema.body.specifications.filter((s) => isReference_clause(s)) as Reference_clause[];
  return referenceSpecifications.filter((r) => r.schema);
};
