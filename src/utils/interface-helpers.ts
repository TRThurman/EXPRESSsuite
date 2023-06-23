import { isUse_clause } from "../language-server/generated/ast";
import { Reference_clause, Schema_decl, Use_clause, isReference_clause } from "../language-server/generated/ast";
import { schemaHasSpecifications } from "./schema-helpers";

export const getReferenceSpecifications = (schema: Schema_decl): Reference_clause[] => {
  if (!schemaHasSpecifications(schema)) return [];
  var referenceSpecifications = schema.body.specifications.filter((s) => isReference_clause(s)) as Reference_clause[];
  return referenceSpecifications.filter((r) => r.schema);
};

export const getUseSpecifications = (schema: Schema_decl): Use_clause[] => {
  if (!schemaHasSpecifications(schema)) return [];
  var useSpecifications = schema.body.specifications.filter((s) => isUse_clause(s)) as Use_clause[];
  return useSpecifications.filter((r) => r.schema);
};
