# dsh-provider-show

[![check](https://github.com/MosCloud/dsh-provider-show/actions/workflows/check.yml/badge.svg)](https://github.com/MosCloud/dsh-provider-show/actions/workflows/check.yml)

在 DSH 输入框右下角的「模型 · 推理强度」前面，补上**当前模型所属的供应商**。
已被其他插件接管的供应商（例如 WorkBuddy）保持原样，不重复显示。

```
未接管（火山方舟）      火山方舟   DeepSeek V4.1 Flash · Default      ← 新增「火山方舟」
已接管（WorkBuddy）                DeepSeek-V4.1-Flash · x0.11 …       ← 本插件不出现
```

## 安装

```bash
dsh plugin --profile <你的-profile> add dsh-provider-show
```

也可以在插件管理页的「添加插件」里填包名或 GitHub 仓库地址。安装后**刷新页面**
（客户端模块是新增的，必须刷新才会加载）。

从源码开发时改用本地目录，改动即时生效：

```bash
dsh plugin --profile <你的-profile> add /path/to/dsh-provider-show
```

卸载通过插件管理页，或从 profile 的插件清单移除。

> npm 12 会留下一个 `0.0.0-stage` 占位版本（339 字节），是其暂存发布机制的产物；
> `latest` 指向真正的发布版本，安装不受影响。

## 配置

写在 profile 的 `cordis.patch.yml` 的插件条目下。**每项都有默认值，但一处配置会替换整个
`config` 对象，所以只写需要改的键，其余自动取默认。**

```yaml
- id: dsh-provider-show
  name: dsh-provider-show
  config:
    enabled: true                    # 总开关，默认 true

    shortNames:                      # 供应商短名，覆盖目录里的显示名
      volcano-api: 火山

    overrides:                       # 强制某个供应商的处置
      some-connector-provider: third-party   # 让位给接管它的插件
      another-provider: mine                 # 即使探测说被接管也显示
      noisy-provider: hide                   # 不显示，但不声称被别人接管

    coreNamespaces:                  # 宿主自有的 settings 命名空间，宿主升级可扩展
      - llm-pi-ai
      - llm-deepseek
      - llm-deepseek-account
```

## 判定规则

「是否已被第三方插件接管」由 Host 半读取 LLM 目录后判定，优先级自上而下：

| 顺序 | 规则 | 结果 |
|---|---|---|
| 1 | `overrides[providerId]` 显式配置 | `third-party` 让位 / `mine` 显示 / `hide` 不显示 |
| 2 | `settingsNs` 不在 `coreNamespaces` 内 | 判定为**已被插件接管**，让位 |
| 3 | 目录里查不到，或目录不可读 | 判定为**未知**，**照常显示**（fail-open） |

`settingsNs` 是「注册该 provider 的 Loader entry id」：

- `llm-pi-ai` —— 你在设置里自建的 API 路由（火山、OpenRouter、任何 OpenAI 兼容服务）
- `llm-deepseek` / `llm-deepseek-account` —— 官方 DeepSeek 两条路由
- 其他任何值 —— 某个插件用**自己的** entry id 注册的，例如 `dsh-connect-workbuddy`

第 3 条选 fail-open 是因为两种错误代价不对等：漏显只是信息不全，而误判会让**所有**供应商都不显示。

**新会话显示什么**：会话还没有任何模型选择时（没切过模型、也没发过消息），`modelSelection`
投影是空的 —— 此时显示的是**部署默认模型所属的供应商**。这个默认值由 Host 从
`agentDefaultModel` 服务读出，与模型座位同源，所以芯片和座位不会各说各话。
发出第一条消息或切一次模型之后，改由该会话自己的选择决定。
默认通道若被第三方插件接管，仍然让位。

## 架构

| 文件 | 职责 |
|---|---|
| `lib/ownership.js` | 归属判定与文案选择，纯函数、零 import，Host/Client 共用 |
| `lib/index.js` | Host 半：读 LLM 目录 → 决策 → 只读路由 `GET /plugins/dsh-provider-show/providers` |
| `lib/client.js` | Client 半：注册 `conversation.input.right`，读 Host 文档并渲染 |

分层原则：**浏览器看不到的运行时事实（`settingsNs`）在 Host 决策，客户端只消费结论**，
规则只有一份实现。设计取舍见 [docs/design.md](docs/design.md)。

## 开发

```bash
npm test        # 单元 + 行为测试（纯 Node，不需要 DSH 运行时）
npm run check   # 语法检查 + 静态校验 + 全部测试
```

`scripts/verify.mjs` 的每项检查都对应一条「否则只会在运行时才暴露」的规则：manifest 完整性、
图标合法性、locale 非占位文案、客户端不 import Harness Client 包、样式只用主题 token 且有宽度上界、
路由是只读 GET 且由 `scope.effect` 持有、归属规则只有一份实现、排版度量与宿主一致且禁止位移补偿。

零外部依赖，所以 CI 没有安装步骤——干净 checkout 直接跑同一套检查（Node 22 / 24）。

## 已知限制

- 芯片会让模型名更早折叠为图标（`max-width: 140px`，宿主按整行宽度判定折叠）。
- `conversation.input.activity` 展开整行时，宿主会隐藏整组 `standardControls`，芯片随之隐藏。
- 供应商显示名默认取目录里的 `displayName`；想更短就配 `shortNames`。
- 判定依赖第三方插件用自有 `settingsNs` 注册 provider；若某插件复用核心命名空间，
  请用 `overrides` 显式标注。
- 只读路由仅接受本页同源请求；它是 `/plugins/` 下的 exact 路由，优先级高于客户端模块的
  `/plugins` 前缀路由，两者不冲突。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/lessons.md](docs/lessons.md) | 开发经验与踩坑记录——插槽生命周期、验证方法论、发布流程。做同类插件前先读 |
| [docs/design.md](docs/design.md) | 架构决策（ADR）、边界约束、验收标准、渲染与排版细节、返工留档 |
| [docs/research.md](docs/research.md) | 技术考据：槽位拓扑、归属判定信号、排版实测数据，均带源码文件与行号 |

## 许可

[MIT](LICENSE)
