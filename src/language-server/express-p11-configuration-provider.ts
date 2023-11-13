import { DefaultConfigurationProvider, LangiumSharedServices, WorkspaceManager } from "langium";
import { DidChangeConfigurationParams } from "vscode-languageserver";

export class ExpressP11ConfigurationProvider extends DefaultConfigurationProvider {
  private workspaceManager: WorkspaceManager | undefined;

  constructor(services: LangiumSharedServices) {
    super(services);
    this.workspaceManager = services.workspace.WorkspaceManager;
  }
  override updateConfiguration(change: DidChangeConfigurationParams): void {
    let reloadWorkspaceManager = false;
    if (!change.settings) {
      return;
    }
    Object.keys(change.settings).forEach((section) => {
      if (section === "") reloadWorkspaceManager = true;
      this.updateSectionConfiguration(section, change.settings[section]);
    });
  }
}
