# dsh-provider-show

[![check](https://github.com/MosCloud/dsh-provider-show/actions/workflows/check.yml/badge.svg)](https://github.com/MosCloud/dsh-provider-show/actions/workflows/check.yml)

在 DSH 输入框右下角的「模型 · 推理强度」前面，补上**当前模型所属的供应商**。

已被其他插件接管的供应商（例如 WorkBuddy）保持原样，不重复显示。

---

## 它解决什么问题

DSH 的模型选择器（composer 模型位）自带两项信息：

| 位置 | 内容 | 由谁渲染 |
|---|---|---|
| 模型名 | `DeepSeek-V4.1-Flash` | 宿主，经 `conversation.input.model.label` slot |
| 推理强度 | `Default` / `High` | 宿主，非 slot |

**缺的是第三项：这是哪个供应商的模型。**

第三方插件接管某个供应商后会自己补上这一项（WorkBuddy 画 `WB CN · 2,987`、倍率、促销角标），
但没有任何插件接管的供应商（例如你在设置里自建的火山方舟路由）就只有「模型 · 推理强度」，
看不出模型来自哪里。

本插件补齐这个缺口，并遵守一条让位规则：

> **供应商已被第三方插件接管 ⇒ 我方完全不渲染；否则 ⇒ 我方显示供应商名。**

## 效果

```
未接管（火山方舟）      火山方舟   DeepSeek V4.1 Flash · Default      ← 我方新增「火山方舟」
已接管（WorkBuddy）                DeepSeek-V4.1-Flash · x0.11 …       ← 我方不出现
```

芯片挂在模型选择器**左侧、同一条 flex 行**上，只显示供应商名：
模型名与推理强度宿主已经画了，重复即噪声。

## 安装

```bash
dsh plugin --profile <你的-profile> add dsh-provider-show
```

也可以在插件管理页的「添加插件」里填 `dsh-provider-show`，或填 GitHub 仓库地址。
安装后**刷新页面**（客户端模块是新增的，必须刷新才会加载）。

从源码开发时可改用本地目录，改动即时生效：

```bash
dsh plugin --profile <你的-profile> add /path/to/dsh-provider-show
```

卸载通过插件管理页，或从 profile 的插件清单移除。

> 首次发布时 npm 12 会留下一个 `0.0.0-stage` 占位版本（339 字节），这是它的暂存发布机制产物，
> `latest` 指向真正的 `0.1.0`，安装不受影响。

## 判定规则

「是否已被第三方插件接管」由 Host 半读取 LLM 目录后判定，优先级从上到下：

| 顺序 | 规则 | 结果 |
|---|---|---|
| 1 | `overrides[providerId]` 显式配置 | `third-party` 让位 / `mine` 显示 / `hide` 不显示 |
| 2 | `settingsNs` 不在 `coreNamespaces` 内 | 判定为**已被插件接管**，让位 |
| 3 | 目录里查不到该 provider，或目录不可读 | 判定为**未知**，**照常显示**（fail-open） |

`settingsNs` 是「注册该 provider 的 Loader entry id」：

- `llm-pi-ai` —— 你在设置里自建的 API 路由（火山、OpenRouter、任何 OpenAI 兼容服务）
- `llm-deepseek` / `llm-deepseek-account` —— 官方 DeepSeek 两条路由
- 其他任何值 —— 某个插件用**自己的** entry id 注册的，例如 `dsh-connect-workbuddy`

### 为什么探测失败时选择「显示」而不是「隐藏」

漏显只是信息不全，与插件没装时一样；
误判为「已接管」会让**所有**供应商都不显示，属于明显回归。
两种错误代价不对等，所以默认显示。

## 配置

写在 profile 的 `cordis.patch.yml`，或插件条目的 `config`。**每一项都有默认值，
但一处配置会替换整个 `config` 对象，所以只写需要改的键即可，其余键自动取默认。**

```yaml
- id: dsh-provider-show
  name: dsh-provider-show
  config:
    # 总开关（默认 true）
    enabled: true

    # 供应商短名，覆盖目录里的显示名
    shortNames:
      volcano-api: 火山

    # 强制某个 provider 的处置
    overrides:
      some-connector-provider: third-party   # 让位给接管它的插件
      another-provider: mine                 # 即使探测说被接管，也照常显示
      noisy-provider: hide                   # 不显示，但不声称它被别人接管

    # 宿主自有的 settings 命名空间；宿主升级新增内置 provider 时可扩展
    coreNamespaces:
      - llm-pi-ai
      - llm-deepseek
      - llm-deepseek-account
```

## 架构

```
lib/ownership.js      纯函数：归属判定 + 文案选择（无任何 import，两侧共用）
lib/index.js          Host 半：读 LLM 目录 → 决策 → GET /plugins/dsh-provider-show/providers
lib/client.js         Client 半：注册 conversation.input.right，读宿主文档并渲染
```

### 三个关键设计取舍

**1. 用 `conversation.input.right`，不用 `conversation.input.model.label`**

`input.model.label` 是 `single` slot：同优先级二次注册会**直接抛错**，
且 workbuddy 已用 `priority: -0.5` 占位、压制了宿主的 1017 徽标。
去抢那一格必然与第三方插件冲突。

`input.right` 是 `list` slot（`replaceRisk: "none"`），用独有 id 叠加，
渲染位置恰好就在模型选择器左边同一条 flex 行（`ui-conversation` 中
`.standardControls` 的子节点顺序即 `input.right` → `input.model`）。

代价：芯片宽度计入 `.trailing`，会让模型名**更早**折叠成图标，
所以芯片有 `max-width: 140px` 与省略号截断，并用 `margin-inline-end:-10px`
抵消宿主的 12px 栅格间距。

**排版对齐：靠"同度量"，不靠位移**（由 `scripts/verify.mjs` 守住）

| 约束 | 原因 |
|---|---|
| `font-size:13px` + `font-weight:400` + `line-height:20px` + `height:28px` + `align-items:center`，且**不声明 `font-family`** | 与模型触发器 `.htuFrW_trigger` 完全同一套度量。行盒内基线位置是 `half-leading + ascent`，**由字号与字体决定、与 `line-height` 无关**；度量相同 ⇒ 基线自动重合，不需要任何对齐技巧。 |
| `margin-inline-end:-10px`、自身 `padding:0` | 宿主 `.standardControls` 有 12px `gap`，模型触发器又有 8px 左内边距；不补偿则两标签相距约 20px，补偿后约 10px，读作一行。 |
| **禁止 `translateY`** | 见下节。任何人再想加中文补偿，`verify.mjs` 会直接判红。 |

### 中文曾经"不居中"的真相（有实测数据）

早期我在 12px 字号下看到中文偏高，推断是"汉字占满 em 框、无下伸部"导致的，于是加了位移补偿。
**这个推断在字号不一致的前提下才成立，字号对齐后就不成立了。**

从 2 倍截图里量每个文字块的墨迹质心（1 CSS px = 2 图像 px）：

| 文字块 | 墨迹行范围 | 质心 |
|---|---|---|
| `火山` | 19..43 | **33.12** |
| `DeepSeek` | 19..42 | 29.80 |
| `Flash` | 19..38 | 28.90 |
| `×0.20` | 19..38 | 28.76 |
| `High` | 19..42 | 30.02 |

拉丁质心均值约 **29.4**。加上 `+2px` 补偿后汉字质心 33.12，比拉丁**低 3.7 图像 px ≈ 1.85 CSS px**；
去掉补偿正好落到 29.1，与拉丁齐平。**所以 13px 下的最优补偿是 0。**

这也解释了为什么纯拉丁标签一直正常：它们的位移恒为 0，从未被补偿影响。

### 为什么层级靠颜色而不是字号

宿主自己就是这么做的：模型名 `label-secondary`、推理强度 `label-caption`，**两者都是 13px**。
供应商作为第三层用 `label-tertiary`、同为 13px，于是整行读作「供应商 · 模型 · 强度」一个视觉单位。

**2. 归属判定只在 Host 侧做一次**

浏览器看不到 `settingsNs`：模型目录的 provider group 只有 `{ id, name, models }`，
`prepareRoutes` 在进入目录前就把适配器元数据裁掉了。
所以规则放在 Host，客户端只做查表 —— 一处实现，不会自我漂移。

**3. Host 半不 import 任何 Harness 包**

本地目录安装会把本仓库链接进 profile，其模块解析走 profile 的 `node_modules`，
而那里**没有**内置 Harness 包。一个 `import Schema from '@deepseek-ai/schemastery'`
就会让整个 Host 半加载失败。
因此配置用纯数据描述（`CONFIG_KEYS` / `effectiveConfig`），不导出 `Config`；
Loader 在没有 `Config` 时原样透传配置，默认值由本插件自己补。

## 开发

```bash
npm test     # 27 项单元 + 行为测试（纯 Node，不需要 DSH 运行时）
npm run check # 语法检查 + 19 项静态校验 + 全部测试
```

`scripts/verify.mjs` 的 19 项检查各自对应一条「否则只会在运行时才暴露」的规则：
manifest 完整性、图标合法性与体积、locale 非占位文案、客户端只通过
`__ModuleLoader__` 注册且不 import Harness Client 包、样式只用主题 token 且有宽度上界、
路由是只读 GET 且在 `ctx.effect` 内注册、归属规则只有一份实现等。

## 已知限制

- 需要 Host 半的只读路由（`GET /plugins/dsh-provider-show/providers`）可用；
  该路由仅接受本页同源请求。该路径是 `/plugins/` 下的 **exact** 路由，
  优先级高于 `/plugins` 前缀路由（webserver 先查 exact 表），因此不与客户端模块路由冲突。
- 芯片会让模型名更早折叠为图标（见上文取舍 1）。
- 当 `conversation.input.activity` 展开整行时，宿主会隐藏整组 `standardControls`，
  芯片随之隐藏 —— 这是宿主行为。
- 供应商显示名默认取目录里的 `displayName`（即你在设置里填的名字）；
  想更短就配 `shortNames`。
- 归属判定的可靠性取决于第三方插件是否用自有 `settingsNs` 注册 provider。
  若某插件复用核心命名空间，请用 `overrides` 显式标注。

## 状态

**已完成：安装 → 运行 → 视觉验收。全部验收项通过。**

| 项 | 结果 |
|---|---|
| 安装 | 进入 profile bundles 与依赖（本地目录 `link:`） |
| Host 行 | `fiberPhase: active` |
| 只读路由 | `GET /plugins/dsh-provider-show/providers` 实测 200，决策正确 |
| 真实判定 | `火山API` → 显示；`workbuddy` / `workbuddy-global` → 让位 |
| 视觉验收 | 供应商与模型/强度齐平、间距合适、纯拉丁与中文均正常 |
| 测试 | 38 项（归属规则、Host 路由行为、Client 渲染） |
| 静态校验 | 23 项，逐条做过反证测试 |
| CI | GitHub Actions 在 Node 22 / 24 上跑同一套检查 |

### 卸载

插件管理页禁用该 bundle，或从 profile 依赖里移除 `dsh-provider-show`。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/design.md](docs/design.md) | 需求确认、架构决策（ADR）、边界约束、验收标准、返工记录 |
| [docs/research.md](docs/research.md) | 技术考据：槽位拓扑、归属判定信号、排版实测数据，均带源码文件与行号 |

## 许可

[MIT](LICENSE)
