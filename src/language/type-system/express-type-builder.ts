import { AstNode, AstUtils } from "langium";
import {
  Attribute_decl,
  Bound_spec,
  Complex_Primary_body,
  Complex_Primary_reference,
  EntityDefinition,
  Inverse_attr,
  Parameter_type,
  Qualifier,
  TypeDefinition,
  Underlying_type,
  isAggregate_type,
  isArray_type,
  isAttribute_decl,
  isAttribute_id,
  isAttribute_qualifier,
  isBag_type,
  isBinary_type,
  isComplex_Primary,
  isComplex_Primary_reference,
  isConstant_body,
  isDerived_attr,
  isEntityDefinition,
  isEnumeration_id,
  isExplicit_attr,
  isFormal_parameter,
  isFunctionDefinition,
  isGeneral_array_type,
  isGeneral_bag_type,
  isGeneral_list_type,
  isGeneral_set_type,
  isGeneric_entity_type,
  isGeneric_type,
  isGroup_qualifier,
  isIncrement_control,
  isIndex_qualifier,
  isInverse_attr,
  isList_type,
  isLiteral,
  isLocal_variable,
  isNamed_types,
  isParameter_id,
  isQuery_expression,
  isReal_type,
  isRedeclared_attribute,
  isSelect_extension,
  isSelect_list,
  isSelect_type,
  isSet_type,
  isString_type,
  isTypeDefinition,
  isVariable_id,
} from "../generated/ast.js";
import type { ExpressP11TypeContainer } from "../express-p11-type-container.js";
import type { ExpressP11SelectExtensionIndex } from "../express-p11-select-extension-index.js";
import { AggK, Ty, elementType } from "./express-type-model.js";

/**
 * Builds the resolved `Ty` of a declared EXPRESS type (and of simple expression
 * heads) from the AST. Returns `undefined` whenever the type cannot be placed in
 * the proved domain with certainty: enumerations, GENERIC_ENTITY, AGGREGATE,
 * unresolved references, non-literal bounds, cyclic defined types. Callers
 * treat `undefined` as "unknown" and report nothing, so every diagnostic rests
 * on a type the Lean model covers.
 */
export class ExpressTypeBuilder {
  constructor(
    private readonly typeContainer: ExpressP11TypeContainer,
    private readonly selectExtensions: ExpressP11SelectExtensionIndex
  ) {}

  /** The declared type of an attribute, parameter, variable or constant. */
  ofDeclaration(declaration: AstNode | undefined): Ty | undefined {
    if (!declaration) return undefined;
    if (isAttribute_decl(declaration)) return this.ofAttribute(declaration);
    if (isParameter_id(declaration)) return isFormal_parameter(declaration.$container) ? this.ofType(declaration.$container.type) : undefined;
    if (isVariable_id(declaration)) {
      const owner = declaration.$container;
      if (isLocal_variable(owner)) return this.ofType(owner.type);
      if (isIncrement_control(owner)) return { kind: "simp", s: "integer" };
      if (isQuery_expression(owner)) {
        const source = this.ofExpression(owner.source?.expression);
        return source ? elementType(source) : undefined;
      }
      return undefined;
    }
    if (isConstant_body(declaration)) return this.ofType(declaration.type);
    return undefined;
  }

  ofAttribute(attribute: Attribute_decl): Ty | undefined {
    const owner = attribute.$container;
    if (isExplicit_attr(owner) || isDerived_attr(owner)) return this.ofType(owner.type);
    if (isInverse_attr(owner)) return this.ofInverse(owner);
    return undefined;
  }

  /** `SET [b:t] OF e`, `BAG [b:t] OF e` or `e`; the aggregate keyword is not an AST property, so it is read from the node text. */
  private ofInverse(inverse: Inverse_attr): Ty | undefined {
    const entity = inverse.type.ref;
    if (!entity) return undefined;
    const target = this.ofEntity(entity);
    if (!target) return undefined;
    const text = inverse.$cstNode?.text ?? "";
    const keyword = /:\s*(SET|BAG)\b/i.exec(text)?.[1]?.toLowerCase();
    if (!keyword) return target;
    const bounds = this.bounds(inverse.bound, { lo: 0, hi: undefined });
    if (!bounds) return undefined;
    return { kind: "agg", k: keyword as "set" | "bag", lo: bounds.lo, hi: bounds.hi, elem: target };
  }

  /**
   * Entity type with its transitive supertype names, walked over the `SUBTYPE OF`
   * references of the AST. An unresolved supertype reference makes the closure
   * unknown, so no verdict can rest on an incomplete supertype list.
   */
  ofEntity(entity: EntityDefinition): Ty | undefined {
    const supers = this.supertypesOf(entity);
    if (!supers) return undefined;
    return { kind: "ent", name: entity.name.toLowerCase(), supers: supers.map((e) => e.name.toLowerCase()), node: entity };
  }

  /** Transitive supertypes in breadth-first order; `undefined` when any supertype reference is unresolved. */
  supertypesOf(entity: EntityDefinition): EntityDefinition[] | undefined {
    const result: EntityDefinition[] = [];
    const seen = new Set<EntityDefinition>([entity]);
    const queue: EntityDefinition[] = [entity];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const reference of current.types?.supertypes?.entities ?? []) {
        const target = reference.entity.ref;
        if (!target) return undefined;
        if (seen.has(target)) continue;
        seen.add(target);
        result.push(target);
        queue.push(target);
      }
    }
    return result;
  }

  /**
   * The declared type of attribute `name` as seen from `entity`
   * (ISO 10303-11:2004 12.7.3: declared in that entity data type, a supertype or
   * a subtype of it). The entity and its supertypes are searched nearest first,
   * so a redeclaration wins over the original; two candidates at the same depth
   * are ambiguous (12.7.3: indeterminate) and give `undefined`. Subtypes are
   * consulted only when nothing nearer declares the name, and only when they
   * agree on one type. The workspace linker may bind a qualified attribute to a
   * same-named attribute of a sibling entity, so this lookup never trusts the
   * linker's target for an attribute qualifier.
   */
  attributeTypeIn(entity: EntityDefinition, name: string): Ty | undefined {
    if (this.typeContainer.hasUnresolvedSupertypes(entity)) return undefined;
    const candidates = this.typeContainer.getVisibleAttributeCandidates(entity, name);
    for (const level of candidates) {
      if (level.direction === "descendant") break;
      if (level.declarations.length === 1) return this.ofAttribute(level.declarations[0]);
      if (level.declarations.length > 1) return undefined;
    }
    const below = candidates.filter((level) => level.direction === "descendant").flatMap((level) => level.declarations);
    if (below.length === 0) return undefined;
    const types = below.map((a) => this.ofAttribute(a));
    if (types.some((t) => !t)) return undefined;
    // compare structurally without the TypeScript-only AST bookkeeping, which is circular
    const rendered = new Set(types.map((t) => JSON.stringify(t, (key, value) => (key === "node" ? undefined : value))));
    return rendered.size === 1 ? types[0] : undefined;
  }

  /** The identifier an attribute declaration introduces or redeclares. */
  effectiveName(attribute: Attribute_decl): string | undefined {
    if (isAttribute_id(attribute)) return attribute.name;
    if (isRedeclared_attribute(attribute)) return attribute.isRenamed && attribute.name ? attribute.name : attribute.qualifiedAttribute.attribute.target.$refText;
    return undefined;
  }

  /** Parameter_type, Instantiable_type or Underlying_type; the keyword simple types arrive as strings. */
  ofType(type: Parameter_type | Underlying_type | string | undefined, visiting: Set<TypeDefinition> = new Set()): Ty | undefined {
    if (type === undefined) return undefined;
    if (typeof type === "string") {
      switch (type.toUpperCase()) {
        case "INTEGER":
          return { kind: "simp", s: "integer" };
        case "BOOLEAN":
          return { kind: "simp", s: "boolean" };
        case "LOGICAL":
          return { kind: "simp", s: "logical" };
        case "NUMBER":
          return { kind: "simp", s: "number" };
        default:
          return undefined;
      }
    }
    // INTEGER, BOOLEAN, LOGICAL and NUMBER are data-type rules returning strings;
    // Langium wraps them in a property-less Simple_types node whose text is the keyword.
    if ((type as AstNode).$type === "Simple_types") return this.ofType((type as AstNode).$cstNode?.text?.trim() ?? "", visiting);
    if (isReal_type(type)) return { kind: "simp", s: "real" };
    if (isString_type(type)) return { kind: "simp", s: "string" };
    if (isBinary_type(type)) return { kind: "simp", s: "binary" };
    if (isGeneric_type(type)) return { kind: "gen" };
    if (isGeneric_entity_type(type) || isAggregate_type(type)) return undefined;
    if (isGeneral_list_type(type) || isList_type(type)) return this.aggregate("list", type.bound, type.type, visiting, { lo: 0, hi: undefined });
    if (isGeneral_bag_type(type) || isBag_type(type)) return this.aggregate("bag", type.bound, type.type, visiting, { lo: 0, hi: undefined });
    if (isGeneral_set_type(type) || isSet_type(type)) return this.aggregate("set", type.bound, type.type, visiting, { lo: 0, hi: undefined });
    if (isGeneral_array_type(type) || isArray_type(type)) return this.aggregate("array", type.bound, type.type, visiting, undefined);
    if (isNamed_types(type)) {
      const target = type.of.ref;
      if (!target) return undefined;
      if (isEntityDefinition(target)) return this.ofEntity(target);
      if (isTypeDefinition(target)) return this.ofTypeDefinition(target, visiting);
      return undefined;
    }
    if (isSelect_type(type)) {
      // a SELECT appears here only as an underlying type; ofTypeDefinition names it
      return undefined;
    }
    return undefined;
  }

  ofTypeDefinition(definition: TypeDefinition, visiting: Set<TypeDefinition> = new Set()): Ty | undefined {
    if (visiting.has(definition)) return undefined;
    visiting.add(definition);
    try {
      const underlying = definition.underlyingType;
      if (isSelect_type(underlying)) {
        const members = this.selectMembers(definition, visiting, new Set());
        if (!members) return undefined;
        return { kind: "defn", name: definition.name, under: { kind: "sel", name: definition.name, members: members.types, extensible: members.extensible } };
      }
      const under = this.ofType(underlying, visiting);
      return under ? { kind: "defn", name: definition.name, under } : undefined;
    } finally {
      visiting.delete(definition);
    }
  }

  /**
   * The effective member list of a SELECT: its own list, the list of the select
   * it is BASED_ON (transitively), and the lists of every select BASED_ON it
   * (transitively) that the workspace holds. Enumeration members or unresolved
   * references make the whole select unknown.
   */
  private selectMembers(
    definition: TypeDefinition,
    visiting: Set<TypeDefinition>,
    seen: Set<TypeDefinition>
  ): { types: Ty[]; extensible: boolean } | undefined {
    if (seen.has(definition)) return { types: [], extensible: false };
    seen.add(definition);
    const underlying = definition.underlyingType;
    if (!isSelect_type(underlying)) return undefined;
    const types: Ty[] = [];
    let extensible = Boolean(underlying.isExtensible);
    const lists = [];
    if (isSelect_list(underlying.select)) lists.push(underlying.select);
    if (isSelect_extension(underlying.select)) {
      if (underlying.select.selectList) lists.push(underlying.select.selectList);
      const base = underlying.select.type.ref;
      if (!base) return undefined;
      const inherited = this.selectMembers(base, visiting, seen);
      if (!inherited) return undefined;
      types.push(...inherited.types);
      extensible = extensible || inherited.extensible;
    }
    for (const list of lists) {
      for (const reference of list.types) {
        const target = reference.ref;
        if (!target) return undefined;
        if (isEntityDefinition(target)) {
          const member = this.ofEntity(target);
          if (!member) return undefined;
          types.push(member);
        } else if (isTypeDefinition(target)) {
          const member = this.ofTypeDefinition(target, visiting);
          if (!member) return undefined;
          types.push(member);
        } else return undefined;
      }
    }
    for (const extension of this.selectExtensions.extensionsOf(definition)) {
      const added = this.selectMembers(extension, visiting, seen);
      if (!added) return undefined;
      types.push(...added.types);
    }
    return { types, extensible };
  }

  private aggregate(
    k: AggK,
    bound: Bound_spec | undefined,
    element: Parameter_type | Underlying_type | string,
    visiting: Set<TypeDefinition>,
    defaults: { lo: number; hi: number | undefined } | undefined
  ): Ty | undefined {
    const bounds = this.bounds(bound, defaults);
    if (!bounds) return undefined;
    const elem = this.ofType(element, visiting);
    if (!elem) return undefined;
    return { kind: "agg", k, lo: bounds.lo, hi: bounds.hi, elem };
  }

  /** Literal integer bounds and `?`; anything else (an expression, a constant) is unknown. */
  private bounds(bound: Bound_spec | undefined, defaults: { lo: number; hi: number | undefined } | undefined): { lo: number; hi: number | undefined } | undefined {
    if (!bound) return defaults;
    const lo = this.literalBound(bound.lower);
    const hi = this.literalBound(bound.upper);
    if (lo === undefined || lo === "unbounded" || hi === undefined) return undefined;
    return { lo, hi: hi === "unbounded" ? undefined : hi };
  }

  private literalBound(expression: AstNode | undefined): number | "unbounded" | undefined {
    const primary = (expression as { primary?: AstNode; op?: string } | undefined)?.primary;
    const op = (expression as { op?: string } | undefined)?.op;
    if (!primary || op) return undefined;
    if (isLiteral(primary) && typeof primary.value === "string" && /^\d+$/.test(primary.value)) return Number(primary.value);
    if (isComplex_Primary(primary) && primary.head === "?" && (primary.body?.qualifiers?.length ?? 0) === 0 && !primary.body?.parameterList) return "unbounded";
    return undefined;
  }

  /** The type of a simple expression when it is a bare primary; otherwise unknown. */
  ofExpression(expression: AstNode | undefined): Ty | undefined {
    const primary = (expression as { primary?: AstNode; op?: string } | undefined)?.primary;
    const op = (expression as { op?: string } | undefined)?.op;
    if (!primary || op) return undefined;
    if (isComplex_Primary(primary)) {
      return this.ofQualifiedHead(primary.head, primary.body, primary.body?.qualifiers?.length ?? 0);
    }
    if (isLiteral(primary)) return this.ofLiteral(primary.value);
    return undefined;
  }

  private ofLiteral(value: unknown): Ty | undefined {
    if (typeof value !== "string") return undefined;
    if (/^\d+$/.test(value)) return { kind: "simp", s: "integer" };
    if (/^\d/.test(value)) return { kind: "simp", s: "real" };
    if (value.startsWith("'") || value.startsWith('"')) return { kind: "simp", s: "string" };
    if (/^%[01]+$/.test(value)) return { kind: "simp", s: "binary" };
    if (/^(TRUE|FALSE|UNKNOWN)$/i.test(value)) return { kind: "simp", s: "logical" };
    return undefined;
  }

  /** The declared type of `head` followed by the first `upTo` qualifiers of `body`. */
  ofQualifiedHead(head: Complex_Primary_reference | string, body: Complex_Primary_body | undefined, upTo: number): Ty | undefined {
    const qualifiers = body?.qualifiers ?? [];
    let current = this.ofHead(head, Boolean(body?.parameterList), body ?? (typeof head === "string" ? undefined : head));
    for (let i = 0; i < upTo && i < qualifiers.length; i++) {
      current = this.afterQualifier(current, qualifiers[i]);
    }
    return current;
  }

  ofHead(head: Complex_Primary_reference | string, hasParameters: boolean, context: AstNode | undefined): Ty | undefined {
    if (typeof head === "string") return context ? this.ofBuiltIn(head, hasParameters, context) : undefined;
    if (!isComplex_Primary_reference(head)) return undefined;
    const target = head.to.ref;
    if (!target) return undefined;
    if (isEntityDefinition(target)) {
      // with parameters it is an entity constructor; alone it is the population of the entity (9.6)
      const entity = this.ofEntity(target);
      if (!entity) return undefined;
      return hasParameters ? entity : { kind: "agg", k: "set", lo: 0, hi: undefined, elem: entity };
    }
    if (isFunctionDefinition(target)) return hasParameters ? this.ofType(target.head?.returnType) : undefined;
    if (isTypeDefinition(target) || isEnumeration_id(target)) return undefined;
    if (isAttribute_decl(target)) {
      // a simple attribute reference: resolve the name from the enclosing entity rather
      // than trusting the linker's target (see attributeTypeIn)
      const enclosing = AstUtils.getContainerOfType(context, isEntityDefinition);
      const name = this.effectiveName(target);
      return enclosing && name ? this.attributeTypeIn(enclosing, name) : undefined;
    }
    return this.ofDeclaration(target);
  }

  private ofBuiltIn(name: string, hasParameters: boolean, context: AstNode): Ty | undefined {
    switch (name.toUpperCase()) {
      case "SELF": {
        const entity = AstUtils.getContainerOfType(context, isEntityDefinition);
        if (entity) return this.ofEntity(entity);
        const type = AstUtils.getContainerOfType(context, isTypeDefinition);
        return type ? this.ofTypeDefinition(type) : undefined;
      }
      case "PI":
      case "CONST_E":
        return { kind: "simp", s: "real" };
      case "TYPEOF":
      case "ROLESOF":
        return hasParameters ? { kind: "agg", k: "set", lo: 0, hi: undefined, elem: { kind: "simp", s: "string" } } : undefined;
      case "USEDIN":
        return hasParameters ? { kind: "agg", k: "bag", lo: 0, hi: undefined, elem: { kind: "gen" } } : undefined;
      case "SIZEOF":
      case "HIINDEX":
      case "LOINDEX":
      case "HIBOUND":
      case "LOBOUND":
      case "LENGTH":
      case "BLENGTH":
        return hasParameters ? { kind: "simp", s: "integer" } : undefined;
      case "EXISTS":
      case "ODD":
        return hasParameters ? { kind: "simp", s: "boolean" } : undefined;
      case "VALUE_IN":
      case "VALUE_UNIQUE":
        return hasParameters ? { kind: "simp", s: "logical" } : undefined;
      case "FORMAT":
        return hasParameters ? { kind: "simp", s: "string" } : undefined;
      default:
        return undefined;
    }
  }

  /** The entity behind a type, seen through defined types; selects and the rest give `undefined`. */
  private entityOf(t: Ty): EntityDefinition | undefined {
    if (t.kind === "ent") return t.node as EntityDefinition | undefined;
    if (t.kind === "defn") return this.entityOf(t.under);
    return undefined;
  }

  /** The declared type after applying one qualifier to an operand of type `current`. */
  afterQualifier(current: Ty | undefined, qualifier: Qualifier): Ty | undefined {
    if (isGroup_qualifier(qualifier)) {
      const entity = qualifier.entity.ref;
      return entity ? this.ofEntity(entity) : undefined;
    }
    if (isAttribute_qualifier(qualifier)) {
      const operand = current ? this.entityOf(current) : undefined;
      return operand ? this.attributeTypeIn(operand, qualifier.target.$refText) : undefined;
    }
    if (isIndex_qualifier(qualifier)) {
      return current ? elementType(current) : undefined;
    }
    return undefined;
  }
}
