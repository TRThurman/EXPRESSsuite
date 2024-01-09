import { DefaultServiceRegistry } from "langium";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ExpressP11Services } from "./express-module.js";

export class ExpressP11ServiceRegistry extends DefaultServiceRegistry {
  getTypeContainer(): ExpressP11TypeContainer | undefined {
    if (this.singleton !== undefined) {
      return (this.singleton as ExpressP11Services).validation.TypeContainer;
    }
    if (this.map === undefined) {
      return;
    }

    const services = this.map["exp"];
    if (!services) {
      return;
    }
    return (services as ExpressP11Services).validation.TypeContainer;
  }
}
