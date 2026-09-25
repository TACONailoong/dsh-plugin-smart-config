/**
 * Interactive Demo for dsh-plugin-smart-config
 * Usage: node --experimental-strip-types test/demo.ts [modelId] [apiType] [baseUrl]
 */

import { SmartConfigService } from '../dist/index.js';

const service = new SmartConfigService();

const args = process.argv.slice(2);
if (args.length > 0) {
  const modelId = args[0];
  const apiType = args[1] || 'openai-chat-completions';
  const baseUrl = args[2] || undefined;

  console.log(`\n🔍 Resolving smart config for: ${modelId} (API: ${apiType}, URL: ${baseUrl || 'N/A'})`);
  const res = service.resolve({ modelId, apiType, baseUrl });
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

// Preset demonstration
const testModels = [
  { modelId: 'glm-5.3-flash', apiType: 'openai-chat-completions', baseUrl: 'https://opencode.ai/zen/go/v1' },
  { modelId: 'GLM-5.2', apiType: 'anthropic-messages', baseUrl: 'https://api.z.ai/api/anthropic' },
  { modelId: 'claude-3-5-sonnet-20241022', apiType: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1' },
  { modelId: 'deepseek-chat', apiType: 'openai-chat-completions', baseUrl: 'https://api.deepseek.com/v1' },
  { modelId: 'kimi-k3', apiType: 'openai-chat-completions', baseUrl: 'https://opencode.ai/zen/go/v1' },
];

console.log('================================================================');
console.log('🤖 DSH Plugin: Smart Config (智能配置) - Multi-Model Adaptation Demo');
console.log(`📦 Loaded Rule Base Revision: ${service.engine.getRevision()}`);
console.log('================================================================\n');

for (const m of testModels) {
  const res = service.resolve(m);
  const cfg = res.effectiveConfig;
  console.log(`📌 Model: \x1b[36m${m.modelId}\x1b[0m (API: ${m.apiType})`);
  console.log(`   - Context Window : ${cfg.properties?.contextWindow?.toLocaleString() ?? 'Unknown'} tokens`);
  console.log(`   - Max Output     : ${cfg.optionSpecs?.maxOutputTokens?.max?.toLocaleString() ?? 'Default'} tokens`);
  console.log(`   - Tool Calling   : ${cfg.properties?.supportsToolCall ? '✅ Supported' : '❌ No'}`);
  console.log(`   - Vision/Image   : ${cfg.properties?.inputFormat?.supportsImage ? '✅ Supported' : '❌ No'}`);
  console.log(`   - Reasoning Map  : ${cfg.optionSpecs?.reasoningLevel?.map ?? 'None'}`);
  console.log(`   - Matched Steps  : ${res.matchedRules.length} cascading rules applied`);
  console.log('');
}
