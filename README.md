# dsh-plugin-smart-config (DeepSeek Harness 智能配置插件)

<p align="center">
  <b><a href="./README_EN.md">English</a></b> | <b><a href="./README.md">简体中文</a></b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-plugin-smart-config"><img src="https://img.shields.io/npm/v/dsh-plugin-smart-config.svg?style=flat-square&color=2088FF&logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/dsh-plugin-smart-config"><img src="https://img.shields.io/badge/npm_downloads-tracking-007ec6?style=flat-square&logo=npm" alt="npm downloads" /></a>
  <a href="https://github.com/TACONailoong/dsh-plugin-smart-config/releases"><img src="https://img.shields.io/github/v/release/TACONailoong/dsh-plugin-smart-config?style=flat-square&color=2ea44f&logo=github" alt="GitHub release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/TACONailoong/dsh-plugin-smart-config?style=flat-square&color=informational" alt="license" /></a>
</p>

本项目逆向并移植了 **ZCode** 的大模型“智能配置”（Follow Recommended Config / 推荐配置引擎），将其封装为适用于 **DeepSeek Harness (`dsh`)** 的标准 Cordis 插件。

---

## 🌟 核心功能

1. **五层级联推荐匹配引擎**：
   - **L1 全局兜底规则** (`modelRules: .*`)：提供安全的缺省上限与上下文底座。
   - **L2 模型名正则规则** (`modelRules`)：精确匹配模型族（如 GLM-5 系列、DeepSeek、Claude、Kimi 等）的原生参数。
   - **L3 API 协议特化规则** (`modelApiRules`)：区分 `anthropic-messages`、`openai-chat-completions`、`openai-responses` 间的特性支持差异。
   - **L4 站点/代理特化规则** (`providerSiteRules`)：根据 `baseUrl` 与 `apiType` 识别特定供应商或中转站（如 OpenCode、阿里云百炼、智谱等）的个性化映射。
   - **L5 模板/供应商直配** (`templateModelRules` / `exactModelRules`)：官方供应商模板专属配置。

2. **字段级智能差分继承 (Field-level Overlay)**：
   - 开启智能配置时：用户未修改的字段自动跟随云端/官方推荐规则实时迭代；
   - 用户手动调整某项参数时，仅该项被固化为覆写，不影响其余参数的动态继承。

3. **模型能力守卫与请求自适应映射 (Request Adapter & Guard)**：
   - **工具调用守卫**：若模型不支持 Tool Calling，自动拦截并剔除 `tools` 参数，防止 400 报错。
   - **多模态/识图守卫**：校验模型是否支持图像/视频/PDF，给出能力提示。
   - **深度思考与推理参数转译**：根据模型规格，自动将通用的 `reasoning_effort` 映射为对应的请求体结构（如 Claude 的 `thinking.type` + `output_config.effort`、DeepSeek 的 `enable_thinking`、OpenAI 的 `reasoning_effort` 等）。

4. **离线高可用 + 云端热更新同步 (Remote Synchronizer)**：
   - 内置 ZCode 3.17.2 的 Revision 43 本地离线规则库（34 个供应商模板、83 条模型规则、73 条协议规则、58 条站点规则）；
   - 支持后台轮询服务端配置接口，通过租约机制无感拉取最新规则。

5. **按 dsh 0.2.2-rc.1 写回模型档案**：
   - 只补 `llm-pi-ai` 里已经列出的模型，用字段级 `settings.mutate` 填上还没有的 `contextWindow`、`input` 和 `reasoningEfforts`。
   - 不写 `maxTokens`。写上之后，这个字段会变成该模型每次请求的默认输出上限。
   - `models` 省略或为空时保持不动，继续用安装包里的 pi-ai 模型目录，不再塞入一份写死的模型列表。
   - 宿主上的 `openai-completions` 会先映射成规则库里的 `openai-chat-completions`，OpenCode 站点规则才能对上。
   - 思考档位只用 0.2.2 接受的 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。`thinkingFormat` 跟着规则的请求映射走：`reasoning_effort` 写成 `openai`，顶层 `enable_thinking` 写成 `qwen`，`thinking.type` 写成 `zai`，`thinking.type` 加 `enable_thinking` 写成 `deepseek`，嵌套的 `reasoning.effort` 写成 `openrouter`。
   - 已经有值的字段保持原样，包括你改过的和目录里自带的。

6. **OpenCode 请求头**：
   - 写在对应 provider 的 `headers` 上：`User-Agent: opencode/1.0.0`、`x-opencode-client: opencode`。
   - 不再改 `globalThis.fetch`。会话头留给专门的会话插件。

---

## 📂 目录结构

```text
dsh-plugin-smart-config/
├── package.json               # 插件清单 (keywords: dsh-plugin, cordis)
├── tsconfig.json              # TypeScript 编译配置
├── README.md                  # 说明文档
├── src/
│   ├── index.ts               # DeepSeek Harness / Cordis 插件入口 (apply, Service, Hooks)
│   ├── types.ts               # 核心类型声明 (ModelConfig, Rule, OptionSpecs 等)
│   ├── engine.ts              # 逆向提取的核心 5 层级联算法与 Overlay 合并器
│   ├── sync.ts                # 远端规则热更新同步器 (带本地缓存与并发控制)
│   ├── adapter.ts             # 编程式请求参数转译（不改 dsh 运行中的冻结请求）
│   ├── profile-sync.ts        # 把规则映射成 dsh 0.2.2 的 llm-pi-ai 字段补丁
│   └── rules/
│       └── builtin-rules.json # 出厂内置规则库 (ZCode 3.17.2, Revision 43)
└── test/
    ├── test.ts                # 完整自动化测试套件
    └── demo.ts                # 交互式命令行验证脚本
```

---

## 🚀 快速上手

### 1. 从 NPM 安装

```bash
# 使用 npm
npm install dsh-plugin-smart-config

# 使用 pnpm
pnpm add dsh-plugin-smart-config

# 使用 yarn
yarn add dsh-plugin-smart-config
```

### 2. 运行测试与演示 (Node.js 22+)

```bash
npm test
npm run demo
npm run demo -- glm-5.3-flash openai-chat-completions https://opencode.ai/zen/go/v1
```

### 3. 装进 DeepSeek Harness 0.2.2-rc.1

插件声明 `peerDependencies["@deepseek-ai/dsh"] = ">=0.2.0-rc.2 <0.2.3-0"`。安装检查打开了 prerelease，所以 `0.2.0-rc.2`、`0.2.1-rc.5` 和 `0.2.2-rc.1` 都能通过，`0.2.0-rc.1` 和 `0.2.3` 不会。

```bash
dsh plugin --profile web add dsh-plugin-smart-config
```

本地目录用 link：

```bash
dsh plugin --profile web add "link:D:/path/to/dsh-plugin-smart-config"
```

装好后它作为 bundle 挂上 `cordis.patch.yml` 里的 `smart-config`。dsh 0.2 的 Agent 请求是冻结的，插件不改请求体；它把能力写进 `llm-pi-ai` 的 provider 档案，由 pi-ai 适配器在发请求前读取。模型需要先出现在该 provider 的 `models` 列表里。列表空着时，用的是 pi-ai 自带目录。

### 4. 编程式 API 调用

也可以在任意 Node/TS 项目中作为独立服务使用：

```typescript
import { SmartConfigService } from 'dsh-plugin-smart-config';

const service = new SmartConfigService();

// 解析指定模型的推荐配置
const result = service.resolve({
  modelId: 'deepseek-chat',
  apiType: 'openai-chat-completions',
});

console.log(result.effectiveConfig);
// 输出：
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

## 📜 规则层级匹配逻辑说明

本插件完整保留了 ZCode 的 `ModelConfigRules.resolve` 匹配流：

```text
[初始状态: 空配置]
       ↓
[Exact 规则匹配: providerId + modelId]
  - 若为 manual-provider-model: 仅采用手动配置，断开推荐
  - 若为 provider-model: 继承推荐并叠加个人覆写
       ↓
[Template 规则匹配: templateId + modelId]
       ↓
[Model 正则规则: modelMatch (忽略大小写)]
       ↓
[Protocol 规则匹配: apiTypeMatch]
       ↓
[Site 规则匹配: baseUrlMatch (标准化去除末尾斜杠)]
       ↓
[生成最终生效配置 effectiveConfig]
```

## 📄 License
MIT
