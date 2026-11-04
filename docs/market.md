# 收录到 awesome-dsh-plugin（market）

> 目标：让 `dsh-provider-show` 出现在 awesome-dsh-plugin 列表、`dsh-market` 插件市场与
> 官方 Discover 里。本文只记录**对着上游源码核对过**的结论，每条都有出处。
>
> 上游基线：`awesome-dsh-plugin/awesome-dsh-plugin` @ `1fe9aed`（2026-11-04）。

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

## 二、我们这一条的成品

```yaml
# data/plugins/MosCloud__dsh-provider-show.yml
url: https://github.com/MosCloud/dsh-provider-show
name: MosCloud/dsh-provider-show
category: ui
description:
  en: Shows which provider the composer's currently selected model belongs to, and stays silent for providers another plugin already presents.
  zh: 在 DSH 输入框展示当前所选模型所属的供应商；已被其他插件接管的供应商自动让位，不重复显示。
```

已在本地克隆的上游仓库里跑过真实校验，两项都通过：

```
readEntries()        → 解析出 8656 条，本条结构正确
validateEntries()    → (none)   # 无 schema 问题
generate-readme.mjs  → 生成两行：
  README.md    : - [MosCloud/dsh-provider-show](https://github.com/MosCloud/dsh-provider-show) - Shows which provider ...
  README.zh.md : - [MosCloud/dsh-provider-show](https://github.com/MosCloud/dsh-provider-show) — 在 DSH 输入框展示 ...
```

### 为什么是 `ui` 而不是 `model`

两条都说得通，参考已收录的邻居：

| 已收录条目 | 分类 | 做什么 |
|---|---|---|
| `huihuangdi/dsh-model-provider-badge` | `ui` | 输入框工具行显示供应商徽标 |
| `ken95573/dsh-model-show` | `model` | 在模型选择器触发器里显示 provider/model |
| `zhangyongshuai56-hub/dsh-model-picker-brand` | `ui` | 给模型选择器加 provider logo |

我们做的事是**画一个芯片**，不动模型目录、不改选型 —— 与 `dsh-model-provider-badge`
同形，所以选 `ui`。contributing.md 明确写了「分类不会成为打回理由，不贴切维护者直接改」，
不必纠结。

## 三、真正的拦路虎：三个时间/状态门槛

对着上游 gate 源码（`scripts/check-submission.mjs`）逐条核对，当前状态：

| 门槛 | 现状 | 结论 |
|---|---|---|
| `dsh.bundle` manifest | `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，文件存在 | ✅ 过 |
| 仓库满 **1 天** | 创建于 `2026-11-03T02:30:24Z`，年龄 **0.91 天** | ⏳ **唯一未过项** |
| 仓库未归档 | `archived: false` | ✅ 过 |
| 非 DSH 本体 | 是插件仓库 | ✅ 过 |
| `dsh-plugin` topic | 当前只有 `["dsh"]` | ⚠️ 需手动加（见下） |

实测 gate 结论（带真实 GITHUB_TOKEN 跑 `check-submission.mjs`）：

```
repository is 0.9 days old (needs 1) — nothing to do: this check re-runs by itself
and should clear in about 3h. No need to resubmit, push, or close and reopen;
the age bar is the only thing failing here.
```

**关键点：这一项会自己变绿，不要重开 PR。**
`regate.yml` 每 6 小时扫一次，用 `/days old/` 匹配这条文案后自动重跑。
满 1 天的时间是 **2026-11-04 10:30 (Asia/Singapore)**。

所以正确做法不是「等」，而是**现在就把 PR 开出来**，让它躺在队列里等 age 自动达标；
提前提交不会被打上任何负面标记，`gate` 的结论是快照，过期自动刷新。

### topic 要自己加

`dsh-plugin` topic 不在 CI 里强制，但 contributing.md 要求，且市场/搜索依赖它。当前只有 `dsh`：

```bash
gh api -X PUT repos/MosCloud/dsh-provider-show/topics \
  -f names[]=dsh -f names[]=dsh-plugin -f names[]=deepseek-harness \
  -f names[]=provider -f names[]=composer
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
| 测试 | 1 个 selftest | 47 个用例 + 18 项静态校验 |
| 仓库年龄 | 2026-10-14（先到） | 2026-11-03 |

**我们必须打的差异点只有一个，而且已经在描述里了：让位。**
「别人已经画了这个供应商，我们就不画」——对方没有这个行为，也没有能力做（它拿不到
`settingsNs`，浏览器侧看不到「谁注册了这个 provider」，正如 `docs/design.md` 写的分层原因）。

落实方式：
1. 描述里那句 `stays silent for providers another plugin already presents` 就是这条差异，
   而且是**可核对的事实**（`lib/ownership.js` 的 `resolveOwnership` + `shouldRender`）。
2. PR 正文里主动点名对方条目，说明差异与各自适用场景 —— 不回避、不贬低，
   只说「有重叠，差异在这一处」。维护者最反感的是装作没看见。

## 五、可选但值得做：图标与截图

### 图标（建议做）

`icon:` 只收 GitHub 托管的**位图**，`icon.svg` 会被 `iconProblem()` 直接拒掉。
已从 `icon.svg` 渲染出合规图（512px 主图 → 180px 下采样，方形、透明底、约 5KB）：

- 目标路径：`assets/icon-180.png`（放进本仓库）
- 条目里写：
  ```yaml
  icon: https://raw.githubusercontent.com/MosCloud/dsh-provider-show/main/assets/icon-180.png
  ```
- 不写则回退到作者头像，不影响收录，所以这一项纯属锦上添花。

注意 `raw.githubusercontent.com` 上的 **main 分支**路径，别写成 tag，否则发版即失效。

### 截图（可选）

`package.json` 旁边放 `screenshots.json`，1–8 张相对路径（不能 `/` 开头、不能含 `..`）。
当前仓库**没有任何截图资产**，而生成截图需要一个能跑的 DSH + 真实 provider 配置，
不适合在 CI 里造假。建议**先不做**，等收录后再补一张真实输入框截图即可 ——
补这个不需要再提 PR，推自己仓库就行。

## 六、npm 与市场的连带关系（这条容易漏）

`dsh-provider-show` **已经发布到 npm**（`0.1.1`，`repository` 指回本仓库，符合
`probe-npm.mjs` 的 `linked` 判定），这是好事，但机制要说清楚：

- 列表（README / 站点）：**不需要** npm 包
- `dsh-market` 插件市场与官方 Discover：**走的是另一份数据**
  `scripts/lib/market-index.mjs` 生成的 market index，它**只收录有 npm 包的条目**：

  ```js
  const record = npmMap[entry.url]
  if (typeof record?.npm !== 'string' || record.npm === '') { skipped.noNpm += 1; continue }
  ```

  所以「有 npm 包」直接决定了我们能不能进 Discover，而不只是显示下载量。

- 我们这条已经满足：包名 `dsh-provider-show`，`latest` = `0.1.1`，`repository.url` =
  `git+https://github.com/MosCloud/dsh-provider-show.git`。合并后 `probe-npm` 下次跑就会
  把它写进 `data/npm-map.json`，随后进 market index。

**不需要也不能在 yml 里写 `npm:` 字段** —— 那会被 `validateEntries()` 当未知字段拒掉。

### peerDependencies 的取舍

contributing 建议把官方 `@deepseek-ai/*` 声明为 `peerDependencies`。我们
`dsh.client.inject` 里列了两个包，但 `package.json` **没有任何依赖**，这是刻意设计
（见 `lib/index.js` 顶部注释：链接安装时 profile 的 `node_modules` 里没有 Harness 包，
所以连 schemastery 都不敢 import）。

对照已收录的同型插件，`dsh-model-provider-badge`、`dsh-balance-chip` 的
`dependencies` 与 `peerDependencies` **都是 null** —— 说明「inject 列表 ≠ 必须声明依赖」，
社区主流做法与我们一致。**结论：保持零依赖，不改。**

如果要补，唯一安全的写法是显式预发布分支（contributing 专门警告过坑）：

```json
"peerDependencies": {
  "@deepseek-ai/dsh-client-ui-conversation": ">=0.2.1-rc.0 <0.3.0",
  "@deepseek-ai/dsh-client-locale": ">=0.2.1-rc.0 <0.3.0"
}
```

但 `>=0.2.1-rc.0 <0.3.0` 这种范围**匹配不到** `0.2.2-alpha.3`，仍会 ERESOLVE。
收益为零、风险为正，不做。

## 七、执行清单

```bash
# 0. 先补 topic（现在就能做）
gh api -X PUT repos/MosCloud/dsh-provider-show/topics \
  -f names[]=dsh -f names[]=dsh-plugin -f names[]=deepseek-harness \
  -f names[]=provider -f names[]=composer

# 1. 在自己仓库加图标（可选，建议做）
#    把 assets/icon-180.png 提交到 main

# 2. fork 上游并开分支
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin && git checkout -b add/dsh-provider-show

# 3. 只加这一个文件（按第二节内容）
#    data/plugins/MosCloud__dsh-provider-show.yml

# 4. 本地自检（可选，与 CI 同源）
npm ci && node scripts/generate-readme.mjs --check
#    —— 但更省事的做法是**不提交生成的 README**，
#       PR 只带 data/plugins/ 一个文件，CI 会自己重新生成

# 5. 提交并开 PR
git add data/plugins/MosCloud__dsh-provider-show.yml
git commit -m "Add MosCloud/dsh-provider-show"
git push -u origin add/dsh-provider-show
gh pr create --fill
```

**PR 正文模板**（照抄改）：

```markdown
Adds `MosCloud/dsh-provider-show`.

Shows which provider the composer's currently selected model belongs to,
and stays silent for providers another plugin already presents.

Overlap note: `huihuangdi/dsh-model-provider-badge` (already listed, `ui`)
occupies the same `conversation.input.right` slot. The difference is the
deferral rule: this plugin resolves ownership on the Host side from the
provider's `settingsNs` and renders nothing when another plugin registered
that provider, so the two labels never stack. The badge shows the provider
unconditionally.

npm: `dsh-provider-show@0.1.1` (repository field points back at this repo).
```

## 八、时间线

| 时刻 (SGT) | 动作 |
|---|---|
| 现在 | 补 topic；可选提交图标；**开 PR** |
| 现在 +几分钟 | CI 绿；只有 age 那条红 |
| 2026-11-04 10:30 | 满 1 天，`regate.yml` 自动重跑，age 转绿 |
| 之后 | 维护者读代码，可能因撞车提出讨论 |

如果维护者因「与现有条目重复」提出异议，回应要点（**不要抬杠**）：
1. 承认重叠，只强调让位这一条事实差异；
2. 指 `lib/ownership.js` 与 `lib/index.js` 的分层理由（浏览器看不到 `settingsNs`）；
3. 接受「先来者保留位置」的结果 —— contributing 写的是「谁更好」，
   而判断权在维护者，不在我们。
