import { DefaultServiceRegistry } from "langium";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ExpressP11Services } from "./express-module.js";

export class ExpressP11ServiceRegistry extends DefaultServiceRegistry {
  getTypeContainer(): ExpressP11TypeContainer | undefined {
    const services = this.fileExtensionMap.get("exp");
    if (!services) {
      // Fall back: try to find any registered service
      for (const svc of this.all) {
        if ((svc as ExpressP11Services).validation?.TypeContainer) {
          return (svc as ExpressP11Services).validation.TypeContainer;
        }
      }
      return;
    }
    return (services as ExpressP11Services).validation.TypeContainer;
  }
}
