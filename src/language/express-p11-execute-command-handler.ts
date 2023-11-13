import { AbstractExecuteCommandHandler, ExecuteCommandAcceptor } from "langium";
import { ExpressP11SharedServices } from "./express-module.js";
import { ExpressP11DocumentBuilder } from "./express-p11-document-builder.js";
import { CancellationToken } from "vscode-languageserver";

export class ExpressP11ExecuteComandHandler extends AbstractExecuteCommandHandler {
  protected readonly documentBuilder: ExpressP11DocumentBuilder;
  constructor(services: ExpressP11SharedServices) {
    super();
    this.documentBuilder = services.workspace.DocumentBuilder;
  }
  override registerCommands(acceptor: ExecuteCommandAcceptor): void {
    acceptor("express.buildWorkspace", async (_, token) => {
      await this.buildWorkspace(token);
    });
  }

  private async buildWorkspace(cancelToken: CancellationToken = CancellationToken.None): Promise<void> {
    await this.documentBuilder.runFullBuild(cancelToken);
  }
}
