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

export interface AdaptedModelCaps {
  contextWindow: number;
  maxTokens: number;
  input: string[];
  reasoningEfforts?: Record<string, string>;
  compat: Record<string, any>;
}

/**
 * Smart capability resolver that computes context window, max output tokens,
 * input modalities, reasoning effort levels, and wire compat from smart config rules.
 */
export function resolveModelCapabilities(
  engine: ModelConfigEngine,
  modelId: string,
  providerMeta?: { providerId?: string; apiType?: string; baseUrl?: string }
): AdaptedModelCaps {
  const result = engine.resolve({
    modelId,
    providerId: providerMeta?.providerId,
    apiType: providerMeta?.apiType,
    baseUrl: providerMeta?.baseUrl,
  });

  const props = result.effectiveConfig.properties || {};
  const opts = result.effectiveConfig.optionSpecs || {};

  // 1. Context window
  let contextWindow = props.contextWindow;
  if (!contextWindow || contextWindow === 200000) {
    if (/k3/i.test(modelId)) {
      contextWindow = 1048576;
    } else if (/mimo|glm-5|deepseek|qwen.*max|minimax|flash|pro/i.test(modelId)) {
      contextWindow = 1000000;
    } else {
      contextWindow = 200000;
    }
  }

  // 2. Max output tokens
  let maxTokens = opts.maxOutputTokens?.max;
  if (!maxTokens || maxTokens === 32000) {
    if (/pro|flash|deepseek/i.test(modelId)) {
      maxTokens = 384000;
    } else if (/mimo|k3|m3/i.test(modelId)) {
      maxTokens = 131072;
    } else {
      maxTokens = 65536;
    }
  }

  // 3. Input modalities
  const input: string[] = ['text'];
  if (props.inputFormat?.supportsImage || /flash|vision|k3|m3|plus|max|mimo|vl/i.test(modelId)) {
    input.push('image');
  }

  // 4. Reasoning effort levels
  let reasoningEfforts: Record<string, string> | undefined;
  const isReasoningModel = Boolean(
    /mimo|glm-5|deepseek|kimi|k3|r1|o1|o3|qwen.*max|doubao|reasoner|thinking/i.test(modelId) ||
    (opts.reasoningLevel && Array.isArray(opts.reasoningLevel.values) && opts.reasoningLevel.values.length > 0 && opts.reasoningLevel.values.some((v: string) => v !== 'disabled'))
  );

  if (isReasoningModel) {
    if (/kimi-k3|k3/i.test(modelId)) {
      reasoningEfforts = {
        off: 'none',
        max: 'max',
      };
    } else {
      reasoningEfforts = {
        off: 'none',
        low: 'low',
        medium: 'medium',
        high: 'high',
        max: 'max',
      };
    }
  }

  // 5. Wire compatibility
  const compat: Record<string, any> = {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
  };

  if (isReasoningModel) {
    compat.supportsReasoningEffort = true;
    compat.requiresReasoningContentOnAssistantMessages = true;
    compat.thinkingFormat = 'deepseek';
  }

  return {
    contextWindow,
    maxTokens,
    input,
    reasoningEfforts,
    compat,
  };
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
export const inject = ['settings'];

function optionalService(ctx: any, name: string) {
  try {
    const getter = ctx.get;
    if (typeof getter !== 'function') return undefined;
    return getter.call(ctx, name);
  } catch {
    return undefined;
  }
}

function getDshHome(): string {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  const userProfile = process.env.USERPROFILE || process.env.HOME;
  if (userProfile) return path.join(userProfile, '.dsh');
  return '/data/user/0/com.dsharnessmobile.shell/files/home/.dsh';
}

function diag(message: string) {
  try {
    const home = getDshHome();
    fs.appendFileSync(path.join(home, 'smart-config.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // ignore
  }
}

export function apply(ctx: any, config: PluginConfig = {}) {
  diag('apply() started');
  const service = new SmartConfigService(config);

  // Register service in Cordis IoC container safely
  try {
    if (typeof ctx.provide === 'function') {
      ctx.provide('smartConfig', service);
      diag('registered smartConfig in ctx');
    }
  } catch {}

  // Intercept globalThis.fetch for OpenCode requests
  if (typeof globalThis.fetch === 'function' && !(globalThis.fetch as any).__opencode_header_patched) {
    const originalFetch = globalThis.fetch;
    const defaultSessionId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'dsh-opencode-' + Math.random().toString(36).slice(2, 10);

    const patchedFetch = async function (this: any, input: any, init?: any) {
      let urlStr = '';
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input && typeof input.url === 'string') {
        urlStr = input.url;
      } else if (input && typeof input.href === 'string') {
        urlStr = input.href;
      } else if (input && typeof input.toString === 'function') {
        urlStr = input.toString();
      }

      if (urlStr.includes('opencode.ai')) {
        init = init || {};
        let headers = init.headers;
        if (!headers) {
          headers = {};
          init.headers = headers;
        }

        const setHeaderIfMissing = (key: string, value: string) => {
          if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            if (!headers.has(key)) headers.set(key, value);
          } else if (Array.isArray(headers)) {
            if (!headers.some(([k]) => k.toLowerCase() === key.toLowerCase())) {
              headers.push([key, value]);
            }
          } else if (typeof headers === 'object' && headers !== null) {
            const lowerKey = key.toLowerCase();
            const found = Object.keys(headers).find(k => k.toLowerCase() === lowerKey);
            if (!found) {
              headers[key] = value;
            }
          }
        };

        setHeaderIfMissing('User-Agent', 'opencode/1.0.0');
        setHeaderIfMissing('x-opencode-session', defaultSessionId);
        setHeaderIfMissing('x-opencode-client', 'opencode');
      }

      return originalFetch.call(this, input, init);
    };

    (patchedFetch as any).__opencode_header_patched = true;
    globalThis.fetch = patchedFetch;
  }

  // Active sync function to adapt all provider models in settings
  let isSyncing = false;
  let lastSignature = '';

  const getSignature = () => {
    try {
      const settings = optionalService(ctx, 'settings') ?? ctx.settings;
      if (!settings || typeof settings.describe !== 'function') return '';
      const desc = settings.describe({ namespaces: ['llm-pi-ai'] })?.find((d: any) => d.ns === 'llm-pi-ai');
      return JSON.stringify(desc?.value?.providers ?? {});
    } catch {
      return '';
    }
  };

  const syncSettings = async () => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const settings = optionalService(ctx, 'settings') ?? ctx.settings;
      if (!settings || typeof settings.describe !== 'function') return;

      const desc = settings.describe({ namespaces: ['llm-pi-ai'] })?.find((d: any) => d.ns === 'llm-pi-ai');
      if (!desc || !desc.value) return;

      const rawProviders = desc.value.providers || {};
      const providers = typeof structuredClone === 'function'
        ? structuredClone(rawProviders)
        : JSON.parse(JSON.stringify(rawProviders));
      let changed = false;

      // Default models to auto-inject if provider is empty
      const defaultOpenCodeModels = [
        { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash' },
        { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (Alias)' },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        { id: 'kimi-k3', name: 'Kimi K3' },
        { id: 'qwen3.7-max', name: 'Qwen 3.7 Max' },
        { id: 'minimax-m3', name: 'MiniMax M3' },
      ];

      for (const [providerId, provider] of Object.entries<any>(providers)) {
        if (!provider || typeof provider !== 'object') continue;

        const isOpenCode = providerId.includes('opencode') || (provider.baseURL && provider.baseURL.includes('opencode.ai'));
        if (isOpenCode) {
          if (!provider.headers) {
            provider.headers = {};
            changed = true;
          }
          if (!provider.headers['User-Agent']) {
            provider.headers['User-Agent'] = 'opencode/1.0.0';
            changed = true;
          }
          if (!provider.headers['x-opencode-client']) {
            provider.headers['x-opencode-client'] = 'opencode';
            changed = true;
          }
        }

        if (!Array.isArray(provider.models) || provider.models.length === 0) {
          if (isOpenCode) {
            provider.models = structuredClone(defaultOpenCodeModels);
            changed = true;
          }
        }

        if (Array.isArray(provider.models)) {
          for (let i = 0; i < provider.models.length; i++) {
            let m = provider.models[i];
            if (typeof m === 'string') {
              m = { id: m };
              provider.models[i] = m;
              changed = true;
            }
            if (!m || typeof m !== 'object' || !m.id) continue;

            const caps = resolveModelCapabilities(service.engine, m.id, {
              providerId,
              apiType: provider.api,
              baseUrl: provider.baseURL,
            });

            if (!m.name) {
              m.name = m.id;
              changed = true;
            }
            if (m.contextWindow === undefined || m.contextWindow === 200000 || (caps.contextWindow && caps.contextWindow > m.contextWindow)) {
              if (caps.contextWindow !== m.contextWindow) {
                m.contextWindow = caps.contextWindow;
                changed = true;
              }
            }
            if (m.maxTokens === undefined || m.maxTokens === 32000 || (caps.maxTokens && caps.maxTokens > m.maxTokens)) {
              if (caps.maxTokens !== m.maxTokens) {
                m.maxTokens = caps.maxTokens;
                changed = true;
              }
            }
            if (!Array.isArray(m.input) || m.input.length === 0 || (m.input.length === 1 && caps.input.length > 1)) {
              m.input = caps.input;
              changed = true;
            }
            if ((m.reasoningEfforts === undefined && caps.reasoningEfforts) || (caps.reasoningEfforts && (!m.reasoningEfforts?.max || !m.reasoningEfforts?.low))) {
              m.reasoningEfforts = caps.reasoningEfforts;
              changed = true;
            }
            if (!m.compat) {
              m.compat = caps.compat;
              changed = true;
            } else {
              if (caps.compat.thinkingFormat && !m.compat.thinkingFormat) {
                m.compat.thinkingFormat = caps.compat.thinkingFormat;
                changed = true;
              }
              if (caps.compat.supportsReasoningEffort && m.compat.supportsReasoningEffort === undefined) {
                m.compat.supportsReasoningEffort = true;
                changed = true;
              }
              if (caps.compat.maxTokensField && !m.compat.maxTokensField) {
                m.compat.maxTokensField = caps.compat.maxTokensField;
                changed = true;
              }
            }
          }
        }
      }

      if (changed && typeof settings.mutate === 'function') {
        try {
          await settings.mutate(
            'llm-pi-ai',
            [{ op: 'set', path: ['providers'], value: providers }],
            desc.revision
          );
          console.log('[smart-config] Model capabilities & thinking efforts successfully synced into settings.');
          diag('Model capabilities & thinking efforts successfully synced into settings.');
        } catch (mutErr: any) {
          if (mutErr?.code === 'SETTINGS_CONFLICT') {
            const freshDesc = settings.describe({ namespaces: ['llm-pi-ai'] })?.find((d: any) => d.ns === 'llm-pi-ai');
            if (freshDesc) {
              await settings.mutate(
                'llm-pi-ai',
                [{ op: 'set', path: ['providers'], value: providers }],
                freshDesc.revision
              );
              console.log('[smart-config] Model capabilities & thinking efforts synced after conflict retry.');
              diag('Model capabilities & thinking efforts synced after conflict retry.');
            }
          } else {
            throw mutErr;
          }
        }
      } else {
        diag('Settings sync check finished, changed=' + changed);
      }
    } catch (err: any) {
      console.warn(`[smart-config] Settings sync warning: ${err?.message ?? String(err)}`);
      diag(`Settings sync warning: ${err?.message ?? String(err)}`);
    } finally {
      isSyncing = false;
    }
  };

  // Run sync immediately on startup and after short delays to ensure settings service is ready
  syncSettings();
  const t1 = setTimeout(() => { void syncSettings(); }, 1500);
  const t2 = setTimeout(() => { void syncSettings(); }, 4000);

  // Poll in-memory settings signature every 2.5s (zero I/O) so UI additions take effect immediately
  const pollTimer = setInterval(() => {
    try {
      const sig = getSignature();
      if (sig && sig !== lastSignature) {
        lastSignature = sig;
        void syncSettings();
      }
    } catch {}
  }, 2500);

  // Hook into DSH events if available
  if (typeof ctx.on === 'function') {
    ctx.on('ready', () => {
      diag('ctx ready event received, running syncSettings');
      syncSettings();
    });

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
      if (warnings.length > 0) {
        warnings.forEach((w: string) => console.warn(`[smart-config] ${w}`));
      }
    });

    ctx.on('dispose', () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(pollTimer);
      service.dispose();
    });
  }

  return service;
}

export type * from './types.js';
export * from './engine.js';
export * from './sync.js';
export * from './adapter.js';
