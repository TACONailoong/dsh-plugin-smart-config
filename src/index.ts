/**
 * DSH (DeepSeek Harness) Plugin: Smart Config (智能配置)
 * Ported from ZCode reverse-engineering.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ModelConfigEngine } from './engine.js';
import { RemoteSynchronizer } from './sync.js';
import { ModelRequestAdapter, type AgentModelRequest } from './adapter.js';
import type { BuiltinRulesData, ResolveQuery, ResolveResult, ModelConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PluginConfig {
  /** Endpoint for remote rules synchronization (e.g. https://api.zcode.ai or custom CDN) */
  endpointOrigin?: string;
  /** Auto sync interval in ms (default: 1 hour) */
  syncIntervalMs?: number;
  /** Enable auto-sync on launch */
  autoSync?: boolean;
  /** Custom rules path to load in addition to builtin rules */
  customRulesPath?: string;
}

export class SmartConfigService {
  public engine: ModelConfigEngine;
  public adapter: ModelRequestAdapter;
  public synchronizer: RemoteSynchronizer;

  constructor(config: PluginConfig = {}) {
    const rules = this.loadInitialRules(config.customRulesPath);
    this.engine = new ModelConfigEngine(rules);
    this.adapter = new ModelRequestAdapter(this.engine);
    this.synchronizer = new RemoteSynchronizer({
      endpointOrigin: config.endpointOrigin,
      refreshIntervalMs: config.syncIntervalMs,
    });

    this.synchronizer.onUpdate((updatedRules) => {
      this.engine.loadRules(updatedRules);
    });

    if (config.autoSync && config.endpointOrigin) {
      this.synchronizer.startPeriodicSync();
    }
  }

  private loadInitialRules(customPath?: string): BuiltinRulesData {
    // 1. Try custom path if provided
    if (customPath && fs.existsSync(customPath)) {
      try {
        return JSON.parse(fs.readFileSync(customPath, 'utf8'));
      } catch (err) {
        console.warn(`[smart-config] Failed to load custom rules from ${customPath}:`, err);
      }
    }

    // 2. Try cache from previous sync
    const cached = this.synchronizer?.loadCached();
    if (cached) return cached;

    // 3. Fallback to bundled builtin rules
    const builtinPath = path.resolve(__dirname, 'rules', 'builtin-rules.json');
    if (fs.existsSync(builtinPath)) {
      try {
        return JSON.parse(fs.readFileSync(builtinPath, 'utf8'));
      } catch (err) {
        console.error(`[smart-config] Failed to load bundled rules:`, err);
      }
    }

    // 4. Default empty fallback
    return {
      schemaVersion: 1,
      revision: 0,
      config: {
        providerConfigRules: { templateRules: [], providerRules: [] },
        modelConfigRules: {
          modelRules: [],
          modelApiRules: [],
          providerSiteRules: [],
          templateModelRules: [],
          builtinProviderModelRules: [],
        },
      },
    };
  }

  /**
   * Resolve model recommendation
   */
  public resolve(query: ResolveQuery): ResolveResult {
    return this.engine.resolve(query);
  }

  /**
   * Intercept and guard model request
   */
  public prepareRequest(
    req: AgentModelRequest,
    options?: {
      providerId?: string;
      apiType?: string;
      baseUrl?: string;
      personalConfig?: ModelConfig;
      useRecommendedConfig?: boolean;
    }
  ) {
    return this.adapter.prepareRequest(req, options);
  }

  public dispose(): void {
    this.synchronizer.stop();
  }
}

/**
 * DeepSeek Harness / Cordis Plugin Specification
 */
export const name = 'dsh-plugin-smart-config';

export function apply(ctx: any, config: PluginConfig = {}) {
  const service = new SmartConfigService(config);

  // Register service in Cordis IoC container
  if (typeof ctx.provide === 'function') {
    ctx.provide('smartConfig', service);
  } else {
    ctx.smartConfig = service;
  }

  // Hook into DSH model execution cycle if event bus is available
  if (typeof ctx.on === 'function') {
    ctx.on('model/before-call', (payload: any) => {
      if (!payload || !payload.request) return;
      const { preparedRequest, warnings } = service.prepareRequest(payload.request, {
        providerId: payload.providerId,
        apiType: payload.apiType,
        baseUrl: payload.baseUrl,
        personalConfig: payload.personalConfig,
        useRecommendedConfig: payload.useRecommendedConfig,
      });

      payload.request = preparedRequest;
      if (warnings.length > 0 && ctx.logger?.warn) {
        warnings.forEach((w) => ctx.logger.warn(`[smart-config] ${w}`));
      }
    });

    ctx.on('dispose', () => {
      service.dispose();
    });
  }

  // Register CLI Command for DSH if command system is available
  if (ctx.command) {
    ctx
      .command('smart-config <modelId:string>', 'Inspect smart configuration for a model')
      .option('api', '-a <apiType:string> API protocol type (e.g. openai-chat-completions, anthropic-messages)')
      .option('url', '-u <baseUrl:string> Provider Base URL')
      .action(({ options }: any, modelId: string) => {
        if (!modelId) return 'Please specify a model ID.';
        const result = service.resolve({
          modelId,
          apiType: options?.api,
          baseUrl: options?.url,
        });

        return (
          `=== Smart Config for [${result.modelId}] ===\n` +
          `- Use Recommended: ${result.useRecommendedConfig}\n` +
          `- Context Window: ${result.effectiveConfig.properties?.contextWindow?.toLocaleString() ?? 'Unknown'}\n` +
          `- Max Output Tokens: ${result.effectiveConfig.optionSpecs?.maxOutputTokens?.max?.toLocaleString() ?? 'Default'}\n` +
          `- Tool Calling: ${result.effectiveConfig.properties?.supportsToolCall ? 'Supported' : 'No'}\n` +
          `- Vision/Image: ${result.effectiveConfig.properties?.inputFormat?.supportsImage ? 'Supported' : 'No'}\n` +
          `- Matched Rules (${result.matchedRules.length}):\n` +
          result.matchedRules.map((r) => `  * ${r}`).join('\n')
        );
      });
  }

  return service;
}

export type * from './types.js';
export * from './engine.js';
export * from './sync.js';
export * from './adapter.js';
