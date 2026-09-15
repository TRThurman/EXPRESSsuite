import type { DeepPartial, Module } from "langium";
import type { DefaultSharedModuleContext, LangiumServices, LangiumSharedServices } from "langium/lsp";
import { createDefaultModule, createDefaultSharedModule } from "langium/lsp";
import { inject } from "langium";
import { ExpressP11GeneratedModule, ExpressGeneratedSharedModule } from "./generated/module.js";
import { ExpressP11DocumentBuilder } from "./express-p11-document-builder.js";
import { ExpressP11IndexManager } from "./express-p11-index-manager.js";
import { ExpressP11NodeKindProvider } from "./express-p11-node-kind-provider.js";
import { ExpressDocumentValidator } from "./express-p11-document-validator.js";
import { ExpressP11DocumentSymbolProvider } from "./express-p11-document-symbol-provider.js";
import { ExpressP11CodeActionProvider } from "./express-p11-code-action-provider.js";
import { ExpressP11CompletionProvider } from "./express-p11-completion-provider.js";
import { ExpressP11ScopeComputation } from "./express-p11-scope-computation.js";
import { ExpressP11ScopeProvider } from "./express-p11-scope-provider.js";
import { ExpressP11NameProvider } from "./express-p11-name-provider.js";
import { ExpressP11Validator } from "./express-p11-validator.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ExpressP11Linker } from "./express-p11-linker.js";
import { ExpressP11WorkspaceManager } from "./express-p11-workspace-manager.js";
import { ExpressP11ExecuteComandHandler } from "./express-p11-execute-command-handler.js";
import { ExpressP11ServiceRegistry } from "./express-p11-service-registry.js";
import { ExpressP11AnnotationIndex } from "./express-p11-annotation-index.js";
import { registerValidationChecks } from "./express-p11-validator.js";
import { ExpressP11ConfigurationProvider } from "./express-p11-configuration-provider.js";

/**
 * Declaration of custom services - add your own service classes here.
//  */
export type ExpressP11AddedServices = {
  validation: {
    ExpressP11Validator: ExpressP11Validator;
    TypeContainer: ExpressP11TypeContainer;
  };
  shared: ExpressP11SharedServices;
};

export type ExpressP11AddedSharedServices = {
  workspace: {
    DocumentBuilder: ExpressP11DocumentBuilder;
    IndexManager: ExpressP11IndexManager;
    AnnotationIndex: ExpressP11AnnotationIndex;
  };
  lsp: {
    NodeKindProvider: ExpressP11NodeKindProvider;
  };
  ServiceRegistry: ExpressP11ServiceRegistry;
};

export const ExpressP11SharedModule: Module<ExpressP11SharedServices, DeepPartial<ExpressP11SharedServices>> = {
  workspace: {
    ConfigurationProvider: (services) => new ExpressP11ConfigurationProvider(services),
    DocumentBuilder: (services) => new ExpressP11DocumentBuilder(services),
    IndexManager: (services) => new ExpressP11IndexManager(services),
    WorkspaceManager: (services) => new ExpressP11WorkspaceManager(services),
    AnnotationIndex: (services) => new ExpressP11AnnotationIndex(services),
  },
  lsp: {
    NodeKindProvider: () => new ExpressP11NodeKindProvider(),
    ExecuteCommandHandler: (services) => new ExpressP11ExecuteComandHandler(services),
  },
  ServiceRegistry: () => new ExpressP11ServiceRegistry(),
};
/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 */
export type ExpressP11Services = LangiumServices & ExpressP11AddedServices;
export type ExpressP11SharedServices = LangiumSharedServices & ExpressP11AddedSharedServices;
/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services. The Langium defaults can be partially specified to override only
 * selected services, while the custom services must be fully specified.
 */
export const ExpressP11Module: Module<ExpressP11Services, DeepPartial<ExpressP11Services>> = {
  validation: {
    ExpressP11Validator: (services) => new ExpressP11Validator(services),
    DocumentValidator: (services) => new ExpressDocumentValidator(services),
    TypeContainer: (services) => new ExpressP11TypeContainer(services),
  },
  lsp: {
    DocumentSymbolProvider: (services) => new ExpressP11DocumentSymbolProvider(services),
    CodeActionProvider: () => new ExpressP11CodeActionProvider(),
    CompletionProvider: (services) => new ExpressP11CompletionProvider(services),
  },
  references: {
    ScopeComputation: (services) => new ExpressP11ScopeComputation(services),
    ScopeProvider: (services) => new ExpressP11ScopeProvider(services),
    NameProvider: () => new ExpressP11NameProvider(),
    Linker: (services) => new ExpressP11Linker(services),
  },
};

export interface ExpressP11SharedModuleContext extends DefaultSharedModuleContext {
  module?: Module<ExpressP11Services, DeepPartial<ExpressP11Services>>;
  sharedModule?: Module<ExpressP11SharedServices, DeepPartial<ExpressP11SharedServices>>;
}

/**
 * Create the full set of services required by Langium.
 *
 * First inject the shared services by merging two modules:
 *  - Langium default shared services
 *  - Services generated by langium-cli
 *
 * Then inject the language-specific services by merging three modules:
 *  - Langium default language-specific services
 *  - Services generated by langium-cli
 *  - Services specified in this file
 *
 * @param context Optional module context with the LSP connection
 * @returns An object wrapping the shared services and the language-specific services
 */
export function createExpressP11Services(context: ExpressP11SharedModuleContext): {
  shared: ExpressP11SharedServices;
  ExpressP11: ExpressP11Services;
} {
  const shared = inject(createDefaultSharedModule(context), ExpressGeneratedSharedModule, ExpressP11SharedModule, context.sharedModule);
  const ExpressP11 = inject(createDefaultModule({ shared }), ExpressP11GeneratedModule, ExpressP11Module, context.module);
  shared.ServiceRegistry.register(ExpressP11);
  registerValidationChecks(ExpressP11);
  return { shared, ExpressP11 };
}
