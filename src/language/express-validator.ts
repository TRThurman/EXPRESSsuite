import type { ValidationAcceptor, ValidationChecks } from "langium";
import type { ExpressAstType } from "./generated/ast.js";
import type { ExpressP11Services } from "./express-module.js";

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ExpressP11Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.ExpressP11Validator;
  const checks: ValidationChecks<ExpressAstType> = {};
  registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class ExpressValidator {}
