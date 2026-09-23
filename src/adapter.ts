/**
 * Adapter for integrating Smart Config with DeepSeek Harness Agent & Model Runner.
 */

import { ModelConfigEngine } from './engine.ts';
import type { ModelConfig, ResolveQuery, ResolveResult } from './types.ts';

export interface AgentModelRequest {
  model: string;
  messages: Array<{ role: string; content: any }>;
  tools?: any[];
  max_tokens?: number;
  reasoning_effort?: string;
  [key: string]: any;
}

export class ModelRequestAdapter {
  private engine: ModelConfigEngine;

  constructor(engine: ModelConfigEngine) {
    this.engine = engine;
  }

  /**
   * Pre-process an LLM request according to smart configuration rules:
   * 1. Resolves model configuration (context window, tool calling support, token limits)
   * 2. Checks capability guards (e.g. tool calling, vision input)
   * 3. Maps and injects reasoning parameters and token limits
   */
  public prepareRequest(
    req: AgentModelRequest,
    options: {
      providerId?: string;
      apiType?: string;
      baseUrl?: string;
      personalConfig?: ModelConfig;
      useRecommendedConfig?: boolean;
    } = {}
  ): {
    preparedRequest: AgentModelRequest;
    resolution: ResolveResult;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const resolution = this.engine.resolve({
      modelId: req.model,
      providerId: options.providerId,
      apiType: options.apiType || 'openai-chat-completions',
      baseUrl: options.baseUrl,
      personalConfig: options.personalConfig,
      useRecommendedConfig: options.useRecommendedConfig,
    });

    const config = resolution.effectiveConfig;
    const prepared: AgentModelRequest = { ...req };

    // 1. Tool Call Capability Guard
    if (prepared.tools && prepared.tools.length > 0) {
      if (config.properties?.supportsToolCall === false) {
        warnings.push(`Model '${req.model}' does not support tool calling; tools were stripped to prevent API error.`);
        delete prepared.tools;
      }
    }

    // 2. Vision / Multimodal Capability Guard
    if (config.properties?.inputFormat?.supportsImage === false) {
      let hasImage = false;
      for (const msg of prepared.messages) {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && (part.type === 'image_url' || part.type === 'image')) {
              hasImage = true;
              break;
            }
          }
        }
      }
      if (hasImage) {
        warnings.push(`Model '${req.model}' does not support image input according to smart config.`);
      }
    }

    // 3. Transform reasoning and max output tokens according to optionSpecs.map
    const transformedParams = this.engine.transformRequestPayload(config, {
      maxTokens: req.max_tokens,
      reasoningEffort: req.reasoning_effort,
    });

    // Merge transformed fields into request
    Object.assign(prepared, transformedParams);

    // 4. Default maxOutputTokens clamp if not explicitly provided
    if (prepared.max_tokens === undefined && config.optionSpecs?.maxOutputTokens?.max) {
      // Don't arbitrarily force if model supports large output, but record recommended max
      // If user desires default limit, set it
    }

    return {
      preparedRequest: prepared,
      resolution,
      warnings,
    };
  }
}
