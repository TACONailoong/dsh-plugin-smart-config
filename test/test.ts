/**
 * Test suite for dsh-plugin-smart-config
 */

import assert from 'assert';
import fs from 'fs';
import semver from 'semver';
import { SmartConfigService, apply, planLlmPiAiOps, ruleApiType, wireCompat } from '../dist/index.js';

console.log('--- [1] Initializing SmartConfigService ---');
const service = new SmartConfigService();
const engine = service.engine;
console.log(`Loaded rules revision: ${engine.getRevision()}`);
assert.strictEqual(engine.getRevision(), 43);

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
const providers = {
  opencode: {
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/zen/go/v1',
    models: [{ id: 'glm-5.3-flash', contextWindow: 64000 }],
  },
};
let mutated: { ns: string; ops: any[]; revision: number } | undefined;
const fakeCtx: any = {
  registeredEvents: {} as Record<string, Function>,
  services: {} as Record<string, any>,
  settings: {
    describe() {
      return [{ ns: 'llm-pi-ai', revision: 3, value: { providers } }];
    },
    async mutate(ns: string, ops: any[], revision: number) {
      mutated = { ns, ops, revision };
    },
  },
  provide(name: string, svc: any) {
    this.services[name] = svc;
  },
  on(event: string, handler: Function) {
    this.registeredEvents[event] = handler;
  },
};

const started = apply(fakeCtx);
assert.ok(fakeCtx.services.smartConfig, 'smartConfig service should be registered in Cordis ctx');
assert.equal(fakeCtx.registeredEvents['model/before-call'], undefined);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(mutated?.ns, 'llm-pi-ai');
assert.equal(mutated?.revision, 3);
assert.ok(mutated!.ops.some((op) => op.path.join('.') === 'providers.opencode.headers'));
assert.ok(!mutated!.ops.some((op) => op.path.at(-1) === 'contextWindow'), 'an existing context window stays put');
assert.ok(!mutated!.ops.some((op) => op.path.at(-1) === 'maxTokens'));
fakeCtx.registeredEvents.dispose?.();
started.dispose();

console.log('\n--- [7] Testing dsh 0.2.2-rc.1 profile planning ---');
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  peerDependencies: { '@deepseek-ai/dsh': string };
};
const dshRange = manifest.peerDependencies['@deepseek-ai/dsh'];
assert.strictEqual(dshRange, '>=0.2.0-rc.2 <0.2.3-0');
const accepts = ['0.2.0-rc.2', '0.2.0', '0.2.1-rc.5', '0.2.1', '0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2'];
const rejects = ['0.2.0-rc.1', '0.1.7-rc.2', '0.2.3-alpha.1', '0.2.3'];
for (const version of accepts) {
  assert.strictEqual(semver.satisfies(version, dshRange, { includePrerelease: true }), true, version);
}
for (const version of rejects) {
  assert.strictEqual(semver.satisfies(version, dshRange, { includePrerelease: true }), false, version);
}
assert.strictEqual(wireCompat('{"reasoning_effort": reasoningLevel}')?.thinkingFormat, 'openai');
assert.strictEqual(wireCompat('{"enable_thinking": reasoningLevel == "enabled"}')?.thinkingFormat, 'qwen');
assert.strictEqual(wireCompat('{ "thinking": { "type": "enabled" } }')?.thinkingFormat, 'zai');
assert.strictEqual(wireCompat('{ "thinking": { "type": "enabled" }, "enable_thinking": true }')?.thinkingFormat, 'deepseek');
assert.strictEqual(wireCompat('{ "reasoning": { "effort": reasoningLevel } }')?.thinkingFormat, 'openrouter');
assert.strictEqual(wireCompat('{ "output_config": { "effort": reasoningLevel } }'), undefined);
assert.strictEqual(ruleApiType('openai-completions'), 'openai-chat-completions');
assert.strictEqual(ruleApiType('openai-responses'), 'openai-responses');

const planned = planLlmPiAiOps(service.engine, {
  opencode: {
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/zen/go/v1',
    models: [
      { id: 'glm-5.3-flash', input: ['text'] },
      { id: 'deepseek-v4-flash' },
      'kimi-k3',
    ],
  },
  anthropic: {
    api: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com/v1',
    models: [{ id: 'claude-3-5-sonnet-20241022' }],
  },
  catalog: {
    baseURL: 'https://api.example.com/v1',
  },
});

const paths = planned.map((op) => op.path.join('.'));
console.log(paths.join('\n'));

assert.ok(paths.includes('providers.opencode.headers'));
assert.ok(paths.includes('providers.opencode.models.0.contextWindow'));
assert.ok(paths.includes('providers.opencode.models.0.input'));
assert.ok(paths.includes('providers.opencode.models.0.reasoningEfforts'));
assert.ok(paths.includes('providers.opencode.models.0.compat.thinkingFormat'));
assert.strictEqual(planned.find((op) => op.path.join('.') === 'providers.opencode.models.0.contextWindow')?.value, 1000000);
assert.deepStrictEqual(planned.find((op) => op.path.join('.') === 'providers.opencode.models.0.input')?.value, ['text', 'image']);
assert.deepStrictEqual(planned.find((op) => op.path.join('.') === 'providers.opencode.models.0.reasoningEfforts')?.value, {
  off: null,
  low: 'low',
  high: 'high',
  max: 'max',
});
assert.strictEqual(planned.find((op) => op.path.join('.') === 'providers.opencode.models.0.compat.thinkingFormat')?.value, 'openai');
assert.strictEqual(planned.find((op) => op.path.join('.') === 'providers.opencode.models.1.compat.thinkingFormat')?.value, 'openai');
assert.ok(!paths.some((path) => path.endsWith('maxTokens')));
assert.ok(!paths.some((path) => path.startsWith('providers.anthropic') && path.includes('thinkingFormat')));
assert.ok(!paths.some((path) => path.startsWith('providers.catalog')));

const applied = structuredClone({
  opencode: {
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/zen/go/v1',
    models: [
      { id: 'glm-5.3-flash', input: ['text'] },
      { id: 'deepseek-v4-flash' },
      'kimi-k3',
    ],
  },
}) as any;
for (const op of planned.filter((item) => item.path[1] === 'opencode')) {
  let node = applied;
  for (let i = 0; i < op.path.length - 1; i++) {
    const key = op.path[i] === 'providers' ? undefined : op.path[i];
    if (key === undefined) continue;
    const next = op.path[i + 1];
    if (node[key] == null) node[key] = /^\d+$/.test(next) ? [] : {};
    node = node[key];
  }
  node[op.path.at(-1)!] = op.value;
}
const again = planLlmPiAiOps(service.engine, { opencode: applied.opencode });
assert.deepStrictEqual(again, [], 'a second pass must not rewrite fields that were just filled');

console.log('\n✅ ALL TESTS PASSED SUCCESSFULLY!');
