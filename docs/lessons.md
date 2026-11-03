# 开发经验与踩坑记录

> 范围：为 DSH（DeepSeek Harness）开发插件。本文只记录**在这个项目里真实发生过**的问题，
> 每条都带根因与可执行的防法；没有发生过的不写。
>
> 阅读顺序建议：要动手改代码先看[一](#一插槽与生命周期);要在没有浏览器的环境里自证看[二](#二验证方法论);
> 要发版看[四](#四发布流程)。

---

## 零、先读源码，别猜

这个项目里最省时间的一件事，是把 DSH 安装包里的源码解出来读，而不是从行为反推。

```bash
# app.asar 在 Electron 应用内，shell 无法直接 cd 进去，但可以按字节解包
# 解包后每个包都有 lib/*.js（构建产物，含注释）、README、locale
```

三条信息渠道，优先级从高到低：

| 渠道 | 用途 | 例子 |
|---|---|---|
| `cordis_inspect_query` | 活的运行时事实：Service 方法签名、插槽拓扑与占用者、主题 token、插件 Config schema | `Slots.listSubTree` 查出 `conversation.input.model.label` 已被 WorkBuddy 以 `priority: -0.5` 占位 |
| 安装包内源码 | 静态事实：CSS 具体数值、渲染顺序、字段语义 | `.htuFrW_trigger{height:28px;font-size:13px;…}` |
| 第三方插件源码 | 生态惯例：别人怎么解决同类问题 | WorkBuddy 的 `MODEL_LABEL_PRIORITY = -0.5` 注释解释了为什么不能用 0 |

**教训**：本项目早期关于「中文标签偏高」的错误结论，就是因为先靠字模推算、没去读真实渲染结果。
凡是能用实测数据回答的问题，不要用推理回答。

---

## 一、插槽与生命周期

### 1.1 `apply()` 的返回值会被丢弃

```js
// ❌ 路由注册了，且永久泄漏
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    return scope.webServer.register({ kind: 'exact', path, handler })
  })
}

// ✅ 只有 effect 的 disposer 会在卸载时执行
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({ kind: 'exact', path, handler }), 'route')
  })
}
```

**现象**：插件卸载后路由仍在应答。**根因**：cordis 只执行 `ctx.effect` 返回的 disposer，插件回调的返回值不是 disposer。
**防法**：`scripts/verify.mjs` 有一条检查，出现 `return webServer.register(` 直接判红。

### 1.2 服务要用 `ctx.inject` 等，不要用 `ctx.get` 探一次

```js
// ❌ 激活时 webServer 可能还没就绪 → 路由永远不注册，且没有任何报错
const webServer = ctx.get('webServer')
if (webServer === undefined) return

// ✅ 服务出现时才执行
ctx.inject(['webServer'], (scope) => { … })
```

**根因**：组合期服务的激活顺序不保证。**症状是静默失效**——这比抛错难查得多。

### 1.3 `single` 槽是独占的，抢格会抛错

`conversation.input.model.label` 是 `single` 槽，同优先级二次注册直接抛
`already has a registration at priority 0`。WorkBuddy 用 `-0.5` 避开，并显式声明
「不做插件联动、对非自家 provider 只回退纯目录名」。

**做法**：需要"叠加"而非"替换"时，选 `list` 槽（`conversation.input.right` 的 `replaceRisk: none`），
用独有 id 注册。**不要为了局部装饰去抢 `single` 槽**——那会把别人的显示顶掉。

### 1.4 列表槽的渲染顺序由 JSX 决定，`order` 只影响同槽内排序

`input.right` 与 `input.model` 是 `.standardControls` 的两个子节点，顺序即左→右，
中间隔 12px（宿主 `gap`）。想贴紧模型名，只能用负 `margin` 对冲，改不了宿主 CSS。

---

## 二、验证方法论

没有浏览器控制权时，仍然可以做到很高置信度。本项目的做法按价值排序：

### 2.1 纯逻辑抽成无依赖模块

`lib/ownership.js` 不 import 任何东西，于是可以用 `node --test` 直接跑，
Host 半和 Client 半共用同一份实现。**这是本项目最划算的一个结构决定**。

### 2.2 用"真实输入"喂组件，而不是只断言字符串

Client 组件在 Node 里跑真实 `lib/client.js`（桩掉 React 与 DOM），
输入用**本机真实 Host 路由返回的文档**。断言它渲染出 `<span>火山API</span>`、
对 WorkBuddy 返回 `null`。

### 2.3 每条新断言都要"反证"

写完之后**故意改坏代码**，确认检查会红。本项目做过的反证：

| 破坏方式 | 期望 |
|---|---|
| 样式里改回硬编码颜色 | 主题 token 检查红 |
| 把槽位改成 `conversation.input.model.label` | 槽位检查红 |
| 删掉真实 `font-size:13px`，只在注释里提一句 | 排版检查红（**这条逼出了校验器自身的漏洞**） |
| 重新插入 `translateY(1px)` | 反向防护红 |
| 删掉 `hide` 分支 | 行为测试红 |

### 2.4 校验器自己也会错

最初 `chipCss()` 把 CSS 代码块里**所有单引号字符串**拼起来当样式，
于是**注释里写到** `font-size:13px` 就能让检查通过。修法是先剥注释再提取。

**教训**：校验器是代码，也要被质疑。凡是"从此再也不会发生"的保护，都必须先证明它**能拦住**。

### 2.5 桩要模拟真实生命周期

React 桩最初在多次挂载间保留 state，导致"数据到达前不渲染"的断言形同虚设
（第二次挂载直接带着上次的 state 进入）。桩必须复现：新挂载 = 空 state。

### 2.6 视觉争议用像素解决，不要用形容词

「中文偏低了」→ 用 2 倍截图逐块量墨迹质心（1 CSS px = 2 图像 px）：

| 文字块 | 质心 |
|---|---|
| `火山` | 33.12 |
| `DeepSeek` | 29.80 |
| `Flash` | 28.90 |

拉丁均值 29.4，汉字 33.12 → 低 1.85 CSS px。**一句话把"感觉"变成可验证的数字**，
并直接证伪了我此前"必须给中文加补偿"的结论。

---

## 三、归属判定与配置

### 3.1 一个决策表只能有一个读者

`overrides` 最初被 `resolveOwnership` 和 `shouldRender` 各读一次，
两处逻辑一旦不同步就会给出矛盾结论（测试当场发现）。
**做法**：所有决策在 `resolveOwnership` 里做完，结果挂在 decision 对象上
（`owner` / `hidden`），下游只读结果。

### 3.2 文档写了但没实现，是真实缺陷

`hide` 覆盖值在配置说明里存在、在代码里没实现，靠行为测试才暴露。
**做法**：每个配置项都要有一条对应的测试。

### 3.3 探测失败要选"错误代价更小"的方向

供应商归属判定在拿不到目录时**默认显示**（fail-open）。
理由是不对称：漏显只是信息不全（与插件没装一样），误判为"已接管"会让**所有**供应商都不显示。
**通用原则**：先问"两种错误各付什么代价"，再决定默认值。

### 3.4 配置要能承受"整体替换"

`cordis.patch.yml` 里写一处 `config` 会替换整个 `config` 对象。
所以每个字段都必须能独立取默认值，不能假设兄弟字段存在。

---

## 四、发布流程

### 4.1 本地链接式安装会改变模块解析

本地目录安装是 `link:`，Node 从**真实路径**向上找 `node_modules`，
那里没有 profile 的依赖。所以：

> **Host 半不要 import 任何 Harness 包或第三方运行时包。**
> 一个 `import Schema from '@deepseek-ai/schemastery'` 就会让整个 Host 半加载失败。

本项目因此把配置改成纯数据描述（`CONFIG_KEYS` + `effectiveConfig`），不导出 `Config`。
Loader 在没有 `Config` 时原样透传配置，默认值由插件自己补。

### 4.2 npm 发布三个必查项

| 项 | 症状 |
|---|---|
| `private: true` | `npm publish` 直接拒绝 |
| registry 指向镜像 | 本机用 `npmmirror`（只读），必须 `publishConfig.registry` 固定官方源 |
| 2FA（auth-and-writes） | `EOTP`，且 npm 12 会在日志里把认证 URL 脱敏成 `***`，agent 无法代办 |

### 4.3 npm 12 的暂存发布会让你误判

时间线（实测）：

```
T+0    0.0.0-stage 占位版创建（339 B，2 文件）
T+76s  0.1.0 真正落库（46.1 kB，10 文件）
```

**在中间态查询会得出"只发了个占位包"的错误结论**。发布后要按**最终态**复核，
并直接查版本文档而非只看 dist-tag：

```bash
curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/<pkg>/<version>
```

### 4.4 发布后要做端到端验证，而不是只看输出

```bash
mkdir /tmp/t && cd /tmp/t && npm i <pkg>
node -p "require('./node_modules/<pkg>/package.json').version"
node -e "import('<pkg>').then(m => console.log(Object.keys(m)))"
```

### 4.5 发版清单

按顺序执行，每步都有对应检查：

1. `npm run check` 全绿（CI 会在推送后再验一遍）
2. 更新 `package.json` 的 `version`（`npm version patch --no-git-tag-version`）
3. 同步文档：**npm 页面上的 README 是打包时的快照**，`docs/` 按 `files` 不随包发布；
   若 README 或包元信息在此版本后有变动，本次发版会一并同步
4. `npm publish`（2FA 需本人操作，agent 无法代办）
5. 按 4.3 复核最终态，按 4.4 端到端验证
6. `git tag vX.Y.Z && git push origin vX.Y.Z`
7. `gh release create vX.Y.Z --generate-notes`（或手写要点，首版建议手写）

**为什么要单独写第 3 步**：`dsh-provider-show@0.1.0` 发布后，仓库里的 README 又改过
（补了 npm 安装说明、精简了结构），而 npm 页面仍显示 0.1.0 打包时的版本。
这类漂移不影响功能，但会让人以为安装方式没更新。惯例是**不为纯文档改动单独发版**，
攒到下次有实质改动时一起同步。

---

## 五、可复用的项目骨架

本项目形成的结构，下次开同类插件可以直接照搬：

```
lib/ownership.js   纯逻辑，零依赖，Host/Client 共用，可单元测试
lib/index.js       Host 半：读运行时事实 → 决策 → 只读 GET 路由（/plugins/<pkg>/<name>）
lib/client.js      浏览器半：只做查表渲染，不含业务规则
scripts/verify.mjs 静态校验：manifest / 图标 / 文案 / 槽位 / 样式 / 生命周期形态
test/*.test.mjs    行为测试：纯逻辑、Host 路由、Client 组件
.github/workflows  零依赖 CI（本包无依赖，无需 install 步骤）
```

**分层原则**：浏览器看不到的运行时事实（如 `settingsNs`）放在 Host 决策，
客户端只消费结论。这样规则只有一份，不会自我漂移。

---

## 六、这个仓库里，什么在守什么

| 机制 | 守住的东西 |
|---|---|
| `scripts/verify.mjs`（23 项） | 结构性事实：manifest 完整、图标合法、客户端不走 Harness 包、判定规则只有一份实现、路由形态正确、排版度量与宿主一致、**禁止位移补偿** |
| `test/ownership.test.mjs` | 归属判定的边界：未知/不可读/无命名空间/覆盖/扩展内置名单 |
| `test/host.test.mjs` | Host 半行为：可见性决策、路由方法与外源拒绝、注册表异常降级、卸载清理 |
| `test/client.test.mjs` | 客户端渲染：可见、让位、短名、无选中、Host 不可达、样式只用 token |
| CI（Node 22/24） | 跨版本、跨平台一致性；证明检查不依赖本机偶然环境 |

---

## 七、一句话总结

1. **读源码，别猜**；能用实测回答的，不要用推理。
2. **证据先行**：先拿到行号、数值、截图数据，再下结论。
3. **每条防护都要反证**；校验器本身也可能是错的。
4. **一个决策只有一个读者**。
5. **失败方向选代价小的那个**。
6. **发布后按最终态复核**，中间态会骗人。
