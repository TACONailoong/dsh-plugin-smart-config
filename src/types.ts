/**
 * Type definitions for DSH Plugin Smart Config (ported from ZCode reverse-engineering)
 */

export interface InputFormat {
  supportsText?: boolean;
  supportsImage?: boolean;
  supportsVideo?: boolean;
  supportsAudio?: boolean;
  supportsPdf?: boolean;
}

export interface OutputFormat {
  supportsText?: boolean;
}

export interface ModelProperties {
  contextWindow?: number;
  inputFormat?: InputFormat;
  outputFormat?: OutputFormat;
  supportsToolCall?: boolean;
  supportsJsonSchemaOutput?: boolean;
  supportsNativeWebSearch?: boolean;
  supportsMidConversationSystem?: boolean;
  requiresMfjsToolSchema?: boolean;
}

export interface OptionMaxOutputTokens {
  max?: number;
  map?: string;
}

export interface OptionReasoningLevel {
  values?: string[];
  map?: string;
}

export interface OptionSpecs {
  maxOutputTokens?: OptionMaxOutputTokens;
  reasoningLevel?: OptionReasoningLevel;
}

export interface ModelConfig {
  enabled?: boolean;
  properties?: ModelProperties;
  optionSpecs?: OptionSpecs;
}

export interface ModelRule {
  type?: 'model';
  modelMatch: string;
  config: ModelConfig;
}

export interface ModelApiRule {
  type?: 'model-api';
  modelMatch: string;
  apiTypeMatch: string;
  config: ModelConfig;
}

export interface ProviderSiteRule {
  type?: 'provider-site';
  modelMatch: string;
  baseUrlMatch: string;
  apiTypeMatch?: string;
  config: ModelConfig;
}

export interface TemplateModelRule {
  type?: 'template-model';
  templateId: string;
  modelId: string;
  config: ModelConfig;
}

export interface ExactModelRule {
  type: 'provider-model' | 'manual-provider-model';
  providerId: string;
  modelId: string;
  config: ModelConfig;
}

export type AnyRule =
  | (ModelRule & { type: 'model' })
  | (ModelApiRule & { type: 'model-api' })
  | (ProviderSiteRule & { type: 'provider-site' })
  | (TemplateModelRule & { type: 'template-model' })
  | ExactModelRule;

export interface ProviderTemplate {
  templateId: string;
  templateNameMap: Record<string, string>;
  config: {
    access?: any;
    api?: {
      type: string;
      baseUrl: string;
      headers?: Record<string, string>;
    };
    builtinModelIds?: string[];
    logo?: any;
  };
}

export interface BuiltinRulesData {
  schemaVersion: number;
  revision: number;
  config: {
    providerConfigRules: {
      templateRules: ProviderTemplate[];
      providerRules: any[];
    };
    modelConfigRules: {
      modelRules: ModelRule[];
      modelApiRules: ModelApiRule[];
      providerSiteRules: ProviderSiteRule[];
      templateModelRules: TemplateModelRule[];
      builtinProviderModelRules: Array<{ providerId: string; modelId: string; config: ModelConfig }>;
    };
  };
}

export interface ResolveQuery {
  modelId: string;
  providerId?: string;
  templateId?: string;
  apiType?: string;
  baseUrl?: string;
  /** Personal manual override config */
  personalConfig?: ModelConfig;
  /** If true or undefined, follow recommended config (smart config). If false, manual mode. */
  useRecommendedConfig?: boolean;
}

export interface ResolveResult {
  modelId: string;
  inheritedConfig: ModelConfig;
  effectiveConfig: ModelConfig;
  useRecommendedConfig: boolean;
  matchedRules: string[];
}
