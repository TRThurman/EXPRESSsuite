import type { Position, Range } from "vscode-languageserver";

export const DETECT_SCHEMA_CLOSURE_DUPLICATES_REQUEST = "express/detectSchemaClosureDuplicates";

export type DetectSchemaClosureDuplicatesParams = {
  uri: string;
  position: Position;
};

export type SchemaClosureDuplicateLocation = {
  uri: string;
  range: Range;
  schema: string;
};

export type SchemaClosureDuplicate = {
  category: string;
  name: string;
  locations: SchemaClosureDuplicateLocation[];
};

export type DetectSchemaClosureDuplicatesResult = {
  schema?: string;
  conflicts: SchemaClosureDuplicate[];
};
