import { DefaultConfigurationProvider, Emitter } from "langium";
import type { Event } from "langium";
import { EXPRESSSUITE_CONFIGURATION_SECTION } from "../shared/commands.js";

/** Keep the EXPRESS language id while reading EXPRESSsuite's independent settings. */
export class ExpressP11ConfigurationProvider extends DefaultConfigurationProvider {
  /**
   * A setting already received, read without waiting for the client: nested keys follow the section's object
   * (`expresssuite.annotations.publicationHazards` is `settings.expresssuite.annotations.publicationHazards`).
   * `undefined` when the client has sent no value yet; callers use the setting's default then.
   */
  getReceivedSetting(...path: string[]): unknown {
    let value: unknown = this.settings[EXPRESSSUITE_CONFIGURATION_SECTION];
    for (const key of path) {
      if (typeof value !== "object" || value === null) return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }

  private readonly validationSettingChanged = new Emitter<void>();

  /** Fires when a setting that validation reads has changed, so that what was validated before is out of date. */
  get onValidationSettingChange(): Event<void> {
    return this.validationSettingChanged.event;
  }

  /** The settings that validation reads, as one comparable value. */
  private validationSettings(): string {
    return JSON.stringify([this.getReceivedSetting("annotations", "publicationHazards") !== false]);
  }

  override updateSectionConfiguration(section: string, configuration: unknown): void {
    const before = this.validationSettings();
    super.updateSectionConfiguration(section, configuration);
    if (this.validationSettings() !== before) this.validationSettingChanged.fire();
  }

  protected override toSectionName(_languageId: string): string {
    return EXPRESSSUITE_CONFIGURATION_SECTION;
  }
}
