import { DefaultConfigurationProvider } from "langium";
import { EXPRESSSUITE_CONFIGURATION_SECTION } from "../shared/commands.js";

/** Keep the EXPRESS language id while reading EXPRESSsuite's independent settings. */
export class ExpressP11ConfigurationProvider extends DefaultConfigurationProvider {
  protected override toSectionName(_languageId: string): string {
    return EXPRESSSUITE_CONFIGURATION_SECTION;
  }
}
