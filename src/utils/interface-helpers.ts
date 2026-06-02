import { SchemaDefinition, isUse_clause } from "../language/generated/ast.js";
import { Reference_clause, Use_clause, isReference_clause } from "../language/generated/ast.js";
import { schemaHasSpecifications } from "./schema-helpers.js";

export const getReferenceSpecifications = (schema: SchemaDefinition): Reference_clause[] => {
  if (!schemaHasSpecifications(schema)) return [];
  const referenceSpecifications = schema.body.specifications.filter((s) => isReference_clause(s)) as Reference_clause[];
  return referenceSpecifications.filter((r) => r.schema);
};

export const getUseSpecifications = (schema: SchemaDefinition): Use_clause[] => {
  if (!schemaHasSpecifications(schema)) return [];
  const useSpecifications = schema.body.specifications.filter((s) => isUse_clause(s)) as Use_clause[];
  return useSpecifications.filter((r) => r.schema);
};
