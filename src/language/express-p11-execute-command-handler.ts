import { interruptAndCheck } from "langium";
import { AbstractExecuteCommandHandler, ExecuteCommandAcceptor } from "langium/lsp";
import { ExpressP11SharedServices } from "./express-module.js";
import { ExpressP11DocumentBuilder } from "./express-p11-document-builder.js";
import { CancellationToken } from "vscode-languageserver";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ExpressP11ServiceRegistry } from "./express-p11-service-registry.js";
import { EXPRESSSUITE_COMMANDS } from "../shared/commands.js";

export class ExpressP11ExecuteComandHandler extends AbstractExecuteCommandHandler {
  protected readonly documentBuilder: ExpressP11DocumentBuilder;
  protected readonly typeContainer: ExpressP11TypeContainer | undefined;
  protected readonly registry: ExpressP11ServiceRegistry;
  constructor(services: ExpressP11SharedServices) {
    super();
    this.documentBuilder = services.workspace.DocumentBuilder;
    this.registry = services.ServiceRegistry;
    this.typeContainer = services.ServiceRegistry.getTypeContainer();
  }
  override registerCommands(acceptor: ExecuteCommandAcceptor): void {
    acceptor(EXPRESSSUITE_COMMANDS.buildWorkspace, async (_, token) => {
      await this.buildWorkspace(token);
    });

    acceptor(EXPRESSSUITE_COMMANDS.buildGraph, async (_, token) => {
      await this.buildGraph(token);
    });
  }
  private async buildGraph(cancelToken: CancellationToken = CancellationToken.None) {
    if (!this.typeContainer) return;
    const allGraphs = this.typeContainer?.getAllGraphs();
    console.log(`digraph EXPRESS {`);
    for (const graphId of allGraphs.keys()) {
      await interruptAndCheck(cancelToken);
      console.log(`subgraph cluster_${graphId.replaceAll("-", "_")}{`);
      console.log(`label="${allGraphs.get(graphId)!.values().count()}"`);
      for (const entity of allGraphs.get(graphId)!.values()) {
        const expressEntity = this.typeContainer.getExpressP11EntityFrom(entity);
        if (!expressEntity) continue;
        console.log(
          `"${expressEntity.getQualifiedName()}" ${
            expressEntity.subtypes.length > 0 && expressEntity.supertypes.length === 0 ? "[style=filled]" : ""
          };`
        );
        for (const supertype of expressEntity.supertypes) {
          console.log(` "${expressEntity.getQualifiedName()}" -> "${supertype.getQualifiedName()}";`);
        }
      }
      console.log(`}`);
    }
    console.log(`}`);
  }

  private async buildWorkspace(cancelToken: CancellationToken = CancellationToken.None): Promise<void> {
    await this.documentBuilder.runFullBuild(cancelToken);
  }
}
