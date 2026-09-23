/**
 * Core cascading recommendation engine ported from ZCode reverse engineering.
 */

import type {
  ModelConfig,
  BuiltinRulesData,
  ResolveQuery,
  ResolveResult,
  AnyRule,
  ExactModelRule,
} from './types.js';

export function normalizeBaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const u = new URL(rawUrl);
    const searchAndHash = `${u.search}${u.hash}`;
    const full = u.toString();
    const withoutSuffix = searchAndHash.length === 0 ? full : full.slice(0, -searchAndHash.length);
    return `${withoutSuffix.replace(/\/+$/, '')}${searchAndHash}`;
  } catch {
    return rawUrl.replace(/\/+$/, '');
  }
}

export function testRegex(pattern: string, target: string, caseInsensitive = true): boolean {
  if (!pattern || !target) return false;
  try {
    const rx = new RegExp(`^(?:${pattern})$`, caseInsensitive ? 'i' : undefined);
    return rx.test(target);
  } catch {
    return false;
  }
}

/**
 * Deep overlay merge: override properties take precedence over base properties.
 * If override is undefined, base is preserved.
 */
export function deepOverlay<T>(base?: T, override?: Partial<T>): T {
  if (base == null && override == null) return {} as T;
  if (base == null) return structuredClone(override as T);
  if (override == null) return structuredClone(base);

  if (typeof base !== 'object' || typeof override !== 'object' || Array.isArray(base) || Array.isArray(override)) {
    return (override !== undefined ? override : base) as T;
  }

  const result: any = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val === undefined) continue;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepOverlay(result[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export class ModelConfigEngine {
  private rules: AnyRule[] = [];
  private exactRules: Map<string, ExactModelRule> = new Map();
  private revision = 0;
  private schemaVersion = 1;

  constructor(initialRules?: BuiltinRulesData) {
    if (initialRules) {
      this.loadRules(initialRules);
    }
  }

  public loadRules(data: BuiltinRulesData): void {
    this.revision = data.revision;
    this.schemaVersion = data.schemaVersion;
    this.rules = [];

    const { modelRules, modelApiRules, providerSiteRules, templateModelRules, builtinProviderModelRules } =
      data.config.modelConfigRules;

    // 1. Model Rules
    if (Array.isArray(modelRules)) {
      for (const r of modelRules) {
        this.rules.push({ ...r, type: 'model' });
      }
    }

    // 2. Model API Rules
    if (Array.isArray(modelApiRules)) {
      for (const r of modelApiRules) {
        this.rules.push({ ...r, type: 'model-api' });
      }
    }

    // 3. Provider Site Rules
    if (Array.isArray(providerSiteRules)) {
      for (const r of providerSiteRules) {
        this.rules.push({ ...r, type: 'provider-site' });
      }
    }

    // 4. Template Model Rules
    if (Array.isArray(templateModelRules)) {
      for (const r of templateModelRules) {
        this.rules.push({ ...r, type: 'template-model' });
      }
    }

    // 5. Builtin Provider Model Rules
    if (Array.isArray(builtinProviderModelRules)) {
      for (const r of builtinProviderModelRules) {
        this.rules.push({
          type: 'provider-model',
          providerId: r.providerId,
          modelId: r.modelId,
          config: r.config,
        });
      }
    }
  }

  public setExactRule(rule: ExactModelRule): void {
    const key = `${rule.providerId}::${rule.modelId}`;
    this.exactRules.set(key, rule);
  }

  public deleteExactRule(providerId: string, modelId: string): void {
    this.exactRules.delete(`${providerId}::${modelId}`);
  }

  public getRevision(): number {
    return this.revision;
  }

  /**
   * Cascading resolution algorithm ported from ZCode's ModelConfigRules.resolve()
   */
  public resolve(query: ResolveQuery): ResolveResult {
    let inherited: ModelConfig = {};
    const matchedRules: string[] = [];
    const normalizedUrl = normalizeBaseUrl(query.baseUrl);

    // Combine loaded rules with dynamic exact rules
    const allRules: AnyRule[] = [...this.rules, ...this.exactRules.values()];

    for (const rule of allRules) {
      // Rule Type: Exact Model (provider-model / manual-provider-model)
      if (rule.type === 'provider-model' || rule.type === 'manual-provider-model') {
        if (rule.providerId !== query.providerId || rule.modelId !== query.modelId) {
          continue;
        }
        if (rule.type === 'manual-provider-model') {
          // Manual mode clears inherited configuration
          inherited = structuredClone(rule.config);
          matchedRules.push(`manual-provider-model:${rule.providerId}/${rule.modelId}`);
        } else {
          inherited = deepOverlay(inherited, rule.config);
          matchedRules.push(`provider-model:${rule.providerId}/${rule.modelId}`);
        }
        continue;
      }

      // Rule Type: Template Model Rule
      if (rule.type === 'template-model') {
        if (rule.templateId === query.templateId && rule.modelId === query.modelId) {
          inherited = deepOverlay(inherited, rule.config);
          matchedRules.push(`template-model:${rule.templateId}/${rule.modelId}`);
        }
        continue;
      }

      if (!('modelMatch' in rule)) {
        continue;
      }

      // Rule Type: Model regex match
      if (!testRegex(rule.modelMatch, query.modelId, true)) {
        continue;
      }

      // If rule is model-api or provider-site, test apiTypeMatch
      if ((rule.type === 'model-api' || rule.type === 'provider-site') && rule.apiTypeMatch) {
        if (!query.apiType || !testRegex(rule.apiTypeMatch, query.apiType, true)) {
          continue;
        }
      }

      // If rule is provider-site, test baseUrlMatch
      if (rule.type === 'provider-site') {
        if (!normalizedUrl || !testRegex(rule.baseUrlMatch, normalizedUrl, true)) {
          continue;
        }
      }

      // Match succeeded: Overlay onto current config
      inherited = deepOverlay(inherited, rule.config);
      matchedRules.push(`${rule.type}:${rule.modelMatch}`);
    }

    const useRecommended = query.useRecommendedConfig !== false;
    let effective: ModelConfig;

    if (query.personalConfig && Object.keys(query.personalConfig).length > 0) {
      if (useRecommended) {
        // Smart config on: Overlay personal manual overrides onto inherited recommendation
        effective = deepOverlay(inherited, query.personalConfig);
      } else {
        // Smart config off: Manual config only
        effective = structuredClone(query.personalConfig);
      }
    } else {
      effective = structuredClone(inherited);
    }

    return {
      modelId: query.modelId,
      inheritedConfig: inherited,
      effectiveConfig: effective,
      useRecommendedConfig: useRecommended,
      matchedRules,
    };
  }

  /**
   * Helper: Map high-level options (e.g. reasoningLevel='high', maxOutputTokens=8192)
   * into actual API payload fields according to the model's optionSpecs.map schema.
   */
  public transformRequestPayload(
    effectiveConfig: ModelConfig,
    options: {
      maxTokens?: number;
      reasoningEffort?: string;
    }
  ): Record<string, any> {
    const payloadExtra: Record<string, any> = {};

    // 1. Map reasoning level
    if (options.reasoningEffort && effectiveConfig.optionSpecs?.reasoningLevel?.map) {
      const mapTemplate = effectiveConfig.optionSpecs.reasoningLevel.map;
      try {
        // Example: {"reasoning_effort": reasoningLevel}
        const evaluated = mapTemplate.replace(/reasoningLevel/g, JSON.stringify(options.reasoningEffort));
        Object.assign(payloadExtra, JSON.parse(evaluated));
      } catch {
        payloadExtra.reasoning_effort = options.reasoningEffort;
      }
    }

    // 2. Map max output tokens
    if (options.maxTokens !== undefined && effectiveConfig.optionSpecs?.maxOutputTokens?.map) {
      const mapTemplate = effectiveConfig.optionSpecs.maxOutputTokens.map;
      try {
        // Example: {"max_tokens": maxOutputTokens}
        const evaluated = mapTemplate.replace(/maxOutputTokens/g, String(options.maxTokens));
        Object.assign(payloadExtra, JSON.parse(evaluated));
      } catch {
        payloadExtra.max_tokens = options.maxTokens;
      }
    }

    return payloadExtra;
  }
}
