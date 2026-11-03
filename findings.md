# findings — 技术事实核查记录

> 所有结论均来自本机实际代码，标注了文件与行号。标注 `UNVERIFIED` 的条目尚未运行时验证。

## 1. 目标区域：composer 控制行

来源：`/tmp/dshpkgs/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（下称 CONV）
（该目录由 `app.asar` 解包得到，与运行时同一份产物）

### 1.1 DOM 顺序

`InputBar` 渲染 `.row`，其子节点只有两个：`.tools` 与 `.trailing`（CONV:19239 / 19273）。

```
[ + ] [ permission ] [ plan ] [ left ]   [ right ] [ model ] [ activity ] [ stop ] [ send ]
└──────────── .tools ────────────┘       └─ .standardControls ─┘ └──── .trailing ────┘
```

`input.right` 与 `input.model` 是 `.standardControls` 仅有的两个子节点，JSX 顺序决定左右：

```js
// CONV:19276-19280
(0, react_jsx_runtime.jsxs)("div", {
    className: InputBar_module_css_default.standardControls,
    hidden: activity,
    children: [
        input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.right", {}),
        sessionId === void 0 ? null : renderSlot("conversation.input.model", { locked: modelSeatLocked })
    ]
}
```

**结论：`conversation.input.right` 渲染在模型选择器左侧，同一 flex 行，gap 12px（容器 ≤560px 时 8px）。**

关键 CSS（CONV:18902）：
```css
.JZLxKW_trailing{flex:none;gap:12px;margin-left:auto}
.JZLxKW_standardControls{align-items:center;gap:12px;min-width:0;display:flex}
.JZLxKW_standardControls[hidden]{display:none}
```

### 1.2 紧凑模式（模型名折叠为图标）

`observeControlRow`（CONV:18871-18899）用 ResizeObserver 测量，判定条件为
`width(.tools) + width(.trailing) + columnGap > rowWidth - 16px` 时给 `.row` 打 `data-model-compact`，
从而把 `--dsh-composer-model-text-display` 置为 `none`、`--dsh-composer-model-icon-display` 置为 `block`。

**约束：任何注册在 `input.right` 的元素都会计入 `.trailing` 宽度，使模型名更早折叠。必须限制宽度并省略号截断。**

### 1.3 活动展开时消失

`.standardControls` 带 `hidden: activity`（CONV:19278）。当 `conversation.input.activity` 占用整行时，
`input.right` 与模型选择器一起被隐藏。这是宿主行为，插件无法也无需干预。

## 2. 模型选择器与推理强度

来源：`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js`（下称 MODEL）

触发按钮结构（MODEL:1512-1525）：

```js
children: [
  IconDataOutlineRegular { className: css.triggerIcon },        // display: var(--dsh-composer-model-icon-display, none)
  span { className: css.triggerLabel, children: renderModelLabel(provider, model, "trigger", true) },
  effortLabel !== undefined && span { className: css.triggerEffort, children: effortLabel },
  busy ? StateDot : IconChevronDownOutlineRegular
]
```

- `triggerLabel` 走 `conversation.input.model.label` slot（`renderModelLabel`，MODEL:1466-1474）
- `triggerEffort` 由宿主自己渲染，**不是 slot**（MODEL:1520）

effort 文案来源（MODEL:1206）：
```js
const effortLabel = currentChoice === void 0 ? void 0
  : reasoning === void 0 ? state.retainedEffort
  : effectiveEffort === void 0 ? t("effort.providerDefault")
  : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
```
`effort.providerDefault` 中英均为 `"Default"`（MODEL:1757 / 1783）。

**结论：模型名与推理强度已由宿主完整渲染。插件唯一缺口是「供应商」。**

## 3. 两个候选 slot 的取舍

| | `conversation.input.right` | `conversation.input.model.label` |
|---|---|---|
| kind | `list`（可叠加） | `single`（独占一格） |
| replaceRisk | **none** | shadows-shipped-ui |
| owner props | 无 | `{ provider:{id,name}, model, placement, selected }` |
| 冲突 | 不会（用独有 id） | **会**：single slot 同优先级注册直接抛错 |
| 现有占用者 | `dsh-connect-workbuddy-composer-credits`（order 4） | `dsh-connect-workbuddy-client`（priority **-0.5**）、宿主 1017 徽标（priority 0） |

实测（`cordis_inspect_query` → Slots，本机运行中）：

```json
"conversation.input.right": { "occupants": [
  { "registrant": "dsh-connect-workbuddy-client", "id": "dsh-connect-workbuddy-composer-credits", "order": 4, "priority": 0, "active": true }
]}
"conversation.input.model.label": { "occupants": [
  { "registrant": "dsh-connect-workbuddy-client", "priority": -0.5, "active": true },
  { "registrant": "Gb", "priority": 0, "active": false }
]}
```

workbuddy 源码对该冲突的解释（`dsh-connect-workbuddy/lib/client.js:11587-11620`）：
> `single` slot 同优先级注册会抛 `already has a registration at priority 0`，故用 `-0.5` 避开；
> 它**不做插件联动**，对非自家 provider 只回退渲染纯目录名。

**结论：本项目必须用 `conversation.input.right`（叠加、不夺格）。绝不能用 `model.label`——那会与 workbuddy 抢格并屏蔽宿主徽标。**

## 4. 「供应商是否被第三方插件接管」的可判定信号

来源：`@deepseek-ai/dsh-api-session-controller/lib/index.js`、`@deepseek-ai/dsh-llm/lib/index.js`、workbuddy `lib/index.js`

### 4.1 目录数据里没有 owner 字段

```ts
// dsh-api-session-controller/lib/index.js:585-589
const catalog = await Promise.all(providers.map(async (provider) => {
  ...
  return { id: provider.id, name: provider.name, models: entries };   // 仅 id/name/models
```
`LlmProviderInfo` 在 `dsh-llm/lib/index.js:1886-1889` 被裁剪为 `{ id, name }`，多余字段被丢弃。
**provider group / model 上都不存在 `owner`/`source`/`pluginId`/`registrant`。**

### 4.2 唯一可靠信号：`settingsNs`（= Loader entry id）

`ctx.remote.llm.listConfigurableProviders()` 返回（schema 见 `dsh-api-remotes/lib/client.js:7411`）：

```ts
{ provider, displayName, settingsNs, settingsPath: string[],
  declared?, defaultBaseURL?, baseURLEnv?, nativeAuth?, error? }
```

核心 provider 的 `settingsNs` 取自 `ctx.fiber.entry?.options.id`，来自 `@deepseek-ai/dsh-base/cordis.patch.yml`：

| entry id | 包 | settingsPath |
|---|---|---|
| `llm-pi-ai` | dsh-llm-pi-ai | `["providers", <route>]` |
| `llm-deepseek` | dsh-llm-deepseek-api-key | `[]` |
| `llm-deepseek-account` | dsh-llm-deepseek-account | `[]` |

workbuddy（`lib/index.js:13655-13670`）：
```js
ctx.llm.registerConfigurableProviders([
  { provider: "workbuddy",        displayName: "WorkBuddy",        settingsNs, settingsPath: [], declared: false },
  { provider: "workbuddy-global", displayName: "WorkBuddy Global", settingsNs, settingsPath: [], declared: false }
]);
```
其中 `settingsNs` 来自 `ctx.fiber.entry?.options.id`（`lib/index.js:11455`），
即 profile 里 `dsh-connect-workbuddy` 这一行的 id。

**判定式：`settingsNs ∉ {llm-pi-ai, llm-deepseek, llm-deepseek-account, …}` ⇒ 该 provider 由某个插件接管。**
辅助校验：`settingsPath.length === 0`（workbuddy 与 deepseek 系为 `[]`，pi-ai 为用户路由为 `["providers", x]`）。

### 4.3 已排除的弱信号

- `declared` 字段：语义是「适配器是否只因为配置才知道此路由」，pi-ai 对用户路由与自带路由都可能是 `false`，**不能**表示所有权。
- `llm/adapters-updated` 事件：无载荷，仅拓扑通知。
- 模型名后缀 `· x0.11`：workbuddy 用 `splitCatalogRate`（`client.js:11717`）解析，属于启发式，脆弱且可伪造。
- `ctx.slots.entries(...)` 的 registrant：只能证明「某插件占了某格」，不是 per-provider 归属。

## 5. 客户端可得性

- `remote.llm` 是已 `@Remote` 暴露的命名空间，`dsh-client-ui-settings-models` 在 `lib/client.js:4418-4428` 直接声明：
  ```js
  const inject = ["slots","locale","remote","remote.credentials","remote.llm","remote.settings","remote.session","configForms","settingsSchema"];
  ```
  并在 `lib/client.js:1343` 调用 `this.ctx.remote.llm.listConfigurableProviders()`。
- 动态加载插件的 ctx 是白名单代理（`dsh-cordis-client-runner/lib/client.js:326-370`）：
  只有在插件 `inject` 中声明过的服务才可读，否则 `denyRead` 抛错。
  **UNVERIFIED：动态加载（非内置）客户端插件注入 `remote.llm` 的端到端可达性。**
  → 这一条决定了「纯客户端插件」是否成立，也是设计里保留 Host 兜底与配置覆盖的原因。

## 6. 现有第三方插件的实现范式（可借鉴）

workbuddy 的 composer 积分读数（`dsh-connect-workbuddy/lib/client.js:13200-13260`）：

```js
ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
  name: "conversation.input.right",
  id: "dsh-connect-workbuddy-composer-credits",
  order: 4,
  locale: namespace,
  inject: () => settingsScope === undefined ? { t, position: "composer" } : { t, position: "composer", settingsScope }
}, ComposerCreditsGate));
```

其注释明确了三条可直接复用的经验：
1. **无条件注册，由 gate（读 `modelSelection` 投影）自行决定是否渲染**——不渲染就不发起任何请求。
2. 选 `input.right` 而非 `input.left`：`input.left` 紧贴权限选择器，可点击读数会误触控件。
3. provider 归属决定唯一占用，避免两个连接器插件抢同一行。

样式基线（`client.js:6863-6875`）：
```css
.dsm-workbuddy-composer-credits-trigger{
  display:inline-flex;align-items:center;align-self:stretch;
  padding:2px 6px;border:0;border-radius:6px;background:transparent;
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary,#999);
  white-space:nowrap;font-variant-numeric:tabular-nums;
}
```

## 7. 宿主读取选中项的方式

- 投影 `modelSelection`（`dsh-api-session-controller/lib/index.js:2146-2187`）：
  ```ts
  { lastUsed: ModelSelection | null, next: ModelSelection | null }
  ModelSelection = { provider: string, model: string, reasoningEffort?: string }   // 均为 id
  ```
  客户端 `useProjection('modelSelection')` 取到上述结构；未知 key 返回 `undefined` 而不抛错。
- 模型目录（`remote.session.modelCatalog()`）：`{ default, routableProviders, groups, failures }`，
  `groups[].name` 即**用户可见的供应商名**（pi-ai 路由为用户在设置里填的 displayName）。

## 8. 环境限制

- 本会话审批策略已变为 `never`，`plugin_manager` 任何动作（含 `list_plugins`）都会被自动拒绝，
  **因此本轮无法安装/启用插件，也无法做浏览器端验收**。
- 可用校验手段：JS 语法检查、manifest/schema 自检、`cordis_inspect_query` 只读查询（宿主与客户端 Slot 均为只读，不需要审批）。
