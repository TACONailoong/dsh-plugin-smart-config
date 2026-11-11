# dsh-plugin-smart-config

<p align="center">
  <b><a href="./README_EN.md">English</a></b> | <b><a href="./README.md">简体中文</a></b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-plugin-smart-config"><img src="https://img.shields.io/npm/v/dsh-plugin-smart-config.svg?style=flat-square&color=2088FF&logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/dsh-plugin-smart-config"><img src="https://img.shields.io/badge/npm_downloads-tracking-007ec6?style=flat-square&logo=npm" alt="npm downloads" /></a>
  <a href="https://github.com/TACONailoong/dsh-plugin-smart-config/releases"><img src="https://img.shields.io/github/v/release/TACONailoong/dsh-plugin-smart-config?style=flat-square&color=2ea44f&logo=github" alt="GitHub release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/TACONailoong/dsh-plugin-smart-config?style=flat-square&color=informational" alt="license" /></a>
</p>

<p align="center">
  <b>A smart model configuration & capability adaptation plugin for DeepSeek Harness (dsh), reverse-engineered and ported from ZCode.</b>
</p>

---

## 🌟 Key Features

1. **5-Layer Cascading Recommendation Engine**:
   - **L1 Global Fallback** (`modelRules: .*`): Provides safe baseline defaults (e.g. 200,000 token context window, 32,000 max output).
   - **L2 Model Name Regex** (`modelRules`): Accurately identifies model series (GLM-5, DeepSeek, Claude, Kimi, MiniMax, Qwen, etc.) and sets native capacities.
   - **L3 Protocol Rules** (`modelApiRules`): Distinguishes nuanced protocol characteristics across `anthropic-messages`, `openai-chat-completions`, and `openai-responses`.
   - **L4 Site/Proxy Rules** (`providerSiteRules`): Matches `baseUrl` + `apiType` to apply provider-specific configurations (e.g. OpenCode, DashScope, BigModel, Z.ai).
   - **L5 Template & Exact Rules** (`templateModelRules` / `exactModelRules`): Preset configurations for official provider templates.

2. **Field-Level Diff Overlay (Smart Inheritance)**:
   - When Smart Config is enabled: Unmodified fields dynamically inherit the latest recommendations from upstream rules.
   - When a specific parameter is edited: Only that field is marked as an override; all other parameters continue receiving automatic recommendation updates.

3. **Capability Guards & Request Parameter Mapping**:
   - **Tool Calling Guard**: Automatically strips `tools` if the target model does not support tool calling, preventing `400 Bad Request` API errors.
   - **Multimodal Guard**: Verifies image, video, and audio support.
   - **Reasoning Effort Translation**: Translates generic `reasoning_effort` into model-specific request schemas:
     - **DeepSeek**: `{ "thinking": { "type": "enabled" }, "enable_thinking": true, "reasoning_effort": "high" }`
     - **Claude**: `{ "thinking": { "type": "adaptive" }, "output_config": { "effort": "high" } }`
     - **OpenCode / Kimi**: `{ "reasoning_effort": reasoningLevel }`

4. **Offline High Availability + Dynamic Hot-Sync**:
   - Packaged with the ZCode 3.17.2 Revision 43 ruleset (34 provider templates, 83 model rules, 73 protocol rules, 58 site rules).
   - Optional background lease-locked synchronization with remote rule endpoints.

5. **Profile sync for dsh 0.2.2-rc.1**:
   - Fills missing `contextWindow`, `input`, and `reasoningEfforts` on models already listed under the `llm-pi-ai` entry, using field-level `settings.mutate`.
   - Does not write `maxTokens`. A configured value becomes that model's per-request output default.
   - Leaves an omitted or empty `models` list alone, so the installed pi-ai catalog keeps serving.
   - Maps the host protocol `openai-completions` to the rule file's `openai-chat-completions` before matching OpenCode site rules.
   - Uses only the thinking levels 0.2.2 accepts: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. `thinkingFormat` follows the rule's request map: `openai` for `reasoning_effort`, `qwen` for a top-level `enable_thinking`, `zai` for `thinking.type`, `deepseek` when `thinking.type` is combined with `enable_thinking`, and `openrouter` for a nested `reasoning.effort`.
   - Leaves fields that already have a value, including ones you set and ones that came from the catalog.

6. **OpenCode request headers**:
   - Writes `User-Agent: opencode/1.0.0` and `x-opencode-client: opencode` onto that provider's `headers`.
   - Does not patch `globalThis.fetch`. Session headers stay with a session plugin.

---

## 📂 Project Structure

```text
dsh-plugin-smart-config/
├── package.json               # Plugin manifest (keywords: dsh-plugin, cordis)
├── tsconfig.json              # TypeScript compilation config
├── README.md                  # Chinese documentation
├── README_EN.md               # English documentation
├── src/
│   ├── index.ts               # DeepSeek Harness / Cordis entrypoint (apply, Service, Hooks)
│   ├── types.ts               # Complete TypeScript interface definitions
│   ├── engine.ts              # Core 5-layer cascading matching and overlay engine
│   ├── sync.ts                # Remote rule hot-sync manager with local caching
│   ├── adapter.ts             # Programmatic request mapping; does not edit frozen dsh requests
│   ├── profile-sync.ts        # Rule results as dsh 0.2.2 llm-pi-ai field edits
│   └── rules/
│       └── builtin-rules.json # Built-in rule database (ZCode 3.17.2, Revision 43)
└── test/
    ├── test.ts                # Automated test suite
    └── demo.ts                # Interactive CLI demo script
```

---

## 🚀 Quick Start

### 1. Installation via NPM

```bash
# Using npm
npm install dsh-plugin-smart-config

# Using pnpm
pnpm add dsh-plugin-smart-config

# Using yarn
yarn add dsh-plugin-smart-config
```

### 2. Run Tests & Demos (Node.js 22+)

```bash
npm test
npm run demo
npm run demo -- glm-5.3-flash openai-chat-completions https://opencode.ai/zen/go/v1
```

### 3. Install into DeepSeek Harness 0.2.2-rc.1

The package peers `@deepseek-ai/dsh` at `>=0.2.0-rc.2 <0.2.3-0`. The installer includes prereleases, so `0.2.0-rc.2`, `0.2.1-rc.5`, and `0.2.2-rc.1` pass. `0.2.0-rc.1` and `0.2.3` do not.

```bash
dsh plugin --profile web add dsh-plugin-smart-config
```

Link a local checkout with:

```bash
dsh plugin --profile web add "link:/path/to/dsh-plugin-smart-config"
```

The bundle inserts a `smart-config` row. dsh 0.2 freezes agent-loop requests, so the plugin does not edit them. It writes capabilities onto the `llm-pi-ai` provider profile, and the pi-ai adapter reads that profile before sending. A model has to be listed on that provider first. An empty list keeps the installed pi-ai catalog.

### 4. Programmatic API Usage

Use directly in any Node.js / TypeScript application:

```typescript
import { SmartConfigService } from 'dsh-plugin-smart-config';

const service = new SmartConfigService();

// Resolve recommended settings for any model
const result = service.resolve({
  modelId: 'deepseek-chat',
  apiType: 'openai-chat-completions',
});

console.log(result.effectiveConfig);
// Output:
// {
//   properties: {
//     contextWindow: 200000,
//     supportsToolCall: true,
//     inputFormat: { supportsText: true, supportsImage: false, ... }
//   },
//   optionSpecs: {
//     maxOutputTokens: { max: 32000 },
//     reasoningLevel: { ... }
//   }
// }
```

---

## 📜 Resolution Cascade Flow

```text
[Initial: Empty Config Base]
              ↓
[Exact Rule Match: providerId + modelId]
  - manual-provider-model: Disconnects recommendations, uses pure manual config
  - provider-model: Overlays user overrides onto recommendations
              ↓
[Template Rule Match: templateId + modelId]
              ↓
[Model Name Regex Match: modelMatch (case-insensitive)]
              ↓
[API Protocol Match: apiTypeMatch]
              ↓
[Site Base URL Match: baseUrlMatch (trailing slash normalized)]
              ↓
[Final Output: effectiveConfig]
```

---

## 📄 License

MIT
