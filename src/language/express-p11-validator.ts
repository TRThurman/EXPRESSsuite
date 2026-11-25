import {
  AstNode,
  AstUtils,
  isReference,
  LangiumDocuments,
  MultiMap,
  NameProvider,
  Reference,
  ReferenceInfo,
  References,
  ValidationAcceptor,
  ValidationChecks,
  isNamed,
  GrammarUtils,
} from "langium";
import {
  Assignment_stmt_body,
  Attribute_decl,
  BinaryExpression,
  Attribute_qualifier,
  Complex_Primary_body,
  EntityDefinition,
  Expression,
  ExpressAstType,
  Local_decl,
  Reference_clause,
  SchemaDefinition,
  Select_extension,
  Select_type,
  Simple_factor,
  Use_clause,
  isAttribute_decl,
  isAttribute_qualifier,
  isConstant_body,
  isDerived_attr,
  isEntityDefinition,
  isEntityRef,
  isEnumeration_extension,
  isExplicit_attr,
  isFunction_head,
  isGroup_qualifier,
  isIndex_qualifier,
  isInverse_attr,
  isNamed_type_or_rename,
  isNamed_types,
  isProcedure_call_Or_Assigment_stmt_reference,
  isRedeclared_attribute,
  isIncrement_control,
  isProcedure_head,
  isReference_clause,
  isResource_or_rename,
  isSelect_extension,
  isSelect_list,
  isSelect_type,
  isSchemaDefinition,
  isTypeDefinition,
  isUse_clause,
} from "./generated/ast.js";
import type { ExpressP11Services } from "./express-module.js";
import { schemaHasDeclarations } from "../utils/schema-helpers.js";
import { getReferenceSpecifications, getUseSpecifications } from "../utils/interface-helpers.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ScopeClash, declarationNameRange } from "./express-p11-scope-index.js";
import type { Range } from "vscode-languageserver";
import { isLongForm } from "./express-p11-type-utilities.js";
import { foldsCase } from "./express-p11-case-rule-scope.js";
import { ExpressP11ScopeProvider, ScopeType } from "./express-p11-scope-provider.js";
import { ExpressTypeBuilder } from "./type-system/express-type-builder.js";
import type { ExpressP11SelectExtensionIndex } from "./express-p11-select-extension-index.js";
import { notIndexable, renderType, spec } from "./type-system/express-type-model.js";

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ExpressP11Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.ExpressP11Validator;
  const checks: ValidationChecks<ExpressAstType> = {
    Assignment_stmt_body: validator.checkIndexQualifierOperands,
    Attribute_decl: validator.checkAttributeNameStartsWithLowerCase,
    Attribute_qualifier: validator.checkAmbiguousAttributeReference,
    Complex_Primary_body: [validator.checkIndexQualifierOperands, validator.checkGroupReferencePlacement],
    EntityDefinition: validator.checkRedeclaredAttributeTypes,
    Local_decl: validator.checkLocalVariablesDoNotDuplicateLoopIndices,
    Select_extension: validator.checkExtensionOfGenericEntitySelect,
    Select_type: validator.checkGenericEntityNeedsExtensible,
    SchemaDefinition: [
      validator.checkDuplicateInterfacedDeclarations,
      validator.checkReferencesAreImported,
      validator.checkDeclarationNameCasing,
      validator.checkReferenceNameCase,
    ],
  };
  registry.register(checks, validator);
}

export enum ExpressP11Issues {
  ReferenceStatementIncomplete = "reference-statement-incomplete",
  ReferenceStatementMissing = "reference-statement-missing",
  WrongReferenceLabel = "wrong-reference-label",
  DeclarationNameCase = "declaration-name-case",
  ReferenceNameCase = "reference-name-case",
  DuplicateLoopIndex = "duplicate-loop-index",
  RedeclarationNotSpecialization = "redeclaration-not-specialization",
  IndexOnNonAggregate = "index-on-non-aggregate",
  UnqualifiedGroupReference = "unqualified-group-reference",
  AmbiguousAttributeReference = "ambiguous-attribute-reference",
  ExtensionMissingGenericEntity = "extension-missing-generic-entity",
  GenericEntityWithoutExtensible = "generic-entity-without-extensible",
  DuplicateInterfacedDeclaration = "duplicate-interfaced-declaration",
  RedundantDeclaration = "redundant-declaration",
}

export type DuplicateDeclarationData = {
  identifier: string;
  schemas: string[];
};

export type RedeclarationData = {
  attribute: string;
  newType: string;
  originalType: string;
};

export type IndexOperandData = {
  operandType: string;
};

export type GroupReferenceData = {
  entity: string;
  followedBy: "nothing" | "group" | "index";
};

export type AmbiguousAttributeData = {
  attribute: string;
  operand: string;
  declaredIn: string[];
};

export type WrongReferenceLabelData = {
  expectedReference: string;
};

export type ExtensionMissingGenericEntityData = {
  extension: string;
  base: string;
  fix: { title: string; newText: string; range: Range };
};

export type GenericEntityWithoutExtensibleData = {
  fixes: { title: string; newText: string; range: Range }[];
};

export type ReferenceNameCaseData = {
  expectedName: string;
};

export type DeclarationNameCaseData = {
  expectedName: string;
};

export type ReferenceStatementData = {
  schema: string;
  resource: string;
  sourceSchema: string;
};
type NamedNode = { name: string; node: AstNode };

/**
 * Whether a primary is an operand of `=`, `<>` or `||`, seen through parentheses:
 * `acc` of `check` in lean/ExpressSuite/GroupReference.lean. A factor that
 * only holds the primary or a parenthesised expression is transparent; one
 * with a unary operator, and every other node, is not.
 */
function isOperandOfEqualOrConstructor(primary: AstNode): boolean {
  const bare = (node: AstNode) => (node.$type === "Simple_factor" || node.$type === "Temp") && !(node as Simple_factor).op;
  let parent = primary.$container;
  while (parent && bare(parent)) parent = parent.$container;
  if (parent?.$type === "Expression") return (parent as Expression).op === "=" || (parent as Expression).op === "<>";
  if (parent?.$type === "BinaryExpression") return (parent as BinaryExpression).op === "||";
  return false;
}
type SchemaName = string;
/**
 * Implementation of custom validations.
 */
type ReferenceSite = { reference: Reference; container: AstNode; property: string; index?: number };

/** The references whose spelling XS-PUB-004 checks: supertypes, types, and interfaced schemas and items. */
function referenceNameSites(node: AstNode): ReferenceSite[] {
  const one = (reference: Reference | undefined, property: string): ReferenceSite[] =>
    reference ? [{ reference, container: node, property }] : [];
  if (isEntityRef(node)) return one(node.entity, "entity");
  if (isNamed_types(node)) return one(node.of, "of");
  if (isSelect_extension(node) || isEnumeration_extension(node)) return one(node.type, "type");
  if (isInverse_attr(node)) return one(node.type, "type");
  if (isUse_clause(node) || isReference_clause(node)) return one(node.schema, "schema");
  if (isNamed_type_or_rename(node) || isResource_or_rename(node)) return one(node.resource, "resource");
  if (isSelect_list(node)) return node.types.map((reference, index) => ({ reference, container: node, property: "types", index }));
  return [];
}

/** WG 12 convention (RUL-26): ARM and MIM schemas, long forms included, start with an upper-case letter; others are lower case. */
function conventionalSchemaName(name: string): string {
  const lower = name.toLowerCase();
  return /_(arm|mim)(_lf)?$/.test(lower) ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
}

export class ExpressP11Validator {
  protected readonly references: References;
  protected readonly documents: LangiumDocuments;
  protected readonly nameProvider: NameProvider;
  protected readonly typeContainer: ExpressP11TypeContainer;
  protected readonly selectExtensions: ExpressP11SelectExtensionIndex;
  protected readonly scopeProvider: ExpressP11ScopeProvider;

  constructor(services: ExpressP11Services) {
    this.references = services.references.References;
    this.documents = services.shared.workspace.LangiumDocuments;
    this.nameProvider = services.references.NameProvider;
    this.typeContainer = services.validation.TypeContainer;
    this.selectExtensions = services.shared.workspace.SelectExtensionIndex;
    this.scopeProvider = services.references.ScopeProvider as ExpressP11ScopeProvider;
  }

  /**
   * ISO 10303-11:2004 8.4.2, syntax: select_type = [ EXTENSIBLE [ GENERIC_ENTITY ] ] SELECT ...
   * GENERIC_ENTITY is allowed only after EXTENSIBLE; the parser accepts it alone so that this can
   * be reported with a correction. With the ruling of 2026-11-21 an extension need not be
   * EXTENSIBLE, so for a SELECT BASED_ON two corrections are offered: make it EXTENSIBLE (it then
   * is GENERIC_ENTITY, as an EXTENSIBLE extension of a GENERIC_ENTITY select shall be), or drop
   * GENERIC_ENTITY (a closed extension). A select list keeps its GENERIC_ENTITY: only EXTENSIBLE
   * is offered.
   */
  checkGenericEntityNeedsExtensible(select: Select_type, accept: ValidationAcceptor): void {
    if (!select.isGenericEntity || select.isExtensible || !select.$cstNode) return;
    const generic = GrammarUtils.findNodeForKeyword(select.$cstNode, "GENERIC_ENTITY");
    const keyword = GrammarUtils.findNodeForKeyword(select.$cstNode, "SELECT");
    if (!generic || !keyword) return;
    const fixes: GenericEntityWithoutExtensibleData["fixes"] = [
      { title: "Add EXTENSIBLE", newText: "EXTENSIBLE ", range: { start: generic.range.start, end: generic.range.start } },
    ];
    if (isSelect_extension(select.select)) {
      fixes.push({ title: "Remove GENERIC_ENTITY", newText: "", range: { start: generic.range.start, end: keyword.range.start } });
    }
    accept(
      "error",
      "GENERIC_ENTITY is allowed only after EXTENSIBLE (ISO 10303-11:2004 8.4.2): write EXTENSIBLE GENERIC_ENTITY SELECT" +
        (isSelect_extension(select.select) ? ", or SELECT BASED_ON without GENERIC_ENTITY for an extension that is not EXTENSIBLE." : "."),
      { node: select, keyword: "GENERIC_ENTITY", code: ExpressP11Issues.GenericEntityWithoutExtensible, data: { fixes } satisfies GenericEntityWithoutExtensibleData }
    );
  }

  /**
   * ISO 10303-11:2004 8.4.2, as ruled on 2026-11-21: "an extension does not itself need to be
   * extensible. If a developer choosed to make it extensible, then it shall also be
   * generic_entity." Reported on an EXTENSIBLE SELECT BASED_ON a select declared GENERIC_ENTITY
   * that does not say GENERIC_ENTITY itself. An extension that is not EXTENSIBLE is not reported.
   */
  checkExtensionOfGenericEntitySelect(extension: Select_extension, accept: ValidationAcceptor): void {
    const base = extension.type?.ref;
    if (!base || !isSelect_type(base.underlyingType) || !base.underlyingType.isGenericEntity) return;
    const select = extension.$container;
    if (!isSelect_type(select) || !select.isExtensible || select.isGenericEntity) return;
    const declaration = AstUtils.getContainerOfType(extension, isTypeDefinition);
    const start = select.$cstNode?.range.start;
    const keyword = select.$cstNode ? GrammarUtils.findNodeForKeyword(select.$cstNode, "SELECT") : undefined;
    if (!declaration || !start || !keyword) return;
    const data: ExtensionMissingGenericEntityData = {
      extension: declaration.name,
      base: base.name,
      fix: { title: "Add GENERIC_ENTITY", newText: "EXTENSIBLE GENERIC_ENTITY SELECT", range: { start, end: keyword.range.end } },
    };
    accept(
      "error",
      `The select type '${declaration.name}' is EXTENSIBLE and extends '${base.name}', which is GENERIC_ENTITY, so it shall also be GENERIC_ENTITY (ISO 10303-11:2004 8.4.2). An extension that is not EXTENSIBLE need not say GENERIC_ENTITY.`,
      { node: declaration, property: "name", code: ExpressP11Issues.ExtensionMissingGenericEntity, data }
    );
  }

  /**
   * A type builder for the schema that holds `node`: it sees the declarations
   * of that schema's specification (visible, 11.1 to 11.3, or implicitly
   * interfaced, 11.4), not everything the workspace holds.
   */
  protected typeBuilderFor(node: AstNode): ExpressTypeBuilder {
    const schema = AstUtils.getContainerOfType(node, isSchemaDefinition);
    const specification = schema ? this.typeContainer.getScopeIndex().specificationOf(schema) : new Set<AstNode>();
    return new ExpressTypeBuilder(this.typeContainer, this.selectExtensions, specification);
  }

  /**
   * ISO 10303-11:2004 12.7.3, last sentence: "If two or more attributes are
   * found with the same name then the reference is ambiguous and indeterminate
   * (?) is returned", read with 9.2.3.3 b) (ruling 2026-11-21): reported for an
   * entity-typed operand when two or more entities among the operand's type and
   * its supertypes, at any depth, declare the name. A redeclaration without
   * RENAMED declares no new name; a diamond inheriting one declaration along two
   * paths is one entity. Declarations in subtypes are never reported: EXPRESS
   * cannot guarantee that further subtypes will not be added, so a verdict that
   * depended on them could change with no change to the operand's type or its
   * supertypes. Proved as `resolve_ambiguous_iff` and `ambiguous_stable` in
   * lean/ExpressSuite/Inheritance.lean. The linker still binds the nearest
   * candidate so that hover and navigation keep working. The NOTE of 12.7.3
   * recommends a group reference to select one. Select-typed operands are not
   * reported: a select of entities with same-named attributes is the common
   * case in SMRL and the standard's own NOTE names it.
   */
  checkAmbiguousAttributeReference(qualifier: Attribute_qualifier, accept: ValidationAcceptor): void {
    const operand = this.scopeProvider.getQualifierOperand(qualifier);
    if (!operand || operand.type !== ScopeType.Entities) return;
    const entities = operand.nodes.filter(isEntityDefinition);
    if (entities.length !== 1) return;
    const name = qualifier.target.$refText;
    const owners = new Map<EntityDefinition, string>();
    // includeDescendants false: the operand's type and its supertypes only, every depth.
    for (const level of this.typeContainer.getVisibleAttributeCandidates(entities[0], name, false)) {
      for (const declaration of level.declarations) {
        if (this.nameProvider.getName(declaration) !== name) continue;
        if (isRedeclared_attribute(declaration) && !declaration.isRenamed) continue;
        const owner = AstUtils.getContainerOfType(declaration, isEntityDefinition);
        if (owner) owners.set(owner, owner.name);
      }
    }
    if (owners.size < 2) return;
    const data: AmbiguousAttributeData = { attribute: name, operand: entities[0].name, declaredIn: [...owners.values()] };
    accept(
      "warning",
      `Attribute reference '${name}' is ambiguous for an operand of type ${data.operand}: it is declared in ${data.declaredIn.join(" and ")}, among ${data.operand} and its supertypes, so the reference evaluates to indeterminate (ISO 10303-11:2004 9.2.3.3 b, 12.7.3). Qualify it with a group reference, as in x\\${data.declaredIn[0]}.${name}.`,
      { node: qualifier, property: "target", code: ExpressP11Issues.AmbiguousAttributeReference, data }
    );
  }

  /**
   * ISO 10303-11:2004 9.2.3.4 a): the type of a redeclared attribute shall be the
   * same as, or a specialization (9.2.7) of, the original attribute's type. The
   * relation is `spec` from the type model, proved sound in
   * lean/ExpressSuite/Soundness.lean for entity supertype lists drawn from one
   * transitively closed table (`Closed`, `entOk`), which `supertypesOf` gives
   * unless two entities of one comparison share a name; defined types and selects are seen
   * through on both sides. Both types are taken as the schema of the entity
   * specifies them (clause 11): a select's domain includes the items that its
   * extensions in that schema's specification add (13.3.2); an extension's domain is
   * its base's as declared plus its own, without the other extensions of that
   * base (8.4.2). The verdict is definite, EXTENSIBLE or not: nothing outside
   * the schema's specification can change it. Nothing is reported when either
   * type lies outside the proved domain.
   */
  checkRedeclaredAttributeTypes(entity: EntityDefinition, accept: ValidationAcceptor): void {
    if (!entity.body) return;
    const typeBuilder = this.typeBuilderFor(entity);
    const owners: Array<{ node: AstNode; declarations: Attribute_decl[]; type: unknown }> = [];
    for (const explicit of entity.body.attributes) owners.push({ node: explicit, declarations: explicit.attributes, type: explicit.type });
    for (const derived of entity.body.derived?.attributes ?? []) owners.push({ node: derived, declarations: [derived.attribute], type: derived.type });
    for (const owner of owners) {
      for (const declaration of owner.declarations) {
        if (!isRedeclared_attribute(declaration)) continue;
        const original = declaration.qualifiedAttribute.attribute.target.ref;
        if (!original || !isAttribute_decl(original)) continue;
        const originalOwner = original.$container;
        if (!isExplicit_attr(originalOwner) && !isDerived_attr(originalOwner) && !isInverse_attr(originalOwner)) continue;
        const newType = typeBuilder.ofType(owner.type as Parameters<ExpressTypeBuilder["ofType"]>[0]);
        const originalType = typeBuilder.ofAttribute(original);
        if (!newType || !originalType) continue;
        if (spec(newType, originalType)) continue;
        const attributeName = declaration.name ?? declaration.qualifiedAttribute.attribute.target.$refText;
        const data: RedeclarationData = { attribute: attributeName, newType: renderType(newType), originalType: renderType(originalType) };
        accept(
          "error",
          `Redeclared attribute '${attributeName}' has type ${data.newType}, which is not a specialization of the original type ${data.originalType} (ISO 10303-11:2004 9.2.3.4, 9.2.7).`,
          { node: owner.node, property: "type", code: ExpressP11Issues.RedeclarationNotSpecialization, data }
        );
      }
    }
  }

  /**
   * ISO 10303-11:2004 12.6.1 (aggregate), 12.5.1 (string) and 12.3.1 (binary)
   * indexing: the indexed operand shall be an aggregate, string or binary
   * value. Reported when the declared type of the operand, as the schema of the
   * expression specifies it (clause 11), can hold none of these (`notIndexable`
   * in lean/ExpressSuite/IndexOperand.lean); unknown types are not reported.
   */
  checkIndexQualifierOperands(body: Complex_Primary_body | Assignment_stmt_body, accept: ValidationAcceptor): void {
    const qualifiers = body.qualifiers ?? [];
    if (!qualifiers.some(isIndex_qualifier)) return;
    const typeBuilder = this.typeBuilderFor(body);
    const head = isProcedure_call_Or_Assigment_stmt_reference(body.$container.head) ? body.$container.head.to.ref : body.$container.head;
    let current =
      typeof head === "string" || head === undefined
        ? typeBuilder.ofHead(head ?? "", "parameterList" in body && Boolean(body.parameterList), body)
        : isProcedure_call_Or_Assigment_stmt_reference(body.$container.head)
          ? typeBuilder.ofDeclaration(head)
          : typeBuilder.ofHead(body.$container.head as Parameters<ExpressTypeBuilder["ofHead"]>[0], "parameterList" in body && Boolean(body.parameterList), body);
    qualifiers.forEach((qualifier, index) => {
      if (isIndex_qualifier(qualifier) && current && notIndexable(current)) {
        const data: IndexOperandData = { operandType: renderType(current) };
        accept("error", `Index applied to an operand of type ${data.operandType}, which is neither an aggregate nor a string or binary value (ISO 10303-11:2004 12.6.1, 12.5.1, 12.3.1).`, {
          node: body,
          property: "qualifiers",
          index,
          code: ExpressP11Issues.IndexOnNonAggregate,
          data,
        });
      }
      current = typeBuilder.afterQualifier(current, qualifier);
    });
  }

  /**
   * ISO 10303-11:2004 12.7.4, Rules and restrictions: "A group reference which
   * is not further qualified with an attribute reference shall appear as an
   * operand of either the entity value comparison operator (=) or the complex
   * entity instance constructor (||)." A group reference followed by another
   * group reference or by an index is reported as well: the expression to the
   * left of a group reference shall evaluate to a complex entity instance
   * (12.7.4) and an index needs an aggregate (12.6.1); a partial complex
   * entity value is neither. Only expressions are checked: an assignment
   * target may end in a group reference (13.3). The loop is `violatesAt` of
   * lean/ExpressSuite/GroupReference.lean, proved equal to the restriction
   * (`qualsOk_iff_forall`) and to the partial-value semantics
   * (`qualsOk_eq_kind`).
   */
  checkGroupReferencePlacement(body: Complex_Primary_body, accept: ValidationAcceptor): void {
    const qualifiers = body.qualifiers ?? [];
    qualifiers.forEach((qualifier, index) => {
      if (!isGroup_qualifier(qualifier)) return;
      const next = qualifiers[index + 1];
      if (isAttribute_qualifier(next)) return;
      if (next === undefined && isOperandOfEqualOrConstructor(body.$container)) return;
      const data: GroupReferenceData = {
        entity: qualifier.entity.$refText,
        followedBy: next === undefined ? "nothing" : isGroup_qualifier(next) ? "group" : "index",
      };
      const reference = `Group reference '\\${data.entity}'`;
      const message =
        data.followedBy === "nothing"
          ? `${reference} is not further qualified with an attribute reference, so it denotes a partial complex entity value, which may appear only as an operand of =, <> or || (ISO 10303-11:2004 12.7.4, 12.2.1.7).`
          : data.followedBy === "group"
            ? `${reference} is followed by another group reference; the expression to the left of a group reference shall evaluate to a complex entity instance, which a partial complex entity value is not (ISO 10303-11:2004 12.7.4).`
            : `${reference} is followed by an index; a partial complex entity value is not an aggregate (ISO 10303-11:2004 12.7.4, 12.6.1).`;
      accept("error", message, { node: body, property: "qualifiers", index, code: ExpressP11Issues.UnqualifiedGroupReference, data });
    });
  }

  checkAttributeNameStartsWithLowerCase(attribute: Attribute_decl, accept: ValidationAcceptor): void {
    if (!isNamed(attribute)) return;
    try {
      const attributeName = this.nameProvider.getName(attribute);
      if (attributeName) {
        const firstChar = attributeName.substring(0, 1);
        if (firstChar.toLowerCase() !== firstChar) {
          accept("warning", "Attribute name should start with a lower case.", {
            node: attribute,
          });
        }
      }
    } catch {
      return;
    }
  }

  /**
   * ISO 10303-11:2004 10.1 b: "Within a single scope an identifier may be
   * declared, or explicitly interfaced (see clause 11), once only." Reported in
   * every schema in whose scope one identifier denotes two or more different
   * declarations, local or interfaced, of any kind (Table 9); one declaration
   * reached by several routes counts once (10.1 b, second sentence). Anchored at
   * the local declaration, or at the interface item or specification that
   * brought the declaration in, once per declaration. In a long form (WG11 N239) identical repeated
   * definitions are a warning. The scope relation is decided by
   * `lean/ExpressSuite/Interfaces.lean` (`clash_iff`). Never throws: a failure
   * to compute a scope reports nothing for that schema.
   */
  checkDuplicateInterfacedDeclarations(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    let clashes: ScopeClash[];
    try {
      clashes = this.typeContainer.getScopeIndex().clashesIn(schema);
    } catch (error) {
      console.warn(`duplicate-interfaced-declaration skipped for '${schema.name}': ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const clash of clashes) {
      const kinds = [...new Set(clash.declarations.map((decl) => decl.kind))];
      const schemas = [...new Set(clash.declarations.map((decl) => decl.schema))];
      const what = kinds.length === 1 ? `${kinds[0]} '${clash.identifier}'` : `Identifier '${clash.identifier}' (${kinds.join(", ")})`;
      let message: string;
      if (clash.identical) {
        message = `${what} is declared more than once in ${schemas[0]} with identical text; a tool may treat repeated identical definitions as one (WG11 N239).`;
      } else if (clash.longForm) {
        message = `${what} is declared more than once in ${schemas[0]} with different definitions (ISO 10303-11:2004 10.1 b).`;
      } else if (schemas.length === 1) {
        message = `${what} is declared more than once in ${schemas[0]} (ISO 10303-11:2004 10.1 b).`;
      } else {
        const all = clash.declarations.length === 2 ? "both" : "all";
        message = `${what} is declared in ${schemas.join(" and in ")}; ${all} are visible in ${schema.name} (ISO 10303-11:2004 10.1 b).`;
      }
      const relatedInformation = clash.declarations.flatMap((decl) => {
        const range = declarationNameRange(decl);
        return range ? [{ location: { uri: decl.uri, range }, message: `${decl.kind} '${decl.name}' is declared in ${decl.schema}.` }] : [];
      });
      const data: DuplicateDeclarationData = { identifier: clash.identifier, schemas };
      const severity = clash.identical ? "warning" : "error";
      const code = clash.identical ? ExpressP11Issues.RedundantDeclaration : ExpressP11Issues.DuplicateInterfacedDeclaration;
      // One diagnostic per declaration, at its first arrival in this schema (a
      // local declaration, or the first interface line that brings it in); a
      // declaration re-exported along several chains is not reported again.
      const anchored = new Set<AstNode>();
      for (const decl of clash.declarations) {
        const arrival = clash.arrivals.find((candidate) => candidate.decl.node === decl.node);
        if (!arrival) continue;
        const target = arrival.route.kind === "local" ? arrival.decl.anchor : (arrival.route.item ?? arrival.route.spec);
        if (anchored.has(target)) continue;
        anchored.add(target);
        if (arrival.route.kind === "local") accept(severity, message, { node: target, property: "name", code, data, relatedInformation });
        else accept(severity, message, { node: target, code, data, relatedInformation });
      }
    }
  }

  checkDeclarationNameCasing(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    if (!schemaHasDeclarations(schema)) return;
    // An ARM long form (`<module>_arm_lf`) carries the ARM convention too.
    const lowerName = schema.name.toLowerCase();
    const isArmSchema = lowerName.endsWith("_arm") || lowerName.endsWith("_arm_lf");

    for (const declaration of schema.body.declarations) {
      if (!isEntityDefinition(declaration) && !isTypeDefinition(declaration)) continue;
      let expectedName: string;
      let kind: "Entity" | "Type";
      if (isEntityDefinition(declaration)) {
        kind = "Entity";
        expectedName = isArmSchema
          ? declaration.name.charAt(0).toUpperCase() + declaration.name.slice(1)
          : declaration.name.toLowerCase();
      } else {
        kind = "Type";
        expectedName = declaration.name.toLowerCase();
      }

      if (declaration.name === expectedName) continue;
      const data: DeclarationNameCaseData = { expectedName };
      accept("info", `${kind} name should be '${expectedName}'.`, {
        node: declaration,
        property: "name",
        code: ExpressP11Issues.DeclarationNameCase,
        data,
      });
    }
  }

  /**
   * XS-PUB-004: a reference is spelled as the declaration it binds to (a supertype, a type, an interfaced schema or
   * item), and an interfaced schema name follows the WG 12 convention. EXPRESS reads names regardless of case
   * (ISO 10303-11:2004 7.1.2); the spelling is a WG 12 rule (RUL-26 for schema names, RUL-36 for SUBTYPE OF). Under
   * the case rule (express-p11-case-rule-scope.ts) a type written in another case binds and an entity or schema
   * written in another case does not, in a short form; both are reported here, naming the declaration.
   */
  checkReferenceNameCase(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    // A long form is generated (eengine) and unique regardless of case (WG11 N239); the publication reads short forms.
    if (isLongForm(schema.name)) return;
    for (const node of AstUtils.streamAst(schema)) {
      for (const site of referenceNameSites(node)) {
        const written = site.reference.$refText;
        if (!written) continue;
        const declared = this.declaredSpelling(site, written);
        const isSchema = site.property === "schema";
        if (declared !== undefined && declared !== written) {
          const data: ReferenceNameCaseData = { expectedName: declared };
          accept("warning", `Reference '${written}' is spelled differently from its declaration '${declared}'.`, {
            node: site.container,
            property: site.property,
            index: site.index,
            code: ExpressP11Issues.ReferenceNameCase,
            data,
          });
        } else if (isSchema) {
          const expectedName = conventionalSchemaName(written);
          if (expectedName === written) continue;
          const data: ReferenceNameCaseData = { expectedName };
          accept(
            "warning",
            `Schema name '${written}' should be '${expectedName}': resource schemas are lower case, ARM and MIM schemas start with an upper-case letter.`,
            { node: site.container, property: site.property, code: ExpressP11Issues.ReferenceNameCase, data }
          );
        }
      }
    }
  }

  /**
   * The spelling of the declaration a reference binds to; for a reference that does not bind, the spelling of a
   * declaration in its scope whose name differs from the written one only in case. Undefined when neither exists.
   */
  private declaredSpelling(site: ReferenceSite, written: string): string | undefined {
    const target = site.reference.ref;
    if (target) {
      const name = this.nameProvider.getName(target);
      return name !== undefined && name.toLowerCase() === written.toLowerCase() ? name : undefined;
    }
    const lower = written.toLowerCase();
    const scope = this.scopeProvider.getScope({ reference: site.reference, container: site.container, property: site.property, index: site.index });
    return scope.getAllElements().find((description) => description.name.toLowerCase() === lower)?.name;
  }

  checkLocalVariablesDoNotDuplicateLoopIndices(local: Local_decl, accept: ValidationAcceptor): void {
    const algorithm = local.$container.$container;
    const loopIndices = new Set<string>();

    for (const statement of algorithm.stmts) {
      for (const node of AstUtils.streamAst(statement)) {
        if (isIncrement_control(node)) {
          loopIndices.add(node.var.name.toLowerCase());
        }
      }
    }

    for (const declaration of local.variables) {
      for (const variable of declaration.ids) {
        if (!loopIndices.has(variable.name.toLowerCase())) continue;
        accept("error", `Local variable '${variable.name}' duplicates an implicitly declared loop index.`, {
          node: variable,
          property: "name",
          code: ExpressP11Issues.DuplicateLoopIndex,
        });
      }
    }
  }

  private buildImportedResourcesIndex(listOfReferenceFromClauses: Reference_clause[]): MultiMap<SchemaName, NamedNode> {
    const importedResources = new MultiMap<SchemaName, NamedNode>();
    listOfReferenceFromClauses.forEach((referenceFrom) => {
      //if (!referenceFrom.schema.ref) return;
      //referenceClauses.set(referenceFrom.schema.$refText, referenceFrom);
      referenceFrom.resources.forEach((resourceDeclaration) => {
        if (!resourceDeclaration.resource.ref) return;
        const resourceName = resourceDeclaration.isRenamed ? resourceDeclaration.name : resourceDeclaration.resource.$refText;
        if (!resourceName) return;
        importedResources.add(referenceFrom.schema.$refText, {
          name: resourceName,
          node: resourceDeclaration.resource.ref,
        });
      });
    });
    return importedResources;
  }

  private buildUsedResourcesIndex(listOfUseFromClauses: Use_clause[]): MultiMap<SchemaName, NamedNode> {
    const usedResources = new MultiMap<SchemaName, NamedNode>();
    listOfUseFromClauses.forEach((useFrom) => {
      //if (!referenceFrom.schema.ref) return;
      //referenceClauses.set(referenceFrom.schema.$refText, referenceFrom);
      useFrom.resources.forEach((resourceDeclaration) => {
        if (!resourceDeclaration.resource.ref) return;
        const resourceName = resourceDeclaration.isRenamed ? resourceDeclaration.name : resourceDeclaration.resource.$refText;
        if (!resourceName) return;
        usedResources.add(useFrom.schema.$refText, {
          name: resourceName,
          node: resourceDeclaration.resource.ref,
        });
      });
    });
    return usedResources;
  }
  checkReferencesAreImported(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    try {
      const referenceSpecifications = getReferenceSpecifications(schema);
      const useSpecifications = getUseSpecifications(schema);
      if (!schema.name) return;
      const importedResourcesIndex = this.buildImportedResourcesIndex(referenceSpecifications);
      this.buildUsedResourcesIndex(useSpecifications).forEach((value, key) => importedResourcesIndex.add(key, value));
      const fullyImportedSchemas = new Set(
        [...referenceSpecifications, ...useSpecifications]
          .filter((specification) => specification.resources.length === 0)
          .map((specification) => specification.schema.$refText)
      );
      const currentSchemaName = schema.name;
      const currentSchema = this.typeContainer.getSchemaOf(schema);
      const visibleDefinitions = new Set<AstNode>();
      if (currentSchema) {
        for (const definitions of this.typeContainer.getAllRessourcesFrom(currentSchema, true).resources.values()) {
          for (const definition of definitions.values()) visibleDefinitions.add(definition.resource.getNode());
        }
      }

      for (const node of AstUtils.streamAst(schema)) {
        AstUtils.streamReferences(node).forEach((resourceNeeded) => {
          if (
            isResource_or_rename(resourceNeeded.container) ||
            isReference_clause(resourceNeeded.container) ||
            isUse_clause(resourceNeeded.container)
          )
            return;

          //console.log(resourceNeeded.reference.ref);
          if (!isReference(resourceNeeded.reference)) return;
          const ref = resourceNeeded.reference;
          if (!ref.$nodeDescription) return;
          const reference = ref.ref;
          if (
            !isEntityDefinition(reference) &&
            !isTypeDefinition(reference) &&
            !isConstant_body(reference) &&
            !isFunction_head(reference) &&
            !isProcedure_head(reference)
          )
            return;

          const schemaNeeded = AstUtils.getContainerOfType(ref.ref, isSchemaDefinition);
          if (!schemaNeeded || !schemaNeeded.name) return;
          if (schemaNeeded.name === currentSchemaName) return;
          if (fullyImportedSchemas.has(schemaNeeded.name)) return;

          const resourceImported = importedResourcesIndex.get(schemaNeeded.name).find((r) => r.node === ref.ref);

          if (!resourceImported) {
            // A declaration reached through the current schema's transitive
            // interface closure does not require another direct import.
            if (visibleDefinitions.has(reference)) return;
            const schemaIsAlreadyImported = importedResourcesIndex.has(schemaNeeded.name);
            this.issueReferenceStatementDiagnostic(currentSchemaName, schemaIsAlreadyImported, schemaNeeded, resourceNeeded, accept);
            return;
          }

          // The written spelling must be the imported (possibly renamed) name, compared under the case rule.
          const written = resourceNeeded.reference.$refText;
          const sameName =
            resourceImported.name === written ||
            (foldsCase(reference.$type, isLongForm(currentSchemaName)) && resourceImported.name.toLowerCase() === written.toLowerCase());
          if (!sameName) {
            this.issueRenameReferenceDiagnostic(resourceImported, accept, resourceNeeded);
            return;
          }
        });
      }
    } catch {
      console.log("ERROR VALIDATION");
    }
  }

  private issueReferenceStatementDiagnostic(
    sourceSchema: string,
    schemaIsAlreadyImported: boolean,
    schemaNeeded: SchemaDefinition,
    resourceNeeded: ReferenceInfo,
    accept: ValidationAcceptor
  ) {
    const data: ReferenceStatementData = {
      schema: schemaNeeded.name,
      resource: resourceNeeded.reference.$refText,
      sourceSchema,
    };
    const code = schemaIsAlreadyImported ? ExpressP11Issues.ReferenceStatementIncomplete : ExpressP11Issues.ReferenceStatementMissing;
    accept("error", "This resource needs to be imported.", {
      node: resourceNeeded.container,
      property: resourceNeeded.property,
      code,
      data,
    });
  }

  private issueRenameReferenceDiagnostic(
    resourceImported: { name: string; node: AstNode },
    accept: ValidationAcceptor,
    resourceNeeded: ReferenceInfo
  ) {
    const data: WrongReferenceLabelData = { expectedReference: resourceImported.name };
    accept("error", `'${resourceNeeded.reference.$refText}' should be referenced as '${resourceImported.name}'`, {
      node: resourceNeeded.container,
      property: resourceNeeded.property,
      code: ExpressP11Issues.WrongReferenceLabel,
      data,
    });
  }
  // checkReferencesAreImportedV2(schema: Schema_decl, accept: ValidationAcceptor): void {
  //   // this.resourceManager.loadImportedResources();

  //   //const referenceFromClauses = getReferenceDeclarations(schema);
  //   if (!schema.name) return;
  //   //this.buildImportedResourcesIndex(referenceFromClauses);
  //   const currentSchemaName = schema.name;
  //   const importedResources = this.resourceManager.getImportedResource(currentSchemaName);
  //   console.log(`in ${currentSchemaName}, we found ${importedResources.length} imports`);
  //   for (const node of AstUtils.streamAst(schema)) {
  //     AstUtils.streamReferences(node).forEach((resourceNeeded) => {
  //       if (isResource_or_rename(resourceNeeded.container) || isReference_clause(resourceNeeded.container)) return;

  //       if (!resourceNeeded.reference.$nodeDescription) return;

  //       const schemaNeeded = AstUtils.getContainerOfType(resourceNeeded.reference.ref, isSchema_decl);
  //       if (!schemaNeeded || !schemaNeeded.name) return;
  //       if (schemaNeeded.name === currentSchemaName) return;

  //       const resourceImported = importedResources.find(
  //         (r) => r.from === schemaNeeded.name && r.node === resourceNeeded.reference.ref
  //       );
  //       // .get(schemaNeeded.name)
  //       // .find((ref) => ref.node === resourceNeeded.reference.ref);

  //       if (!resourceImported) {
  //         const schemaIsAlreadyImported = importedResources.filter((r) => r.from === schemaNeeded.name).length > 0;
  //         this.issueReferenceStatementDiagnostic(schemaIsAlreadyImported, schemaNeeded, resourceNeeded, accept);
  //         return;
  //       }

  //       if (resourceImported.name !== resourceNeeded.reference.$refText) {
  //         this.issueRenameReferenceDiagnostic(resourceImported, accept, resourceNeeded);
  //         return;
  //       }
  //     });
  //   }
  // }
}
