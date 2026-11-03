# dsh-provider-show — 需求澄清与设计确认

> 本文是**开工前**的确认清单。请你逐项确认或提出修改；确认后再进入实施。
> 事实依据见 [findings.md](findings.md)（含文件行号）。

---

## 〇、我对你需求的理解（请先纠正偏差）

你说：dsh 对话框右下角现在是

- **图1（火山 API / pi-ai 用户路由）**：`DeepSeek V4.1 Flash · x0.20 Default`
  → 模型名 + 倍率 + 推理强度，**缺供应商**
- **图2（WorkBuddy，已被插件接管）**：`WB CN · 2,987   DeepSeek-V4.1-Flash · x0.11  夜间折扣  👤High`
  → **有**供应商（`WB CN`）+ 积分 + 模型 + 倍率 + 促销 + 推理强度

你的诉求是：**所有供应商都达到图2 的信息完备度**，规则为

> 若第三方插件接管了该供应商 ⇒ 以第三方为准（我们只管第三方没管的部分）；
> 若无人接管 ⇒ 由我们补齐「供应商 + 模型 + 推理强度」三要素。

我把它翻译成一条可执行的判定：

```
选中项 = (providerId, modelId, effortId)
├─ providerId 被第三方插件接管？ ── 是 → 我方不输出供应商段，把该供应商让给第三方
└────────────────────────────── 否 → 我方输出：供应商名 · 模型名 · 推理强度
```

**三个需要你确认的语义细节：**

1. **「以三方插件为准」是"整段让出"还是"仅让出供应商段"？**
   我的理解是**整段让出**：workbuddy 那行已经画了 `WB CN` + 积分 + 模型 + 倍率 + 促销，
   我们再插一个 `WorkBuddy` 会重复。
2. **第三方的判定粒度是 provider 还是 (provider, model)？**
   我按 **provider** 判定（一个供应商被接管就整组让出）。
3. **「无人接管」时，模型名会不会重复？**
   不会。模型名与推理强度由宿主渲染（`triggerLabel` + `triggerEffort`），
   我们从 `input.right` 叠加，**只补供应商**；当第三方接管、模型名由第三方重写（如 workbuddy 自己画 chip）时，
   我方整段不出现。所以你看到的效果是「供应商后缀 + 宿主原有的模型·强度」。

---

## 一、目标（Objective）

在当前仓库（`dsh-provider-show`）内，产出**一个可安装的 DSH 插件包**，
使 composer 右下角的模型信息区，在**任何供应商**下都完整展示「供应商 · 模型 · 推理强度」，
且当该供应商已被第三方插件接管时自动让位、不产生重复信息。

## 二、范围（In scope / Out of scope）

**In**
- 一个 bundle 包：Host 半（提供目录/归属判定与配置）+ Client 半（`conversation.input.right` 渲染）
- 判定「供应商归属」的逻辑与可配置覆盖
- 中英文 locale、图标、`meta.title`/`meta.description`
- 单元/契约测试与验收脚本（不含浏览器自动化）

**Out（明确不做）**
- ❌ 不接管、不替换 `conversation.input.model` 或 `.label`（会与 workbuddy 抢格）
- ❌ 不修改宿主包、不修改 profile 的 `package.json` / `cordis.patch.yml`
- ❌ 不实现积分/倍率/促销（属第三方能力，不在本项目职责内）
- ❌ 不接管选择行为（点击下拉仍归宿主）
- ❌ 不写 session 事件（新增 event type 会破坏会话重开）

## 三、架构决策（ADR 摘要）

### ADR-1：落点用 `conversation.input.right`
- `kind: "list"` + `replaceRisk: "none"`，用独有 id 叠加，不与任何人冲突。
- 渲染位置在模型选择器**左侧**同一条 flex 行（CONV:19276-19280），正是「右下角信息区」。
- 反例：`conversation.input.model.label` 是 `single` 槽，workbuddy 已用 `priority: -0.5` 占位，
  宿主 1017 徽标在 0 位被压制。我们再去注册会**抛错抢格**，且会把 third-party 的显示顶掉。
- 代价（已知并接受）：芯片宽度计入 `.trailing`，使模型名更早折叠为图标（CONV:18871-18899）。
  缓解：`max-width: 140px` + `text-overflow: ellipsis` + `margin-inline-end: -10px`，只显示供应商名。

### ADR-2：供应商归属判定以 `settingsNs` 为主信号
- `remote.llm.listConfigurableProviders()` 返回 `settingsNs`（= Loader entry id）。
- 内置供应商的 `settingsNs` 固定为 `llm-pi-ai` / `llm-deepseek` / `llm-deepseek-account`（来自 `dsh-base` patch）。
- 其余任何值 ⇒ 某个插件注册的 provider ⇒ 判定为「已被接管」。
- 辅助校验：`settingsPath.length === 0`（workbuddy 与 deepseek 系如此；pi-ai 用户路由为 `["providers", x]`）。
- **不采用**：`declared` 字段（语义不符）、模型名后缀正则（脆弱）、provider id 前缀（可伪造）。

### ADR-3：判定结果三层兜底（这是本设计的核心安全网）

```
L1 配置覆盖（用户显式声明，最高优先级）
      cfg.overrides = { "volcano-xxx": "mine" | "third-party" | "hide" }
        ↓ 未命中
L2 运行时探测：settingsNs ∉ CORE_NAMESPACES ⇒ third-party
        ↓ 探测不可用（remote.llm 不可达 / 目录未加载）
L3 保守默认 = 我方显示（fail-open to "show provider"）
```

**为什么 L3 是 fail-open 而不是 fail-closed**：漏显只是信息不全（回到现状）；
误判为「已接管」会让**所有供应商都不显示**，属于明显回归。故默认显示。

`CORE_NAMESPACES` 默认 `["llm-pi-ai","llm-deepseek","llm-deepseek-account"]`，
并通过 `cfg.coreNamespaces` 可扩展（宿主升级新增内置 provider 时无需改代码）。

### ADR-4：Host 半是必需的，且客户端只做查表

- 浏览器看不到 `settingsNs`：模型目录的 provider group 只有 `{ id, name, models }`，
  `prepareRoutes` 在进入目录前就把适配器元数据裁掉了。**判定所需的原始事实只在 Host 侧存在。**
- 因此 Host 半读 `ctx.llm.listConfigurableProviders()` + `ctx.llm.listProviders()`，
  用共享的纯函数算出结论，通过 `ctx.webServer.register({ kind: 'exact' })`
  暴露只读 GET `/plugins/dsh-provider-show/providers`（同 workbuddy 的 `WORKBUDDY_USAGE_PATH` 范式）。
- 客户端**只读这条路由**，自身不含任何归属规则；拿不到文档就渲染空。
  这样规则只有一份实现，不存在「浏览器一份、Host 一份」的漂移。
- 路由注册必须由 `scope.effect(...)` 持有（插件返回值会被丢弃），且用
  `ctx.inject(['webServer'], …)` 等服务就绪（一次性 `ctx.get` 会静默漏注册）。

### ADR-5：单例注册 + gate 内判空
照 workbuddy 范式：**无条件注册 slot**，组件内部读 `useProjection('modelSelection')`，
判定为「第三方接管 / 无选中 / 目录未就绪」时 `return null`，且**不发起任何请求**。

### ADR-6：不读取、不操作别人的 DOM
所有信息来自 Service（`remote.llm` / 自有路由 / `useProjection`）。
ADR-3 的 `ctx.slots.entries()` 若用于「探测谁占了 label 槽」只作为**可选佐证**，不作为判定主依据。

## 四、边界与约束

| 约束 | 说明 |
|---|---|
| 不得与 `single` 槽冲突 | 只用 `list` 槽 + 独有 id |
| 宽度预算 | 目标 ≤ 110px；超长供应商名省略号截断；提供 `shortName` 映射 |
| 暗/亮主题 | 只用 `--dsw-alias-*` token，不写字面色值（例外：图标 artwork） |
| 国际化 | 文案走 `ctx.locale.register`；zh + en 两套 |
| 生命周期 | 所有注册包在 `ctx.effect` 内，插件卸载即清理 |
| 零轮询 | 无选中/已接管时不请求；目录数据订阅 `llm/adapters-updated` 类无效化（若走 route 则按需拉取+短缓存） |
| 不写 session | 不新增 event type，不改会话日志 |
| 失败静默 | 任何解析失败 → 不渲染，绝不抛到 slot（会 `slot entry crashed`） |

## 五、接口草案（不实施，仅确认形状）

**Config（`cordis.patch.yml` 可覆盖）**
```yaml
config:
  enabled: true              # 总开关
  showModel: false           # 是否在芯片里重复模型名（默认 false，宿主已显示）
  showEffort: false          # 是否重复推理强度（默认 false，宿主已显示）
  separator: " · "           # 段间分隔符
  shortNames:                # provider id → 展示短名
    workbuddy: WB CN
    volcano-abc: 火山
  overrides:                 # provider id → mine | third-party | hide
    some-provider: third-party
  coreNamespaces: [llm-pi-ai, llm-deepseek, llm-deepseek-account]
```

**渲染输出（三种形态）**
| 情形 | 输出 |
|---|---|
| core provider，`showModel/showEffort=false` | `火山` （仅供应商 chip） |
| 已接管 provider | *（不渲染，整段让位）* |
| 覆盖表 `hide` | *（不渲染）* |
| 名称未知 | 回退 `providerDisplayName`；再未知则不渲染 |

**Host 只读路由**
```
GET /plugins/dsh-provider-show/providers
→ { providers: [{ provider, displayName, ownedBy, ownerNs }], coreNamespaces: [...] }
```
（仅 loopback、仅 GET、无副作用、结果短期缓存）

## 六、验收标准（Acceptance Criteria）

> 因为本会话审批被禁用、无法安装插件，**AC-1 ~ AC-5 需要你在有审批权限的会话里执行**。
> 本轮我能交付并自证的是 AC-0 与全部静态检查。

| ID | 验收项 | 判定 | 谁来验 |
|---|---|---|---|
| **AC-0** | 仓库已 git 化，含 README、设计文档、可 `node --check` 通过的源码 | `git log` 有提交；语法检查全绿 | ✅ 本轮 |
| **AC-1** | 选中**火山 API**（pi-ai 用户路由）时，模型选择器左侧出现供应商芯片，文案为供应商名 | 截图比对图1，多出供应商段 | 你 |
| **AC-2** | 选中 **WorkBuddy** 时，我方**不出现**任何新元素，与图2 完全一致（不重复 `WB CN`） | 截图与图2 逐像素级目视一致 | 你 |
| **AC-3** | 切换供应商时芯片实时跟随，无闪烁、无报错（Console 无 `slot entry crashed`） | 手动连切 3 次 | 你 |
| **AC-4** | 窗口拉窄至模型名折叠为图标时，芯片仍可用且不撑破布局 | 窄窗截图 | 你 |
| **AC-5** | 第三方接管检测的三种形态：①未接管→显示 ②接管→隐藏 ③`overrides.hide`→隐藏 | 用 `overrides` 人为造第三种 | 你 |
| **AC-6** | 无选中模型（空白新会话）时不渲染、不发请求 | Network 面板无新增请求 | 你 |
| **AC-7** | 暗色/亮色主题下均使用主题 token，无硬编码色值 | 切换主题目视 + grep 校验 | 你 + 静态 |
| **AC-8** | 卸载插件后，宿主恢复原样，无残留样式/请求 | 禁用后刷新比对 | 你 |

**本轮可自动化的部分**：AC-0、AC-7(grep)、manifest 校验、unit test（归属判定纯函数）。

## 七、实施计划（确认后再执行）

| 阶段 | 内容 | 产出 | 写作用域 |
|---|---|---|---|
| P0 | 脚手架：package.json / cordis.patch.yml / locale / icon / README | 包骨架 | 新建目录 |
| P1 | 纯逻辑：`resolveOwnership()` + 单测（不依赖 DSH 运行时） | `lib/ownership.js` + `test/ownership.test.mjs` | `lib/`, `test/` |
| P2 | Host 半：Config schema + 只读路由 | `lib/index.js` | `lib/` |
| P3 | Client 半：slot 注册 + 状态组件 + 样式 | `lib/client.js` | `lib/` |
| P4 | 静态校验：`node --check`、manifest 自检、token grep | 校验脚本 | `scripts/` |
| P5 | 安装与浏览器验收（需审批权限） | 截图对照 AC-1/2 | — |

## 八、已确认的决策（2026-11-03）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 让位粒度 | **整段让出**：第三方接管时我方完全不渲染 |
| 2 | 归属判定信号 | **settingsNs 判定 + 可配置覆盖** |
| 3 | 探测失败默认 | **fail-open**：默认显示供应商 |
| 4 | 芯片内容 | **只补供应商名**（模型与强度宿主已渲染） |
| 5 | 验收方式 | 本轮交付代码+文档+自测，安装验收在可审批的会话进行 |

## 九、交付状态

已完成（P0–P4）：

| 项 | 状态 | 证据 |
|---|---|---|
| 仓库 git 化 | ✅ | 3 个提交，工作区干净 |
| 包骨架（P0） | ✅ | `package.json` / `cordis.patch.yml` / `locale/` / `icon.svg` |
| 纯逻辑 + 单测（P1） | ✅ | `lib/ownership.js`，19 项单测 |
| Host 半（P2） | ✅ | 只读 GET 路由 + 纯数据配置；11 项行为测试 |
| Client 半（P3） | ✅ | `conversation.input.right` 注册；Node 端组件冒烟通过 |
| 静态校验（P4） | ✅ | `scripts/verify.mjs` 23 项，逐条做过反证测试 |
| 安装（P5 前半） | ✅ | 已装入 desktop profile；Host 行 `fiberPhase: active`；路由实测 200 |
| 浏览器视觉验收（P5 后半） | ✅ | 用户实测通过；排版问题按 2 倍截图量测后修正（见下） |
| 开源（P6） | ✅ | 已推送 https://github.com/MosCloud/dsh-provider-show |

### 实施中发现并修正的问题

1. **`apply` 返回值被丢弃** → 路由会注册后永久泄漏。改为 `scope.effect(...)` 持有。
2. **`ctx.get('webServer')` 一次性探测** → 服务晚激活则路由永不注册。改为 `ctx.inject(['webServer'], ...)`。
3. **`hide` 覆盖值未实现** → 配置项描述存在但无行为。改为在 `resolveOwnership` 上携带 `hidden` 标记，保证 overrides 表只有一个读者。
4. **Host 半不可 import `@deepseek-ai/schemastery`** → 链接式安装下整个 Host 半加载失败（已用模拟安装复现 `ERR_MODULE_NOT_FOUND`）。改为纯数据配置（`CONFIG_KEYS` + `effectiveConfig`），不导出 `Config`。

### 排版对齐的返工记录（重要）

早期判断「汉字在拉丁基线上天然偏高，必须做光学补偿」，并连续加过 `+2px` → `1px` 的位移补偿，
**这个判断是错的**，最终把整套补偿机制删除。

错因：当时芯片是 12px、模型名是 13px，字号不一致造成的基线差异被误读成「字体脚本差异」。
字号统一到 13px 后，从 2 倍截图实测墨迹质心（1 CSS px = 2 图像 px）：

| 文字块 | 墨迹行范围 | 质心 |
|---|---|---|
| `火山` | 19..43 | 33.12 |
| `DeepSeek` | 19..42 | 29.80 |
| `Flash` | 19..38 | 28.90 |
| `×0.20` | 19..38 | 28.76 |
| `High` | 19..42 | 30.02 |

拉丁均值约 29.4。挂 `+2px` 时汉字质心 33.12（**低 1.85 CSS px**），去掉后落到 29.1（齐平）。
**结论：同字号下最优补偿是 0。**

现在 `verify.mjs` 有一条反向防护：客户端或样式表里出现 `translateY(` 即判红，
防止这个结论再被"凭感觉"推翻。

### 已完成的安装验收（留档）

1. `dsh plugin --profile <profile> add /path/to/dsh-provider-show`
2. 刷新页面
3. 核对：火山API 显示供应商、WorkBuddy 不重复显示、窄窗与暗色主题正常

### 原 P5 待办（已完成，留档）

1. 安装本目录到目标 profile。
2. 刷新页面，按第六节的 AC-1 ~ AC-8 逐项核对。
3. 重点确认 AC-2：选中 WorkBuddy 时我方**不出现**任何新元素。

以上均已执行并通过。

## 十、Loader 行 id 与包名的关系（改这里之前必读）

patch 里 `id` 与 `name` 是两个独立字段，宿主从不派生其中一个：

```yaml
- insert:
    - id: dsh-provider-show      # Loader 行 id：配置覆盖、按行启用状态的键
      name: dsh-provider-show    # 模块标识：包名，或包内子路径
```

**两者不会随版本自动分叉**，只会在下列情形不一致（均有实例）：

| 情形 | 实例 |
|---|---|
| 发布改用带 scope 的包名 | `@michengai/dsh-skills-manager` → id `skills-manager` |
| 一个包插多行（id 必须唯一） | `@deepseek-ai/dsh-agent-preset` 被 4 个 preset 补丁以 `preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis` 插入，`name` 全相同 |
| 短 id 习惯 | `dsh-session-purge` → `session-purge`；`dshmarket` → `dsh-market`。反例并存：`dsh-context`、`dsh-connect-workbuddy` 就是 id == 包名 |
| 覆盖内置行 | profile 补丁按 `id` 覆盖内置行（id 必须与内置一致），`name` 指向替换包 |
| 子路径行 | `name: 'my-plugins/search'` —— 不是包名 |

### 对本插件的影响

- **改 id 不影响功能**：路由路径写死 `/plugins/dsh-provider-show/providers`；客户端模块 id 取包名；宿主侧不读自己的 entry id。
- **但 id 一旦发布就是用户契约**：profile 里的 `- id: …` 覆盖、插件管理器按行的启用状态，都以 id 为键。改 id 会让这些失效。
- 对**供应商类**插件还有一层：entry id 兼作 provider 的 `settingsNs`，而本插件正是靠它判定「供应商是否被第三方接管」。所以 id 不只是显示名。

### 决策

- 当前 `id == 包名`，保持。
- 若将来发布到 npm 时改用带 scope 的包名（如 `@moscloud/dsh-provider-show`），**把 id 保持 `dsh-provider-show` 不变** —— id 稳定、包名可变，正是这套机制存在的意义。
- 只有真新增第二个组件行时才需要新的 id。

### 与「包含的组件」重复显示的关系

插件详情页对该行会打印两个标识，条件是它们与标题不同：

```js
title === row.rowId      ? null : <code>{row.rowId}</code>
title === row.moduleName ? null : <code>{row.moduleName}</code>
```

本插件提供了本地化标题（「供应商信息补全」），而 `rowId === moduleName`，于是同一串打印两次。
行标题与描述都按**包名**取元信息（`metaOf(row.name)`），因此必然与页面顶部重复。

这是宿主的展示行为，**不是本插件的缺陷**，也不建议为它把 id 改成短名（收益只是少一次重复字符串，代价是让用户多记一个标识）。
WorkBuddy 之所以看不出重复，是因为它的 `meta.title` 直接用了包名本身。

## 十一、渲染与排版细节

> 从 README 移入。README 只保留使用者需要的信息，这些是修改代码前需要知道的事实。

### 11.1 只显示供应商名，不重复模型与强度

宿主已经画了模型名（经 `conversation.input.model.label` slot）与推理强度（`triggerEffort` span，非 slot）。
芯片再画一次就是同一行出现两遍。所以芯片只补唯一缺失的那一项：**供应商**。

### 11.2 排版度量必须与模型触发器完全一致

| 约束 | 原因 |
|---|---|
| `font-size:13px` + `font-weight:400` + `line-height:20px` + `height:28px` + `align-items:center` | 与 `.htuFrW_trigger` 同一套度量 |
| **不声明 `font-family`** | 两者继承同一个字体栈；自己声明会引入差异 |
| `margin-inline-end:-10px`、自身 `padding:0` | 宿主 `.standardControls` 有 12px `gap`，模型触发器又有 8px 左内边距 |
| **禁止 `translateY`** | 见 11.3 |

行盒内基线位置是 `half-leading + ascent`，**由字号与字体决定、与 `line-height` 无关**。
所以「度量相同 ⇒ 基线自动重合」，不需要 `align-items: baseline`（那是父容器的属性，我们也改不了）。

### 11.3 中文补偿是一次错误结论（留档防复发）

**曾经的错误判断**：汉字占满 em 框、无下伸部，因此在拉丁基线上偏高，必须加位移补偿。
据此连续加过 `+2px` → `1px`。

**错因**：当时芯片 12px、模型名 13px，字号不一致造成的基线差被误读成「字体脚本差异」。
字号统一到 13px 后，从 2 倍截图量墨迹质心（1 CSS px = 2 图像 px）：

| 文字块 | 墨迹行范围 | 质心 |
|---|---|---|
| `火山` | 19..43 | **33.12** |
| `DeepSeek` | 19..42 | 29.80 |
| `Flash` | 19..38 | 28.90 |
| `×0.20` | 19..38 | 28.76 |
| `High` | 19..42 | 30.02 |

拉丁均值约 29.4。挂 `+2px` 时汉字质心 33.12（**低 1.85 CSS px**），去掉后落到 29.1（齐平）。
**结论：同字号下最优补偿是 0**，整套补偿机制已删除。

`scripts/verify.mjs` 有一条反向防护：客户端或样式表出现 `translateY(` 即判红。
若将来确实需要补偿，必须先给出新的实测数据，不能凭观感改。

### 11.4 层级靠颜色而不是字号

宿主自己就这么做：模型名 `label-secondary`、推理强度 `label-caption`，**两者都是 13px**。
供应商作为第三层用 `label-tertiary`、同为 13px，整行读作「供应商 · 模型 · 强度」一个视觉单位。

### 11.5 已知的宿主展示行为

插件详情页「包含的组件」对单行插件会重复打印标识符，行标题与描述也会与页面顶部重复。
这是宿主行为而非本插件缺陷，机制与是否要改 id 的判断见[第十节](#十loader-行-id-与包名的关系改这里之前必读)。
