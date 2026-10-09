/**
 * Map smart-config rules onto a dsh 0.2.0-rc.2 `llm-pi-ai` profile.
 *
 * Agent-loop requests on `llm/stream` are frozen, so this plugin does not
 * rewrite them. Capabilities land on the provider profile, which the pi-ai
 * adapter reads before it builds a request.
 *
 * `maxTokens` is intentionally left alone: on 0.2.0-rc.2 a configured value
 * becomes that model's per-request output default, not just a capability.
 */

import type { ModelConfigEngine } from './engine.js';

/** Profile entry id of `@deepseek-ai/dsh-llm-pi-ai` in the base bundle. */
export const LLM_PI_AI_ENTRY_ID = 'llm-pi-ai';

/** Thinking levels a 0.2.0-rc.2 profile may declare, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

const REAL_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Generic floor from the `.*` model rule. It is not a model-specific claim. */
const CONTEXT_FLOOR = 200000;

export interface SettingsPathOp {
  op: 'set';
  path: string[];
  value: unknown;
}

export interface WireCompat {
  supportsReasoningEffort?: boolean;
  thinkingFormat?: 'openai' | 'deepseek';
  requiresReasoningContentOnAssistantMessages?: boolean;
}

/**
 * Translate a pi-ai protocol name into the api type stored in the rule file.
 * Rules still say `openai-chat-completions`; dsh 0.2 stores `openai-completions`.
 */
export function ruleApiType(api: string | undefined): string | undefined {
  if (!api) return undefined;
  const value = api.trim().toLowerCase();
  if (value === 'openai-completions' || value === 'openai-chat' || value === 'openai-chat-completions') {
    return 'openai-chat-completions';
  }
  if (value.includes('responses')) return 'openai-responses';
  if (value === 'anthropic' || value === 'anthropic-messages') return 'anthropic-messages';
  return api;
}

/** Compat fields implied by a rule's request-body map. Unknown maps are skipped. */
export function wireCompat(map: string | undefined): WireCompat | undefined {
  if (!map) return undefined;
  const trimmed = map.trim();
  if (trimmed === '' || trimmed === '{}') return undefined;
  if (trimmed.includes('enable_thinking')) {
    return {
      supportsReasoningEffort: true,
      thinkingFormat: 'deepseek',
      requiresReasoningContentOnAssistantMessages: true,
    };
  }
  if (trimmed.includes('reasoning_effort') && !trimmed.includes('output_config') && !trimmed.includes('thinking')) {
    return {
      supportsReasoningEffort: true,
      thinkingFormat: 'openai',
    };
  }
  return undefined;
}

function isOpenCode(providerId: string, provider: { baseURL?: string; baseUrl?: string }): boolean {
  const base = provider.baseURL || provider.baseUrl || '';
  return providerId.includes('opencode') || base.includes('opencode.ai');
}

/**
 * Reasoning levels to offer. Real levels named by a rule win. The generic
 * disabled/enabled pair only fills models that are already known to reason.
 */
export function reasoningEffortsFor(modelId: string, values: readonly string[] | undefined): Record<string, string | null> | undefined {
  const listed = (values ?? []).map((value) => value.toLowerCase());
  const real = listed.filter((value) => REAL_EFFORTS.has(value));
  if (real.length > 0) {
    const efforts: Record<string, string | null> = { off: null };
    for (const level of THINKING_LEVELS) {
      if (level !== 'off' && real.includes(level)) efforts[level] = level;
    }
    return efforts;
  }
  if (!/mimo|glm-5|deepseek|kimi|reasoner|thinking|\br1\b|o1|o3|qwen.*max|doubao/i.test(modelId)) {
    return undefined;
  }
  if (/kimi-k3/i.test(modelId)) return { off: null, max: 'max' };
  return { off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' };
}

function pushMissing(ops: SettingsPathOp[], path: string[], current: unknown, value: unknown): void {
  if (current != null) return;
  ops.push({ op: 'set', path, value });
}

/**
 * Field edits that bring one `llm-pi-ai` providers dict in line with the rules.
 * Existing fields are left as they are. An omitted or empty `models` list stays
 * omitted, so the installed pi-ai catalog keeps serving.
 */
export function planLlmPiAiOps(engine: ModelConfigEngine, providers: Record<string, any> | undefined): SettingsPathOp[] {
  if (!providers || typeof providers !== 'object') return [];
  const ops: SettingsPathOp[] = [];

  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue;
    const baseURL = typeof provider.baseURL === 'string' ? provider.baseURL
      : typeof provider.baseUrl === 'string' ? provider.baseUrl
      : undefined;
    const api = typeof provider.api === 'string' ? provider.api : undefined;
    const assumedApi = ruleApiType(api) ?? (isOpenCode(providerId, provider) ? 'openai-chat-completions' : undefined);
    const completions = assumedApi === 'openai-chat-completions';

    if (isOpenCode(providerId, provider)) {
      const headers = { ...(provider.headers ?? {}) };
      let headerChanged = false;
      if (!headers['User-Agent'] && !headers['user-agent']) {
        headers['User-Agent'] = 'opencode/1.0.0';
        headerChanged = true;
      }
      if (!headers['x-opencode-client']) {
        headers['x-opencode-client'] = 'opencode';
        headerChanged = true;
      }
      if (headerChanged) {
        ops.push({ op: 'set', path: ['providers', providerId, 'headers'], value: headers });
      }
    }

    if (!Array.isArray(provider.models) || provider.models.length === 0) continue;

    provider.models.forEach((entry: unknown, index: number) => {
      const model = typeof entry === 'string' ? { id: entry } : entry;
      if (!model || typeof model !== 'object' || typeof (model as { id?: unknown }).id !== 'string') return;
      const record = model as Record<string, any>;
      const modelId = record.id as string;
      if (!modelId) return;

      const resolved = engine.resolve({
        modelId,
        providerId,
        apiType: assumedApi,
        baseUrl: baseURL,
      });
      const props = resolved.effectiveConfig.properties ?? {};
      const specs = resolved.effectiveConfig.optionSpecs ?? {};
      const efforts = record.reasoningEfforts == null
        ? reasoningEffortsFor(modelId, specs.reasoningLevel?.values)
        : undefined;
      const compatAdd = completions
        ? wireCompat(specs.reasoningLevel?.map) ?? (efforts ? { supportsReasoningEffort: true, thinkingFormat: 'openai' as const } : undefined)
        : undefined;

      const patch: Record<string, unknown> = {};
      // The `.*` rule's 200k floor is not copied. dsh 0.2 already defaults a
      // sizeless model to 262144, and restating the floor would shrink that.
      if (record.contextWindow == null && typeof props.contextWindow === 'number' && props.contextWindow > 0 && props.contextWindow !== CONTEXT_FLOOR) {
        patch.contextWindow = props.contextWindow;
      }
      if (props.inputFormat?.supportsImage === true) {
        const input = Array.isArray(record.input) ? record.input.filter((item: unknown) => item === 'text' || item === 'image') : [];
        if (!input.includes('image')) {
          patch.input = input.includes('text') ? [...input, 'image'] : ['text', ...input, 'image'];
        }
      }
      if (efforts) patch.reasoningEfforts = efforts;

      const basePath = ['providers', providerId, 'models', String(index)];
      if (typeof entry === 'string') {
        const compat = compatAdd ? { ...compatAdd } : undefined;
        if (compat) patch.compat = compat;
        if (Object.keys(patch).length > 0) {
          ops.push({ op: 'set', path: basePath, value: { id: modelId, ...patch } });
        }
        return;
      }

      for (const [key, value] of Object.entries(patch)) {
        if (key === 'input') ops.push({ op: 'set', path: [...basePath, key], value });
        else pushMissing(ops, [...basePath, key], record[key], value);
      }
      if (compatAdd) {
        const current = record.compat && typeof record.compat === 'object' ? record.compat : {};
        for (const [key, value] of Object.entries(compatAdd)) {
          pushMissing(ops, [...basePath, 'compat', key], current[key], value);
        }
      }
    });
  }

  return ops;
}
