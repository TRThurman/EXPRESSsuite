import { AstNode, AstUtils } from "langium";
import type { NameProvider } from "langium";
import {
  Attribute_decl,
  Domain_rule,
  Enumeration_id,
  ExpressFile,
  Parameter_id,
  isAttribute_decl,
  isConstant_body,
  isDerived_attr,
  isDomain_rule,
  isEntityDefinition,
  isEnumeration_id,
  isEnumeration_type,
  isFunctionDefinition,
  isInverse_attr,
  isParameter_id,
  isProcedureDefinition,
  isRedeclared_attribute,
  isRule_decl,
  isSchemaDefinition,
  isSubtypeConstraintDefinition,
  isTypeDefinition,
  isUnique_rule,
  isWhere_clause,
} from "../generated/ast.js";
import type { Declaration, Formal_parameter, Where_clause } from "../generated/ast.js";
import { isLongFormSchemaName } from "../express-p11-scope-index.js";

export type DescribeKind =
  | "schema"
  | "entity"
  | "type"
  | "enumeration-type"
  | "function"
  | "procedure"
  | "subtype-constraint"
  | "constant"
  | "explicit-attribute"
  | "derived-attribute"
  | "inverse-attribute"
  | "redeclared-attribute"
  | "enumeration-item"
  | "parameter"
  | "where-rule"
  | "unique-rule";

export interface DescribeTarget {
  key: string;
  kind: DescribeKind;
  name: string;
  schema: string;
  /** Owner declaration name, for members. */
  owner?: string;
  /** Offsets of the node's CST. */
  start: number;
  end: number;
  /** Explicit attributes. */
  optional?: boolean;
  /** Entities. */
  supertypes?: string[];
  /** Keys of parameter / enumeration-item targets, in declaration order. */
  members?: string[];
}

type Owner = Declaration | AstNode;

/** The key under which stepmod-style files describe `node`, or `undefined` when it has none. */
export function annotationKeyOf(node: AstNode, nameProvider: NameProvider): string | undefined {
  if (isSchemaDefinition(node)) return node.name || undefined;
  const schema = AstUtils.getContainerOfType(node, isSchemaDefinition);
  if (!schema?.name) return undefined;
  const prefix = schema.name;

  const declarationName = declarationNameOf(node, nameProvider);
  if (declarationName) return `${prefix}.${declarationName}`;

  const owner = ownerOf(node);
  const ownerName = owner ? declarationNameOf(owner, nameProvider) : undefined;
  if (!ownerName) return undefined;

  if (isDomain_rule(node)) return node.id ? `${prefix}.${ownerName}.wr:${node.id}` : undefined;
  if (isUnique_rule(node)) return node.name ? `${prefix}.${ownerName}.ur:${node.name}` : undefined;
  const member = memberNameOf(node, nameProvider);
  return member ? `${prefix}.${ownerName}.${member}` : undefined;
}

/** Every target a describe command can offer, in document order; long-form schemas and global RULEs are left out. */
export function describeTargets(root: ExpressFile, nameProvider: NameProvider): DescribeTarget[] {
  const targets: DescribeTarget[] = [];
  for (const schema of root.schemas) {
    if (!schema.name || isLongFormSchemaName(schema.name)) continue;
    const add = (node: AstNode, kind: DescribeKind, name: string, extra: Partial<DescribeTarget> = {}): DescribeTarget | undefined => {
      const key = annotationKeyOf(node, nameProvider);
      const cst = node.$cstNode;
      if (!key || !cst) return undefined;
      const target: DescribeTarget = { key, kind, name, schema: schema.name, start: cst.offset, end: cst.end, ...extra };
      targets.push(target);
      return target;
    };
    add(schema, "schema", schema.name);
    // A schema being typed, or whose body failed to parse, has no body; a function being typed, no head.
    for (const constant of schema.body?.constant?.items ?? []) add(constant, "constant", constant.name);
    for (const declaration of schema.body?.declarations ?? []) {
      if (isRule_decl(declaration)) continue;
      addDeclaration(declaration, add, nameProvider);
    }
  }
  return targets;
}

/**
 * The lower-case key of every node that {@link annotationKeyOf} keys, long-form schemas included,
 * collected from the declarations down instead of by visiting every node: each schema, constant,
 * declaration and global rule (also those declared inside a function, procedure or rule), their
 * attributes, parameters and enumeration items, and their named UNIQUE and WHERE rules.
 */
export function declaredKeys(root: ExpressFile, nameProvider: NameProvider): Set<string> {
  const keys = new Set<string>();
  for (const schema of root.schemas ?? []) {
    if (!schema.name) continue;
    const prefix = schema.name;
    const add = (key: string): void => {
      keys.add(key.toLowerCase());
    };
    const walk = (declaration: AstNode): void => {
      const name = declarationNameOf(declaration, nameProvider);
      if (name) {
        const owner = `${prefix}.${name}`;
        add(owner);
        for (const member of membersOf(declaration)) {
          const memberName = memberNameOf(member.node, nameProvider);
          if (memberName) add(`${owner}.${memberName}`);
        }
        if (isEntityDefinition(declaration)) {
          for (const rule of declaration.body?.unique?.rules ?? []) if (rule.name) add(`${owner}.ur:${rule.name}`);
        }
        for (const rule of whereClauseOf(declaration)?.rules ?? []) if (rule.id) add(`${owner}.wr:${rule.id}`);
      }
      // Declarations and constants of an algorithm head are keyed by the schema too.
      const head = isFunctionDefinition(declaration) || isProcedureDefinition(declaration) || isRule_decl(declaration) ? declaration.algoHead : undefined;
      for (const nested of head?.declarations ?? []) walk(nested);
      for (const constant of head?.constant?.items ?? []) walk(constant);
    };
    add(prefix);
    for (const constant of schema.body?.constant?.items ?? []) walk(constant);
    for (const declaration of schema.body?.declarations ?? []) walk(declaration);
  }
  return keys;
}

function whereClauseOf(declaration: AstNode): Where_clause | undefined {
  if (isEntityDefinition(declaration)) return declaration.body?.where;
  if (isTypeDefinition(declaration) || isRule_decl(declaration)) return declaration.where;
  return undefined;
}

/** Lower-case member name to kind, for the members of `declaration` that a key's last segment can name. */
export function memberNamesOf(declaration: AstNode, nameProvider: NameProvider): Map<string, DescribeKind> {
  const names = new Map<string, DescribeKind>();
  const put = (name: string | undefined, kind: DescribeKind): void => {
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), kind);
  };
  for (const member of membersOf(declaration)) {
    put(memberNameOf(member.node, nameProvider), member.kind);
  }
  return names;
}

interface Member {
  node: AstNode;
  kind: DescribeKind;
}

function* membersOf(declaration: AstNode): Generator<Member> {
  if (isEntityDefinition(declaration)) {
    for (const explicit of declaration.body?.attributes ?? []) {
      for (const attribute of explicit.attributes) {
        yield { node: attribute, kind: isRedeclared_attribute(attribute) ? "redeclared-attribute" : "explicit-attribute" };
      }
    }
    for (const derived of declaration.body?.derived?.attributes ?? []) {
      yield { node: derived, kind: isRedeclared_attribute(derived.attribute) ? "redeclared-attribute" : "derived-attribute" };
    }
    for (const inverse of declaration.body?.inverse?.attributes ?? []) {
      yield { node: inverse, kind: isRedeclared_attribute(inverse.attribute) ? "redeclared-attribute" : "inverse-attribute" };
    }
  } else if (isTypeDefinition(declaration)) {
    const underlying = declaration.underlyingType;
    if (isEnumeration_type(underlying)) {
      for (const item of underlying.items?.items ?? underlying.extension?.items?.items ?? []) yield { node: item, kind: "enumeration-item" };
    }
  } else if (isFunctionDefinition(declaration)) {
    yield* parametersOf(declaration.head?.parameters ?? []);
  } else if (isProcedureDefinition(declaration)) {
    yield* parametersOf(declaration.head?.parameters ?? []);
  }
}

function* parametersOf(parameters: Formal_parameter[]): Generator<Member> {
  for (const parameter of parameters) {
    for (const id of parameter.ids) yield { node: id, kind: "parameter" };
  }
}

function addDeclaration(
  declaration: Declaration,
  add: (node: AstNode, kind: DescribeKind, name: string, extra?: Partial<DescribeTarget>) => DescribeTarget | undefined,
  nameProvider: NameProvider,
): void {
  const name = declaration.name;
  const addMembers = (parent: DescribeTarget | undefined): void => {
    const keys: string[] = [];
    for (const member of membersOf(declaration)) {
      const memberName = memberNameOf(member.node, nameProvider);
      if (!memberName) continue;
      const extra: Partial<DescribeTarget> = { owner: name };
      if (member.kind === "explicit-attribute") extra.optional = isOptionalAttribute(member.node);
      const target = add(member.node, member.kind, memberName, extra);
      if (target && (member.kind === "parameter" || member.kind === "enumeration-item")) keys.push(target.key);
    }
    if (parent && keys.length > 0) parent.members = keys;
  };
  const addRules = (clause: AstNode | undefined): void => {
    if (!isWhere_clause(clause)) return;
    for (const rule of clause.rules) addRule(rule, "where-rule", rule.id);
  };
  const addRule = (rule: Domain_rule | AstNode, kind: DescribeKind, label: string | undefined): void => {
    if (label) add(rule, kind, label, { owner: name });
  };

  if (isEntityDefinition(declaration)) {
    const supertypes = declaration.types?.supertypes?.entities.map((entity) => entity.entity.$refText) ?? [];
    add(declaration, "entity", name, supertypes.length > 0 ? { supertypes } : {});
    addMembers(undefined);
    // Document order: explicit, derived, inverse, then UNIQUE, then WHERE.
    for (const rule of declaration.body?.unique?.rules ?? []) addRule(rule, "unique-rule", rule.name);
    addRules(declaration.body?.where);
  } else if (isTypeDefinition(declaration)) {
    const enumeration = isEnumeration_type(declaration.underlyingType) && (declaration.underlyingType.items !== undefined || declaration.underlyingType.extension?.items !== undefined);
    const target = add(declaration, enumeration ? "enumeration-type" : "type", name);
    addMembers(target);
    addRules(declaration.where);
  } else if (isFunctionDefinition(declaration)) {
    addMembers(add(declaration, "function", name));
  } else if (isProcedureDefinition(declaration)) {
    addMembers(add(declaration, "procedure", name));
  } else if (isSubtypeConstraintDefinition(declaration)) {
    add(declaration, "subtype-constraint", name);
  }
}

function isOptionalAttribute(attribute: AstNode): boolean {
  const explicit = attribute.$container;
  return explicit !== undefined && "isOptional" in explicit && explicit.isOptional === true;
}

/** Name of a declaration, constant or global rule: the first key segment after the schema. */
function declarationNameOf(node: AstNode, nameProvider: NameProvider): string | undefined {
  if (isRule_decl(node)) return node.ruleHead.name || undefined;
  if (isConstant_body(node)) return node.name || undefined;
  if (isEntityDefinition(node) || isTypeDefinition(node) || isFunctionDefinition(node) || isProcedureDefinition(node) || isSubtypeConstraintDefinition(node)) {
    return nameProvider.getName(node) || undefined;
  }
  return undefined;
}

/** The declaration or global rule whose member `node` is. */
function ownerOf(node: AstNode): Owner | undefined {
  let current: AstNode | undefined = node.$container;
  while (current) {
    if (isRule_decl(current) || isEntityDefinition(current) || isTypeDefinition(current) || isFunctionDefinition(current) || isProcedureDefinition(current)) {
      return current;
    }
    current = current.$container;
  }
  return undefined;
}

function memberNameOf(node: AstNode, nameProvider: NameProvider): string | undefined {
  if (isDerived_attr(node) || isInverse_attr(node)) return attributeName(node.attribute, nameProvider);
  if (isAttribute_decl(node)) return attributeName(node, nameProvider);
  if (isEnumeration_id(node) || isParameter_id(node)) return (node as Enumeration_id | Parameter_id).name || undefined;
  return undefined;
}

function attributeName(attribute: Attribute_decl, nameProvider: NameProvider): string | undefined {
  return nameProvider.getName(attribute) || undefined;
}
