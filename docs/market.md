# 收录到 awesome-dsh-plugin（market）

> 目标：让 `dsh-provider-show` 出现在 awesome-dsh-plugin 列表、`dsh-market` 插件市场与
> 官方 Discover 里。本文只记录**对着上游源码核对过**的结论，每条都有出处。
>
> 上游基线：`awesome-dsh-plugin/awesome-dsh-plugin` @ `1fe9aed`（2026-11-04）。
> 投稿状态：**[PR #11797](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11797) 已开，两项检查全绿**，
> 等待维护者评审。

---

## 〇、当前状态（2026-11-04 13:40 SGT）

| 项 | 状态 |
|---|---|
| 插件仓库 `main` | ✅ 已推送（图标 + 本文档） |
| 图标 `assets/icon-180.png` | ✅ 已上线，URL 返回 200 / PNG / 5086 B |
| `dsh-plugin` topic | ✅ 已加（`dsh`, `dsh-plugin`, `deepseek-harness`, `provider`, `composer`） |
| 上游 fork | ✅ `MosCloud/awesome-dsh-plugin` |
| 分支 | ✅ `add/dsh-provider-show`（head `e931531`，相对 `origin/main` +1 文件 −0） |
| PR | ✅ [#11797](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11797) OPEN / MERGEABLE |
| `check`（awesome-lint、站点构建、结构校验） | ✅ **success**，17m54s |
| `Submission gate` | ✅ **success** —「Entries look good」 |

gate 的最终判定原文：

```
All 1 submitted entry passes: `dsh.bundle` declared, repo old enough, enough commits.
```

截至 13:40 SGT **没有维护者评论、review 或 label**，PR 处于等评审状态。

### 年龄门限那一段的真实时序（踩过一次坑，记下来）

gate 的文案写「should clear in about 2h」，**那个 2h 是「距仓库满 1 天」的倒计时，
不是「多久重跑」**。`scripts/check-submission.mjs` 里就是
`hours = Math.ceil((MIN_AGE_DAYS - ageDays) * 24)`。

真正的重跑在 `regate.yml`，而且 `aged` 规则带 **24 小时冷却**：

```js
const aged = gate?.conclusion === 'failure'
  && /days old|commit\(s\)/.test(gate.output?.summary ?? '')
  && (!ranAt || Date.now() - ranAt >= 24 * 3600 * 1000)   // ← 距上次 gate 满 24h
```

所以按「自动」走，本次要等到 **2026-11-05 14:19 SGT**（约 27.6h）才会重跑。
`check-submission.mjs` 里那句「every six hours」的注释与 `regate.yml` 的实际代码
不一致，**以代码为准**。

实际采用的做法：推一个**空提交**（`e931531`）制造新事件，立刻拿到新判定——
推送 02:49Z，`check` 03:07:50Z 完成，gate 03:08:34Z 通过，全程约 19 分钟。

这**不违反** contributing.md：原文是 "You do not need to push an empty commit"
（不需要），不是禁止；全文件无禁止性措辞；`pr-guard` 只拦「PR 完全没有 check」
和「PR 改了 `.github/`」，空提交都不触碰；上游是 squash merge（近 60 个提交无
merge commit），空提交合并后不会留在 main 历史里。

---

## 一、投稿模型：一个文件就是全部

投稿 = 一个 PR 加**一个 YAML 文件**，路径 `data/plugins/<owner>__<repo>.yml`。
两个 README 由脚本从 `data/plugins/*.yml` 生成，合并后在 `main` 自动重跑，**不要手改**。

字段与校验规则来自 `scripts/lib/entries.mjs` 的 `ENTRY_KEYS` 与 `validateEntries()`：

| 字段 | 必填 | 校验 |
|---|---|---|
| `url` | ✅ | 必须是 `https://github.com/owner/repo` |
| `name` | ✅ | 列表里的链接文字；写成 `owner/repo` 时会与 `url` 比对（大小写不敏感） |
| `category` | ✅ | 必须是 `CAT_IDS` 之一 |
| `description.en` | ✅ | 单行；含 `: ` 必须加引号 |
| `description.zh` | ❌ | 可选，缺失由维护者补；给了就不能为空，也不能是站点不渲染的语言 |
| `icon` | ❌ | GitHub 托管的 **位图**（png/jpg/jpeg/webp），**SVG 会被拒** |
| `tarball` | ❌ | GitHub Release 上的 `.tgz` |

文件名由 `slugFor(url)` 推导：`MosCloud/dsh-provider-show` → `MosCloud__dsh-provider-show.yml`。
大小写**照抄仓库 owner 的实际拼写**。

## 二、我们这一条的成品（已提交）

```yaml
# data/plugins/MosCloud__dsh-provider-show.yml
url: https://github.com/MosCloud/dsh-provider-show
name: MosCloud/dsh-provider-show
category: ui
description:
  en: Shows which provider the composer's currently selected model belongs to, and stays silent for providers another plugin already presents.
  zh: 在 DSH 输入框展示当前所选模型所属的供应商；已被其他插件接管的供应商自动让位，不重复显示。
icon: https://raw.githubusercontent.com/MosCloud/dsh-provider-show/main/assets/icon-180.png
```

本地跑过上游真实校验：

```
readEntries()        → 8656 条解析成功，本条结构正确
validateEntries()    → (none)              # 无 schema 问题
iconProblem()        → null (ok)           # 位图 + GitHub 托管，合规
slug 与文件名        → MosCloud__dsh-provider-show.yml  一致
generate-readme.mjs  → README.md / README.zh.md 各生成一行，双语正确
```

### 为什么是 `ui` 而不是 `model`

| 已收录条目 | 分类 | 做什么 |
|---|---|---|
| `huihuangdi/dsh-model-provider-badge` | `ui` | 输入框工具行显示供应商徽标 |
| `ken95573/dsh-model-show` | `model` | 在模型选择器触发器里显示 provider/model |
| `zhangyongshuai56-hub/dsh-model-picker-brand` | `ui` | 给模型选择器加 provider logo |

我们做的事是**画一个芯片**，不动模型目录、不改选型 —— 与 `dsh-model-provider-badge`
同形，所以选 `ui`。contributing.md 明确写了「分类不会成为打回理由，不贴切维护者直接改」。

## 三、三个门槛的核对结果

对着上游 gate 源码（`scripts/check-submission.mjs`）逐条核对：

| 门槛 | 现状 | 结论 |
|---|---|---|
| `dsh.bundle` manifest | `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，文件存在 | ✅ 过 |
| 仓库满 **1 天** | 创建于 `2026-11-03T02:30:24Z` | ⏳ 唯一未过项，自动清除 |
| 仓库未归档 | `archived: false` | ✅ 过 |
| 非 DSH 本体 | 是插件仓库 | ✅ 过 |
| `dsh-plugin` topic | 已加 | ✅ 过 |

真实 gate 输出（run 上的 check-run summary）：

```
https://github.com/MosCloud/dsh-provider-show
- repository is 0.9 days old (needs 1) — nothing to do: this check re-runs by
  itself and should clear in about 2h. No need to resubmit, push, or close and
  reopen; the age bar is the only thing failing here.
```

## 四、真正的评审关：与 `dsh-model-provider-badge` 撞车

CI 只验形式，**合并与否取决于维护者读代码**。contributing.md 第 4 条：

> 是否已被现有条目覆盖。两个插件做同一件事时，先来者保留位置——但这只是平局时的排序依据。
> ……规则不是先来后到，规则是**谁更好**。

已存在一个高度相似的条目：

```
huihuangdi/dsh-model-provider-badge   category: ui
en: Shows the provider behind a session's current model as a compact badge
    in the DSH Web composer tool row, left of the model selector.
```

逐项对比（读了对方 `client.js` 与 `package.json`）：

| | `dsh-model-provider-badge` | 我们 |
|---|---|---|
| 槽位 | `conversation.input.right` | `conversation.input.right`（同） |
| 数据来源 | 客户端 `modelDirectories` 服务直读 | Host 半读 LLM 目录，只读路由下发结论 |
| 被第三方接管时 | **照常显示**（不判断归属） | **让位不显示** |
| 可配置 | 无 | `shortNames` / `overrides` / `coreNamespaces` |
| 依赖 | 无 | 无（零依赖） |
| 测试 | 1 个 selftest | 47 个用例 + 25 项静态校验 |
| 仓库年龄 | 2026-10-14（先到） | 2026-11-03 |

**差异点只有一个，但它是设计上的根本差异：让位。**
对方做不到，因为浏览器侧拿不到 `settingsNs`（模型目录分组只带 `{id,name,models}`，
注册表在到达页面前就剥掉了 adapter 元数据）。

已在 PR 正文中主动点名该条目、说明差异，并明确写了「不申请替换、接受先到者平局判定」。
这是维护者最看重的态度：**不回避、不贬低、不自作主张**。

## 五、图标（已完成）

`icon:` 只收 GitHub 托管的**位图**，`icon.svg` 会被 `iconProblem()` 直接拒掉。

- 已渲染 `assets/icon-180.png`：512px 主图 → 180px LANCZOS 下采样，
  方形透明底，5086 B，96px 卡片尺寸下实测清晰
- 条目里指向 `main` 分支的 raw 链接（**别写 tag，否则发版即失效**）
- 已实测 URL：`HTTP 200, image/png, 5086 bytes`

## 六、npm 与市场的连带关系（这条容易漏）

`dsh-provider-show` **已发布 npm**（`0.1.1`，`repository` 指回本仓库，
符合 `probe-npm.mjs` 的 `linked` 判定）：

- 列表（README / 站点）：**不需要** npm 包
- `dsh-market` 与官方 Discover：走 `scripts/lib/market-index.mjs` 生成的 market index，
  **只收录有 npm 包的条目**：
  ```js
  const record = npmMap[entry.url]
  if (typeof record?.npm !== 'string' || record.npm === '') { skipped.noNpm += 1; continue }
  ```
  所以「有 npm 包」直接决定了能否进 Discover，而不只是显示下载量。

合并后 `probe-npm` 下次跑会写入 `data/npm-map.json`，随后进 market index。
**不需要也不能在 yml 里写 `npm:` 字段** —— 会被当未知字段拒掉。

### peerDependencies：保持零依赖不改

contributing 建议把官方 `@deepseek-ai/*` 声明为 `peerDependencies`，但我们刻意零依赖
（见 `lib/index.js` 顶部注释：链接安装时 profile 的 `node_modules` 里没有 Harness 包，
连 schemastery 都不敢 import）。

对照已收录同型插件：`dsh-model-provider-badge`、`dsh-balance-chip` 的
`dependencies` 与 `peerDependencies` **都是 null**，说明「inject 列表 ≠ 必须声明依赖」。
若硬要补，`>=0.2.1-rc.0 <0.3.0` 这种范围**匹配不到** `0.2.2-alpha.3`，仍会 ERESOLVE。
收益为零、风险为正，**不做**。

## 七、时间线

| 时刻 (SGT) | 事件 |
|---|---|
| ~~2026-11-04 08:2x~~ | ~~开 PR~~ ✅（#11797） |
| ~~08:46~~ | `check` 绿（19m11s） |
| ~~08:52~~ | `Submission gate` 红，仅年龄一项（当时 0.9 天） |
| ~~10:30:24~~ | 仓库满 1 天 |
| ~~10:49~~ | 推空提交 `e931531` 制造新事件 |
| ~~11:07:50~~ | `check` 绿（17m54s） |
| ~~11:08:34~~ | `Submission gate` **绿**：「Entries look good」 |
| 现在 | 等维护者评审（无评论/无 label） |

如果维护者因「与现有条目重复」提出异议，回应要点（**不要抬杠**）：
1. 承认重叠，只强调让位这一条事实差异；
2. 指 `lib/ownership.js` 与 `lib/index.js` 的分层理由（浏览器看不到 `settingsNs`）；
3. 接受「先来者保留位置」的结果 —— 判断权在维护者，不在我们。

## 八、如果被拒或要求修改

- 因**描述不准确**被打回：改 `description` 那一行，推同一分支，留**一条**评论说明改了什么即可。
  这不是对插件的否定。
- 被 `held: author` 打标：同上，推修复 + 一条评论，**不要反复推**。
  可在「Held pull requests that may have healed」跟踪 issue 自查（每日 06:19 UTC 刷新）。
- 真被拒且理由是重复：接受。列表规则写得清楚，且收录与否不代表作品评价。
