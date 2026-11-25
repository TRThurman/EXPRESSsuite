import { AstNode, AstUtils, isReference } from "langium";
import {
  EntityDefinition,
  Rule_decl,
  SubtypeConstraintDefinition,
  TypeDefinition,
  isConstant_body,
  isConstant_decl,
  isEntityDefinition,
  isFunctionDefinition,
  isProcedureDefinition,
  isRule_decl,
  isSchema_body,
  isSelect_extension,
  isSelect_list,
  isSelect_type,
  isSubtypeConstraintDefinition,
  isTypeDefinition,
} from "./generated/ast.js";

/**
 * The declarations a schema's specification holds: those visible in it
 * (ISO 10303-11:2004 11.1 to 11.3) and those implicitly interfaced (11.4),
 * transitively. Implicit interfaces are drawn only from the schemas the
 * schema reaches through its interface specifications (the `Universe` of the
 * Lean model): a schema has no knowledge of the schemas that interface it.
 * Lean model: `step`, `specIter` and `closed_of_stable` in
 * lean/ExpressSuite/SelectExtension.lean.
 *
 * The rules of 11.4, per kind of interfaced declaration:
 * - defined data type (11.4.2): the defined data types and the constants and
 *   functions used in its declaration and domain rules, the type it extends
 *   with BASED_ON included, its own selectable items and those of the selects
 *   it is based on excluded; and every select whose selection list contains it;
 * - entity data type (11.4.3): its supertypes (not its subtypes), what its
 *   attribute declarations and domain rules use, its subtype constraints, every
 *   select whose selection list contains it, and every rule whose FOR list
 *   holds it and otherwise only interfaced entity data types;
 * - function and procedure (11.4.4, 11.4.5): the data types of its parameters,
 *   returned type and local variables, and the constants, functions and
 *   procedures used within it;
 * - rule (11.4.6): the data types of its local variables and the constants,
 *   functions and procedures used within it;
 * - constant (11.4.1): the data types, constants and functions its
 *   declaration uses;
 * - subtype constraint (11.4.7): nothing.
 * The selection list of an extension (`BASED_ON base WITH (...)`) is its WITH
 * list (ISO 10303-11:2004 syntax rule 300).
 */
export type ImplicitInterfaceIndex = {
  /** For an entity or defined data type: the selects whose selection list contains it. */
  selectsListing: Map<AstNode, TypeDefinition[]>;
  /** For an entity data type: the rules whose FOR list contains it. */
  rulesFor: Map<AstNode, Rule_decl[]>;
  /** For an entity data type: its subtype constraints. */
  constraintsFor: Map<AstNode, SubtypeConstraintDefinition[]>;
};

/** The schema-level declaration (ENTITY, TYPE, FUNCTION, PROCEDURE, SUBTYPE_CONSTRAINT, RULE, CONSTANT) that holds `node`. */
export function schemaLevelDeclaration(node: AstNode | undefined): AstNode | undefined {
  for (let current = node; current; current = current.$container) {
    const container = current.$container;
    if (!container) return undefined;
    if (isSchema_body(container)) return current;
    if (isConstant_decl(container) && isSchema_body(container.$container)) return current;
  }
  return undefined;
}

/** The schema-level declarations that the references under `root` name, leaving out the subtrees `skip` accepts. */
function referencedDeclarations(root: AstNode | undefined, skip: (node: AstNode) => boolean = () => false): AstNode[] {
  const found: AstNode[] = [];
  const visit = (node: AstNode) => {
    if (skip(node)) return;
    for (const info of AstUtils.streamReferences(node)) {
      const targets = isReference(info.reference) ? [info.reference.ref] : info.reference.items.map((item) => item.ref);
      for (const target of targets) {
        const declaration = schemaLevelDeclaration(target);
        if (declaration) found.push(declaration);
      }
    }
    for (const child of AstUtils.streamContents(node)) visit(child);
  };
  if (root) visit(root);
  return found;
}

const isTypeOrEntity = (node: AstNode) => isTypeDefinition(node) || isEntityDefinition(node);
const isConstantFunctionOrProcedure = (node: AstNode) => isConstant_body(node) || isFunctionDefinition(node) || isProcedureDefinition(node);

const forwardCache = new WeakMap<AstNode, readonly AstNode[]>();

/** The declarations implicitly interfaced along with `declaration` by reference from it (11.4.1 to 11.4.7). */
export function implicitReferences(declaration: AstNode): readonly AstNode[] {
  const cached = forwardCache.get(declaration);
  if (cached) return cached;
  let found: AstNode[] = [];
  if (isTypeDefinition(declaration)) {
    // 11.4.2: the selectable items of the type and of the selects it is based on are not interfaced
    found = referencedDeclarations(declaration, isSelect_list);
  } else if (isEntityDefinition(declaration)) {
    // 11.4.3: supertypes, attributes and domain rules; the SUPERTYPE OF expression (subtypes) is not followed
    const subtypes = declaration.types?.subtypes;
    found = referencedDeclarations(declaration, (node) => node === subtypes);
  } else if (isFunctionDefinition(declaration) || isProcedureDefinition(declaration) || isRule_decl(declaration)) {
    // 11.4.4 to 11.4.6: data types of parameters, returned type and local variables; constants, functions, procedures within
    const typed = isRule_decl(declaration) ? [declaration.algoHead?.local] : [declaration.head, declaration.algoHead?.local];
    for (const part of typed) found.push(...referencedDeclarations(part).filter(isTypeOrEntity));
    found.push(...referencedDeclarations(declaration).filter(isConstantFunctionOrProcedure));
  } else if (isConstant_body(declaration)) {
    found = referencedDeclarations(declaration);
  }
  // a subtype constraint interfaces nothing (11.4.7)
  const result = [...new Set(found)].filter((node) => node !== declaration);
  forwardCache.set(declaration, result);
  return result;
}

/** The reverse relations of 11.4.2 and 11.4.3 over the given schema-level declarations. */
export function buildImplicitInterfaceIndex(declarations: Iterable<AstNode>): ImplicitInterfaceIndex {
  const index: ImplicitInterfaceIndex = { selectsListing: new Map(), rulesFor: new Map(), constraintsFor: new Map() };
  const add = <T>(map: Map<AstNode, T[]>, key: AstNode | undefined, value: T) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const declaration of declarations) {
    if (isTypeDefinition(declaration) && isSelect_type(declaration.underlyingType)) {
      const select = declaration.underlyingType.select;
      const list = isSelect_list(select) ? select : isSelect_extension(select) ? select.selectList : undefined;
      for (const item of list?.types ?? []) add(index.selectsListing, schemaLevelDeclaration(item.ref), declaration);
    } else if (isRule_decl(declaration)) {
      for (const entity of declaration.ruleHead?.types ?? []) add(index.rulesFor, schemaLevelDeclaration(entity.to?.ref), declaration);
    } else if (isSubtypeConstraintDefinition(declaration)) {
      add(index.constraintsFor, schemaLevelDeclaration(declaration.type?.to?.ref), declaration);
    }
  }
  return index;
}

/**
 * The least set that holds `seed` and is closed under 11.4 within `universe`:
 * the specification of a schema whose visible declarations are `seed`.
 */
export function implicitClosure(seed: Iterable<AstNode>, universe: ReadonlySet<AstNode>, index: ImplicitInterfaceIndex): Set<AstNode> {
  const specification = new Set<AstNode>(seed);
  const queue = [...specification];
  const admit = (node: AstNode | undefined) => {
    if (!node || specification.has(node) || !universe.has(node)) return;
    specification.add(node);
    queue.push(node);
  };
  while (queue.length > 0) {
    const declaration = queue.pop()!;
    for (const node of implicitReferences(declaration)) admit(node);
    if (isTypeDefinition(declaration) || isEntityDefinition(declaration)) {
      for (const select of index.selectsListing.get(declaration) ?? []) admit(select);
    }
    if (isEntityDefinition(declaration)) {
      for (const constraint of index.constraintsFor.get(declaration) ?? []) admit(constraint);
      for (const rule of index.rulesFor.get(declaration) ?? []) {
        const entities = (rule.ruleHead?.types ?? []).map((entity) => schemaLevelDeclaration(entity.to?.ref));
        if (entities.every((entity): entity is EntityDefinition => entity !== undefined && specification.has(entity))) admit(rule);
      }
    }
  }
  return specification;
}
