import { AstNode, EmptyFileSystem, LangiumDocument, streamAllContents } from "langium";
import { describe, test, expect } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { parseDocument } from "langium/test";
import {
  DefinitionType,
  EnumValue,
  ExpressConflictType,
  ExpressP11EnumType,
  ExpressP11ParameterTypeResolutionType,
  ExpressP11ParameterTypeResolver,
  ExpressP11SelectType,
} from "../language/express-p11-type-utilities.js";
import { EntityDefinition, Explicit_attr, isAttribute_decl, isExplicit_attr } from "../language/generated/ast.js";

describe("Type container", async () => {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;

  const expFile =
    "SCHEMA Nist;" +
    "TYPE NistEmployee = SELECT(Fed, Guest) ;" +
    "END_TYPE;" +
    "TYPE NistEnum = ENUMERATION OF(Fed, Guest) ;" +
    "END_TYPE;" +
    "ENTITY Person;" +
    "END_ENTITY;" +
    "ENTITY Employee SUBTYPE OF(Person);" +
    "END_ENTITY;" +
    "ENTITY Fed SUBTYPE OF(Employee);" +
    "END_ENTITY;" +
    "ENTITY Guest SUBTYPE OF(Employee);" +
    "END_ENTITY;" +
    "END_SCHEMA;";

  const expDocument: LangiumDocument<AstNode> = await parseDocument(services, expFile);
  await services.shared.workspace.DocumentBuilder.build([expDocument]);
  const typeContainer = services.shared.workspace.TypeContainer;

  test("All SCHEMA are found", () => {
    expect(typeContainer.getSchemas().get("Nist")).toBeDefined();
    expect(typeContainer.getSchemas().get("nistt")).toBeUndefined();
  });

  test("All ENTITY are found", () => {
    expect(typeContainer.getSchemas().get("Nist")?.getEntity("Person")).toBeDefined();
    expect(typeContainer.getSchemas().get("Nist")?.getEntity("Employee")).toBeDefined();
    expect(typeContainer.getSchemas().get("Nist")?.getEntity("Fed")).toBeDefined();
    expect(typeContainer.getSchemas().get("Nist")?.getEntity("Guest")).toBeDefined();
  });

  test("All TYPE are found", () => {
    expect(typeContainer.getSchemas().get("Nist")?.getType("NistEmployee")).toBeDefined();
    expect(typeContainer.getSchemas().get("Nist")?.getType("NistEnum")).toBeDefined();
  });

  test("TYPE type(ENUMERATION/SELECT) is detected", () => {
    expect(
      typeContainer.getSchemas().get("Nist")?.getType("NistEmployee")?.getDefinition().type === DefinitionType.SelectType
    ).toBeTruthy();
    expect(typeContainer.getSchemas().get("Nist")?.getType("NistEnum")?.getDefinition().type === DefinitionType.EnumType).toBeTruthy();
  });

  test("Subtypes are found", () => {
    const personNode = typeContainer.getSchemas().get("Nist")?.getEntity("Person")?.getNode();
    expect(typeContainer.getSubTypesFromDefinition(personNode!).length).toBe(3);

    const employeeNode = typeContainer.getSchemas().get("Nist")?.getEntity("Employee")?.getNode();
    expect(typeContainer.getSubTypesFromDefinition(employeeNode!).length).toBe(2);

    const fedNode = typeContainer.getSchemas().get("Nist")?.getEntity("Fed")?.getNode();
    expect(typeContainer.getSubTypesFromDefinition(fedNode!).length).toBe(0);

    const guestNode = typeContainer.getSchemas().get("Nist")?.getEntity("Guest")?.getNode();
    expect(typeContainer.getSubTypesFromDefinition(guestNode!).length).toBe(0);
  });
  test("Supertypes are found", () => {
    const personNode = typeContainer.getSchemas().get("Nist")?.getEntity("Person")?.getNode();
    expect(typeContainer.getSuperTypesFromDefinition(personNode!).length).toBe(0);

    const employeeNode = typeContainer.getSchemas().get("Nist")?.getEntity("Employee")?.getNode();
    expect(typeContainer.getSuperTypesFromDefinition(employeeNode!).length).toBe(1);

    const fedNode = typeContainer.getSchemas().get("Nist")?.getEntity("Fed")?.getNode();
    expect(typeContainer.getSuperTypesFromDefinition(fedNode!).length).toBe(2);

    const guestNode = typeContainer.getSchemas().get("Nist")?.getEntity("Guest")?.getNode();
    expect(typeContainer.getSuperTypesFromDefinition(guestNode!).length).toBe(2);
  });
  test("ENTITY graph (SELF + supertypes + subtypes) is valid", () => {
    const personNode = typeContainer.getSchemas().get("Nist")?.getEntity("Person")?.getNode();
    expect(typeContainer.getFullSubSuperGraph(personNode!).length).toBe(4);

    const employeeNode = typeContainer.getSchemas().get("Nist")?.getEntity("Employee")?.getNode();
    expect(typeContainer.getFullSubSuperGraph(employeeNode!).length).toBe(4);

    const fedNode = typeContainer.getSchemas().get("Nist")?.getEntity("Fed")?.getNode();
    expect(typeContainer.getFullSubSuperGraph(fedNode!).length).toBe(3);

    const guestNode = typeContainer.getSchemas().get("Nist")?.getEntity("Guest")?.getNode();
    expect(typeContainer.getFullSubSuperGraph(guestNode!).length).toBe(3);
  });
});

describe("TYPE resolver", async () => {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;

  const expFile =
    "SCHEMA Nist;" +
    "TYPE NistSelect = SELECT(Fed) ;" +
    "END_TYPE;" +
    "TYPE NistEnum = EXTENSIBLE ENUMERATION OF(Fed, Guest) ;" +
    "END_TYPE;" +
    "TYPE ExtendedNistEnum = ENUMERATION BASED_ON NistEnum WITH(New) ;" +
    "END_TYPE;" +
    "TYPE ExtendedNistSelect = SELECT BASED_ON NistSelect WITH(Guest) ;" +
    "END_TYPE;" +
    "ENTITY Person;" +
    "END_ENTITY;" +
    "ENTITY Employee SUBTYPE OF(Person);" +
    "END_ENTITY;" +
    "ENTITY Fed SUBTYPE OF(Employee);" +
    "END_ENTITY;" +
    "ENTITY Guest SUBTYPE OF(Employee);" +
    "END_ENTITY;" +
    "END_SCHEMA;";

  const expDocument: LangiumDocument<AstNode> = await parseDocument(services, expFile);
  await services.shared.workspace.DocumentBuilder.build([expDocument]);
  const typeContainer = services.shared.workspace.TypeContainer;

  test("ENUMERATION values are found", () => {
    expect((typeContainer.getSchemas().get("Nist")?.getType("NistEnum") as ExpressP11EnumType).getValues().length).toBe(2);
  });
  test("ENUMERATION BASED_ON values are found", () => {
    expect((typeContainer.getSchemas().get("Nist")?.getType("ExtendedNistEnum") as ExpressP11EnumType).getValues().length).toBe(3);
  });

  test("SELECT values are found", () => {
    expect((typeContainer.getSchemas().get("Nist")?.getType("NistSelect") as ExpressP11SelectType).getValues().length).toBe(1);
  });

  test("SELECT BASED_ON values are found", () => {
    expect((typeContainer.getSchemas().get("Nist")?.getType("ExtendedNistSelect") as ExpressP11SelectType).getValues().length).toBe(2);
  });
});

describe("Interfaces", async () => {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;

  const expFile =
    "SCHEMA Zero;" +
    "ENTITY EZeroOne;" +
    "END_ENTITY;" +
    "ENTITY EZeroTwo;" +
    "END_ENTITY;" +
    "END_SCHEMA;" +
    //One
    "SCHEMA One;" +
    "USE FROM Zero(EZeroOne);" +
    "ENTITY EOne;" +
    "END_ENTITY;" +
    "END_SCHEMA;" +
    //Two
    "SCHEMA Two;" +
    "USE FROM One;" +
    "ENTITY ETwo;" +
    "END_ENTITY;" +
    "END_SCHEMA;" +
    //Three
    "SCHEMA Three;" +
    "REFERENCE FROM Two;" +
    "ENTITY EThree;" +
    "END_ENTITY;" +
    "END_SCHEMA;" +
    //Four
    "SCHEMA Four;" +
    "USE FROM Zero;" +
    "ENTITY EFour;" +
    "END_ENTITY;" +
    "END_SCHEMA;";

  const expDocument: LangiumDocument<AstNode> = await parseDocument(services, expFile);
  await services.shared.workspace.DocumentBuilder.build([expDocument]);
  const typeContainer = services.shared.workspace.TypeContainer;

  test("USE FROM are imported", () => {
    expect(typeContainer.getSchemas().get("One")?.getAllResources().resources.get(DefinitionType.Entity)?.size).toBe(2);
    expect(typeContainer.getSchemas().get("Two")?.getAllResources().resources.get(DefinitionType.Entity)?.size).toBe(3);
    expect(typeContainer.getSchemas().get("Four")?.getAllResources().resources.get(DefinitionType.Entity)?.size).toBe(3);
  });

  test("REFERENCE FROM are imported", () => {
    expect(typeContainer.getSchemas().get("Three")?.getAllResources().resources.get(DefinitionType.Entity)?.size).toBe(2);
  });
});

describe("Conflicts management", async () => {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;

  const expFile =
    "SCHEMA Zero;" +
    "ENTITY EZeroOne;" +
    "END_ENTITY;" +
    "ENTITY EZeroOne;" +
    "END_ENTITY;" +
    "TYPE TType = SELECT(EZeroOne) ;" +
    "END_TYPE;" +
    "TYPE TType = SELECT(EZeroOne) ;" +
    "END_TYPE;" +
    "END_SCHEMA;";

  const expDocument: LangiumDocument<AstNode> = await parseDocument(services, expFile);
  await services.shared.workspace.DocumentBuilder.build([expDocument]);
  const typeContainer = services.shared.workspace.TypeContainer;

  test("All duplicates are detected", () => {
    expect(typeContainer.getConflicts().length).toBe(2);
  });
  test("ENTITY duplicates are detected", () => {
    expect(typeContainer.getConflicts().filter((c) => c.type === ExpressConflictType.EntityExistInSchema).length).toBe(1);
  });
  test("TYPE duplicates are detected", () => {
    expect(typeContainer.getConflicts().filter((c) => c.type === ExpressConflictType.TypeExistInSchema).length).toBe(1);
  });

  test("Duplicates in SCHEMA are ignored", () => {
    expect(typeContainer.getSchemas().get("Zero")?.getEntities().size).toBe(1);
  });
});

describe("Parameter type resolver", async () => {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;

  const expFile =
    "SCHEMA Zero;" +
    "ENTITY EZero;" +
    "END_ENTITY;" +
    "ENTITY EZeroOne;" +
    "END_ENTITY;" +
    "TYPE TSelect = EXTENSIBLE SELECT(EZero, EZeroOne) ;" +
    "END_TYPE;" +
    "TYPE TExtendSelect = SELECT BASED_ON TSelect WITH(EZeroFour) ;" +
    "END_TYPE;" +
    "TYPE TEnum = EXTENSIBLE ENUMERATION OF(Blue,White,Red) ;" +
    "END_TYPE;" +
    "TYPE TExtendEnum = ENUMERATION BASED_ON TEnum WITH(Yellow) ;" +
    "END_TYPE;" +
    "ENTITY EZeroTwo;" +
    "a: EZeroOne;" +
    "b: TSelect;" +
    "c: TEnum;" +
    "d: TExtendEnum;" +
    "e: TExtendSelect;" +
    "END_ENTITY;" +
    "ENTITY EZeroFour;" +
    "END_ENTITY;" +
    "END_SCHEMA;";

  const expDocument: LangiumDocument<AstNode> = await parseDocument(services, expFile);
  await services.shared.workspace.DocumentBuilder.build([expDocument]);
  const typeContainer = services.shared.workspace.TypeContainer;

  test("Named_type -> EntityDefinition is resolved", () => {
    const schema = typeContainer.getSchemas().get("Zero");
    const entity = schema!.getEntity("EZeroTwo");
    const attributeA = findExplicitAttribute(entity?.getNode()!, "a");
    const resolution = ExpressP11ParameterTypeResolver.resolve(attributeA!, typeContainer.getSchemas());
    expect(resolution.type).toBe(ExpressP11ParameterTypeResolutionType.EntityDefinition);
    expect((resolution.value as EntityDefinition[]).length).toBe(1);
  });

  test("Named_type -> SelectTypeDefinition is resolved", () => {
    const schema = typeContainer.getSchemas().get("Zero");
    const entity = schema!.getEntity("EZeroTwo");
    const attributeB = findExplicitAttribute(entity?.getNode()!, "b");
    const resolution = ExpressP11ParameterTypeResolver.resolve(attributeB!, typeContainer.getSchemas());
    expect(resolution.type).toBe(ExpressP11ParameterTypeResolutionType.EntityDefinition);
    expect((resolution.value as EntityDefinition[]).length).toBe(2);
  });
  test("Named_type -> EnumTypeDefinition is resolved", () => {
    const schema = typeContainer.getSchemas().get("Zero");
    const entity = schema!.getEntity("EZeroTwo");
    const attributeC = findExplicitAttribute(entity?.getNode()!, "c");
    const resolution = ExpressP11ParameterTypeResolver.resolve(attributeC!, typeContainer.getSchemas());
    expect(resolution.type).toBe(ExpressP11ParameterTypeResolutionType.EnumValue);
    expect((resolution.value as EnumValue[]).length).toBe(3);
  });

  test("Named_type -> Extended EnumTypeDefinition is resolved", () => {
    const schema = typeContainer.getSchemas().get("Zero");
    const entity = schema!.getEntity("EZeroTwo");
    const attributeD = findExplicitAttribute(entity?.getNode()!, "d");
    const resolution = ExpressP11ParameterTypeResolver.resolve(attributeD!, typeContainer.getSchemas());
    expect(resolution.type).toBe(ExpressP11ParameterTypeResolutionType.EnumValue);
    expect((resolution.value as EnumValue[]).length).toBe(4);
  });

  test("Named_type -> Extended SelectTypeDefinition is resolved", () => {
    const schema = typeContainer.getSchemas().get("Zero");
    const entity = schema!.getEntity("EZeroTwo");
    const attributeE = findExplicitAttribute(entity?.getNode()!, "e");
    const resolution = ExpressP11ParameterTypeResolver.resolve(attributeE!, typeContainer.getSchemas());
    expect(resolution.type).toBe(ExpressP11ParameterTypeResolutionType.EntityDefinition);
    expect((resolution.value as EnumValue[]).length).toBe(3);
  });
});

const findExplicitAttribute = (entity: EntityDefinition, attributeName: string): Explicit_attr | undefined => {
  for (const node of streamAllContents(entity)) {
    if (isAttribute_decl(node) && isExplicit_attr(node.$container)) {
      if (node.name === attributeName) return node.$container;
    }
  }
  return;
};
