// v5 砍掉 pi:本地类型桩(原 ThinkingLevel / SettingsManager)
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
export interface SettingsManager {
  getDefaultThinkingLevel(): ThinkingLevel | undefined
  setDefaultThinkingLevel(level: ThinkingLevel | undefined): void
}

export interface ExplicitStartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface EffectiveStartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel: ThinkingLevel;
  supportsThinking: boolean;
}

/**
 * Persist explicit browser selections without re-running AgentSession setters.
 *
 * The session constructor already records the effective model and thinking
 * level. Calling setModel()/setThinkingLevel() again would append duplicate
 * session entries and emit duplicate extension events.
 */
export async function persistExplicitStartupPreferences(
  settingsManager: SettingsManager,
  explicit: ExplicitStartupPreferences,
  effective: EffectiveStartupPreferences,
): Promise<{ modelDefaultChanged: boolean }> {
  if (!explicit.model && !explicit.thinkingLevel) {
    return { modelDefaultChanged: false };
  }

  let modelDefaultChanged = false;

  if (
    explicit.model
    && effective.model
    && explicit.model.provider === effective.model.provider
    && explicit.model.modelId === effective.model.modelId
  ) {
    settingsManager.setDefaultModelAndProvider(
      effective.model.provider,
      effective.model.modelId,
    );
    modelDefaultChanged = true;
  }

  if (
    explicit.thinkingLevel
    && (effective.supportsThinking || effective.thinkingLevel !== "off")
  ) {
    settingsManager.setDefaultThinkingLevel(effective.thinkingLevel);
  }

  await settingsManager.flush();
  return { modelDefaultChanged };
}
