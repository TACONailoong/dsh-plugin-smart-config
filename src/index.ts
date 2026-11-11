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
import { LLM_PI_AI_ENTRY_ID, planLlmPiAiOps, reasoningEffortsFor, ruleApiType, wireCompat } from './profile-sync.js';
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
  /** Profile entry that owns pi-ai providers. The base bundle uses `llm-pi-ai`. */
  settingsEntryId?: string;
  /** Directory for a fetched rule snapshot. Defaults under `$DSH_HOME/cache`. */
  cacheDir?: string;
}

export interface AdaptedModelCaps {
  contextWindow: number;
  maxTokens: number;
  input: string[];
  reasoningEfforts?: Record<string, string | null>;
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
  const apiType = ruleApiType(providerMeta?.apiType) ?? providerMeta?.apiType;
  const result = engine.resolve({
    modelId,
    providerId: providerMeta?.providerId,
    apiType,
    baseUrl: providerMeta?.baseUrl,
  });

  const props = result.effectiveConfig.properties || {};
  const opts = result.effectiveConfig.optionSpecs || {};
  const contextWindow = props.contextWindow || 200000;
  const maxTokens = opts.maxOutputTokens?.max || 32000;
  const input = ['text'];
  if (props.inputFormat?.supportsImage) input.push('image');

  const reasoningEfforts = reasoningEffortsFor(modelId, opts.reasoningLevel?.values);
  const compat: Record<string, any> = {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
  };
  const wire = wireCompat(opts.reasoningLevel?.map);
  if (wire) Object.assign(compat, wire);
  else if (!opts.reasoningLevel?.map && reasoningEfforts && (apiType == null || apiType === 'openai-chat-completions')) {
    compat.supportsReasoningEffort = true;
    compat.thinkingFormat = 'openai';
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
    this.synchronizer = new RemoteSynchronizer({
      endpointOrigin: config.endpointOrigin,
      refreshIntervalMs: config.syncIntervalMs,
      cacheDir: config.cacheDir,
    });
    const rules = this.loadInitialRules(config.customRulesPath);
    this.engine = new ModelConfigEngine(rules);
    this.adapter = new ModelRequestAdapter(this.engine);

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

    // 3. Fallback to bundled builtin rules. tsc does not copy JSON, so the
    // build also places a copy in dist/rules, and a source checkout can be
    // read from src/rules when that copy is absent.
    const builtinCandidates = [
      path.resolve(__dirname, 'rules', 'builtin-rules.json'),
      path.resolve(__dirname, '../src/rules/builtin-rules.json'),
    ];
    for (const builtinPath of builtinCandidates) {
      if (!fs.existsSync(builtinPath)) continue;
      try {
        return JSON.parse(fs.readFileSync(builtinPath, 'utf8'));
      } catch (err) {
        console.error(`[smart-config] Failed to load bundled rules from ${builtinPath}:`, err);
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

  const entryId = config.settingsEntryId || LLM_PI_AI_ENTRY_ID;
  let isSyncing = false;
  let lastSignature = '';

  const readEntry = () => {
    const settings = optionalService(ctx, 'settings') ?? ctx.settings;
    if (!settings || typeof settings.describe !== 'function') return undefined;
    const described = settings.describe();
    const list = Array.isArray(described) ? described : [];
    return { settings, entry: list.find((item: any) => item?.ns === entryId) };
  };

  const getSignature = () => {
    try {
      return JSON.stringify(readEntry()?.entry?.value?.providers ?? {});
    } catch {
      return '';
    }
  };

  const syncSettings = async () => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const found = readEntry();
      if (!found?.entry?.value || typeof found.settings.mutate !== 'function') {
        diag('llm-pi-ai settings entry is not ready');
        return;
      }
      const ops = planLlmPiAiOps(service.engine, found.entry.value.providers);
      if (ops.length === 0) {
        diag('Settings sync check finished, changed=false');
        return;
      }
      try {
        await found.settings.mutate(found.entry.ns, ops, found.entry.revision);
        diag(`Applied ${ops.length} llm-pi-ai profile updates.`);
      } catch (mutErr: any) {
        if (mutErr?.code !== 'SETTINGS_CONFLICT') throw mutErr;
        const fresh = readEntry();
        if (!fresh?.entry?.value) return;
        const retryOps = planLlmPiAiOps(service.engine, fresh.entry.value.providers);
        if (retryOps.length === 0) return;
        await fresh.settings.mutate(fresh.entry.ns, retryOps, fresh.entry.revision);
        diag(`Applied ${retryOps.length} llm-pi-ai profile updates after conflict retry.`);
      }
    } catch (err: any) {
      console.warn(`[smart-config] Settings sync warning: ${err?.message ?? String(err)}`);
      diag(`Settings sync warning: ${err?.message ?? String(err)}`);
    } finally {
      isSyncing = false;
    }
  };

  void syncSettings();
  const t1 = setTimeout(() => { void syncSettings(); }, 1500);
  const t2 = setTimeout(() => { void syncSettings(); }, 4000);
  const pollTimer = setInterval(() => {
    try {
      const sig = getSignature();
      if (sig && sig !== lastSignature) {
        lastSignature = sig;
        void syncSettings();
      }
    } catch {
      // Settings can still be absent while the profile is booting.
    }
  }, 2500);
  t1.unref?.();
  t2.unref?.();
  pollTimer.unref?.();

  if (typeof ctx.on === 'function') {
    ctx.on('ready', () => {
      diag('ctx ready event received, running syncSettings');
      void syncSettings();
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
export { LLM_PI_AI_ENTRY_ID, planLlmPiAiOps, reasoningEffortsFor, ruleApiType, wireCompat } from './profile-sync.js';
export type { SettingsPathOp, ThinkingFormat, WireCompat } from './profile-sync.js';
