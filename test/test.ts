/**
 * Test suite for dsh-plugin-smart-config
 */

import assert from 'assert';
import { SmartConfigService, apply } from '../dist/index.js';

console.log('--- [1] Initializing SmartConfigService ---');
const service = new SmartConfigService();
const engine = service.engine;
console.log(`Loaded rules revision: ${engine.getRevision()}`);
assert(engine.getRevision() > 0, 'Revision should be greater than 0');

console.log('\n--- [2] Testing Model Matching: GLM-5.3-Flash on OpenCode Go ---');
const glmResult = service.resolve({
  modelId: 'glm-5.3-flash',
  apiType: 'openai-chat-completions',
  baseUrl: 'https://opencode.ai/zen/go/v1/',
});

console.log('GLM-5.3-Flash Effective Config:');
console.log(` - Context Window: ${glmResult.effectiveConfig.properties?.contextWindow}`);
console.log(` - Supports Image: ${glmResult.effectiveConfig.properties?.inputFormat?.supportsImage}`);
console.log(` - Supports Video: ${glmResult.effectiveConfig.properties?.inputFormat?.supportsVideo}`);
console.log(` - Reasoning Mapping: ${glmResult.effectiveConfig.optionSpecs?.reasoningLevel?.map}`);
console.log(` - Matched Rules: ${glmResult.matchedRules.join(' -> ')}`);

assert.strictEqual(glmResult.effectiveConfig.properties?.contextWindow, 1000000);
assert.strictEqual(glmResult.effectiveConfig.properties?.inputFormat?.supportsImage, true);
assert.strictEqual(glmResult.effectiveConfig.properties?.inputFormat?.supportsVideo, true);
assert.ok(glmResult.matchedRules.some(r => r.startsWith('provider-site:')));

console.log('\n--- [3] Testing Model Matching: Claude Model on Anthropic API ---');
const claudeResult = service.resolve({
  modelId: 'claude-3-5-sonnet-20241022',
  apiType: 'anthropic-messages',
  baseUrl: 'https://api.anthropic.com/v1',
});

console.log('Claude 3.5 Sonnet Effective Config:');
console.log(` - Context Window: ${claudeResult.effectiveConfig.properties?.contextWindow}`);
console.log(` - Tool Call: ${claudeResult.effectiveConfig.properties?.supportsToolCall}`);
console.log(` - Supports Image: ${claudeResult.effectiveConfig.properties?.inputFormat?.supportsImage}`);

assert.strictEqual(claudeResult.effectiveConfig.properties?.supportsToolCall, true);

console.log('\n--- [4] Testing Field-Level Smart Inheritance & Manual Override ---');
// User manually overrides only contextWindow to 64000
const overrideResult = service.resolve({
  modelId: 'glm-5.3-flash',
  apiType: 'openai-chat-completions',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  useRecommendedConfig: true,
  personalConfig: {
    properties: {
      contextWindow: 64000,
    },
  },
});

console.log('Inheritance with manual override:');
console.log(` - Overridden contextWindow: ${overrideResult.effectiveConfig.properties?.contextWindow}`);
console.log(` - Retained inherited supportsImage: ${overrideResult.effectiveConfig.properties?.inputFormat?.supportsImage}`);
assert.strictEqual(overrideResult.effectiveConfig.properties?.contextWindow, 64000);
assert.strictEqual(overrideResult.effectiveConfig.properties?.inputFormat?.supportsImage, true);

console.log('\n--- [5] Testing Request Transformation & Guard ---');
const rawRequest = {
  model: 'glm-5.3-flash',
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [{ type: 'function', function: { name: 'calc' } }],
  max_tokens: 4096,
  reasoning_effort: 'high',
};

const adapted = service.prepareRequest(rawRequest, {
  apiType: 'openai-chat-completions',
  baseUrl: 'https://opencode.ai/zen/go/v1',
});

console.log('Adapted Request Payload:');
console.log(JSON.stringify(adapted.preparedRequest, null, 2));
assert.strictEqual(adapted.preparedRequest.reasoning_effort, 'high');
assert.strictEqual(adapted.preparedRequest.max_tokens, 4096);

console.log('\n--- [6] Testing DeepSeek Harness Cordis Plugin apply() Lifecycle ---');
const fakeCtx: any = {
  registeredEvents: {} as Record<string, Function>,
  services: {} as Record<string, any>,
  provide(name: string, svc: any) {
    this.services[name] = svc;
  },
  on(event: string, handler: Function) {
    this.registeredEvents[event] = handler;
  },
};

apply(fakeCtx);
assert.ok(fakeCtx.services.smartConfig, 'smartConfig service should be registered in Cordis ctx');
assert.ok(fakeCtx.registeredEvents['model/before-call'], 'model/before-call hook should be registered');

// Test triggering hook
const hookPayload = {
  request: {
    model: 'glm-5.3-flash',
    messages: [{ role: 'user', content: 'test' }],
    reasoning_effort: 'high',
  },
  apiType: 'openai-chat-completions',
  baseUrl: 'https://opencode.ai/zen/go/v1',
};
fakeCtx.registeredEvents['model/before-call'](hookPayload);
console.log('Hook executed successfully, payload transformed:');
console.log(JSON.stringify(hookPayload.request, null, 2));

console.log('\n✅ ALL TESTS PASSED SUCCESSFULLY!');
