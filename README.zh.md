# dsh-ego-browser

**把 [ego lite](https://github.com/citrolabs/ego-lite) 接进 DeepSeek Harness，并给它一份能留下来的记忆。**

ego lite 是一个人和 agent 共用的浏览器：agent 在自己的 Space 里干活，复用你真实的登录态，你的标签页还是你的。这个插件把它接进 dsh —— 并补上 ego 自己 README 里仍标着「即将推出」的那一半。

> *「Experience accumulation that makes your agent faster the more you use it **(coming soon)**」* —— ego lite README

读的那半边其实已经发布了：`site.learnContext`、`site.runTool`、`site.runBrowserTool` 会从 `EGO_BROWSER_AGENT_WORKSPACE` 指向的目录里加载 `learnings/`。缺的是**写**的那半边。这个插件就是那一半。

```
ego_recall     读出这个 agent 已经学到的东西     (不开浏览器、不加载页面)
ego_run        一次浏览器任务写一段脚本
ego_learn      把刚跑通的那一步固化成可复用的站点工具
ego_handoff    页面需要真人时，真的去问用户，然后再把控制权拿回来
```

闭环就成立了。第二次抓同一个后台时，agent 调的是它上周自己写的工具，而不是重新摸一遍页面。

---

## 安装

需要运行 dsh 的机器上已安装并完成 ego lite 引导（[lite.ego.app](https://lite.ego.app/)），使 `ego-browser` 在 PATH 上。

```sh
dsh plugin --profile web add -w @dshworks/dsh-ego-browser
# 重启 dsh，然后让 agent 先跑一次 ego_doctor
```

`ego_doctor` 是最值得先调的一个：它报告装的是哪一代 ego、该怎么调用、有哪些 helper 名字、store 在哪里。

---

## 七个工具

工具列表短，理由是 ego 自己的 benchmark：复杂任务快到 2.5 倍、工具调用次数大幅下降，靠的是 agent **写一段脚本**把导航、等待、抽取、分支一次做完，而不是「调两下看一眼」的循环。再堆三十个 `click` / `fill` / `scroll` 小工具，等于把这个优势换成「看起来很全」。所以 `ego_run` 是原语，其余六个存在的理由只有一个：脚本自己做不到。

| 工具 | 作用 |
|---|---|
| `ego_run` | 在 ego 运行时里跑一段脚本。传 `url` 会先把该站点已学到的东西贴上来；传 `taskSpace` 会用正确的方言先开好任务空间。 |
| `ego_recall` | 某个 URL 的笔记与工具签名，直接读磁盘。不开浏览器、不花 token 重新摸索。 |
| `ego_site_run` | 按站点和名字调用已学会的工具，并记一次调用。 |
| `ego_learn` | 把跑通的一步固化成站点工具 —— 活不到明天的一律拒收。 |
| `ego_forget` | 删掉一个工具或整个站点。错的记忆比没有记忆更糟。 |
| `ego_handoff` | 把浏览器交给用户，弹出真正的 **Continue / Finish task**，选 Continue 就把控制权拿回来。 |
| `ego_doctor` | 哪个 ego、哪种 argv、哪套 helper、store 在哪、里面有什么。 |

---

## 让这份记忆值钱的那道闸

`ego_learn` 会拒绝含快照 ref 的代码：

```
code contains a snapshot ref (@21 / ref=21). Those are rebuilt on every
snapshotText() call and mean nothing on the next run — re-express the step with
a stable locator ... before promoting it.
```

这就是「记忆」和「一堆死选择器」的全部差别。刚跑通的脚本里**满是** `@21`，因为五秒前 agent 就是这么找到元素的。原样存下来等于什么都没存。这条规则是 ego 自己的 —— 它的校验器拒绝同一个模式 —— 在写入时就执行它，才能把「跑通过一次」变成「还能再跑」。

其余一切都在写入前校验，被拒的晋升不会改动 store 分毫：manifest 形状、域名模式、参数与返回 schema、声明的导出，以及源码语法 —— 用 `node --check` 在**进程外**解析，绝不 import，因为那段代码是写给浏览器运行时的，没有理由在 harness 进程里执行。

---

## store 用的是 ego 的格式，不是我们的

```
<workspace>/learnings/<site-id>/manifest.json          id、name、domains、notes、tools
<workspace>/learnings/<site-id>/notes/*.md             agent 摸清楚的东西，用散文写
<workspace>/learnings/<site-id>/tools/*.js             node 工具：export async function f(ctx, args)
<workspace>/learnings/<site-id>/browser-tools/*.js     页面工具：在标签页里求值
```

这里学到的东西，在 dsh 之外的原版 `ego-browser` skill 里同样能加载，指向同一个 workspace 的其它 agent 也一样。没有私有格式，也没有需要迁出的东西。

首次启动时，如果找得到已有的 ego skill workspace，会把它的 `learnings/` 继承过来一次，于是 store 一开始就带着 ego 自带的站点而不是空的。只继承一次；你删掉的站点不会自己回来。

随时读 store：

```sh
curl -s localhost:8090/dsh-ego-browser/memory | jq
```

---

## 一个命令名，两套运行时

这是别的接入普遍踩空的地方，值得明说，因为任何人写 ego 集成都会碰上。

**argv 形状不稳定。** 已发布的 skill 写的是 `ego-browser nodejs <<'EOF'`；`citrolabs/ego-lite@main` 里的 CLI **完全不接受 argv**，多一个 `nodejs` 就打印用法并 **exit 2**；社区 Linux 移植则把 `nodejs` 当成空前缀吞掉。一个命令名，三种行为。

**helper 表面同样不稳定。** 一代装的是扁平全局量 —— `cliLog`、`snapshotText`、`useOrCreateTaskSpace`；另一代装的是 Playwright 风格的 facade —— `page`、`browser`、`taskSpaces`、`site`，并且用 `console.log` 取代了 `cliLog`。为其中一代写的脚本在另一代上直接 `ReferenceError`，而且靠文档解决不了：两份文档在各自的世界里都是对的。哪怕在 ego 自己仓库的 HEAD 上，`SKILL.md` 和 `references/install.md` 也互相矛盾。

所以这个插件不假设，它**问**：

```
$ ego_doctor
command: ego-browser   invoked as: ego-browser <<'JS'
ego runtime surface: facades (console.log / page / browser / taskSpaces); 7 helper names visible.
```

两个探针各跑一次并缓存，答案直接交给模型，让它按你装的那一代写代码，而不是按文档描述的那一代。

**还有：输出 sink 会吃掉你的结果。** 用户把任务空间收回去时，ego 会标记 hard stop 并**丢弃脚本打印的每一行**，只留它自己的提示。任何从 stdout 里解析结果哨兵的集成，这时会什么都读不到，然后报一个「解析失败」。在这里，哨兵的**缺席本身**就是信号，这次运行会被正确归类：

```
hardStop: true —— 用户已接管该任务空间，ego 暂停了 agent。不要重试，也不要自行夺回控制权；
去问用户，等他们说继续之后用 ego_handoff 恢复。
```

---

## handoff 是一个真的提示框

ego 自己的 hard-stop 文案，几乎是逐字在向 harness 要这个能力：

> *「Offer the user choices like "Continue" or "Finish task" if your harness supports it」*

dsh 支持。`ego_handoff` 交出任务空间，弹出一个带这两个选项的真实 dsh 提问，选 **Continue** 后把控制权拿回来，下一次 `ego_run` 直接续上 —— 不用「你回一句 continue 我再试试」，也不会在用户还在输密码时把键盘抢走。

如果部署环境根本没法问人（headless、无 UI），它会直说，而不是假装收到了答案。

---

## 配置

所有字段可选。

| 字段 | 默认 | 含义 |
|---|---|---|
| `bin` | `ego-browser` | 命令。不在 PATH 上时填绝对路径。 |
| `workspace` | `~/.dsh/ego-browser/workspace` | 学到的站点存放处。指向已有的 ego skill 目录即可共用同一份 store。 |
| `seed` | `true` | 首次启动时继承已有 ego workspace 的 `learnings/`。 |
| `cwd` | harness cwd | `ego-browser` 进程的工作目录。 |
| `extraArgs` / `env` | `[]` / `{}` | 追加到每次调用。 |
| `timeoutMs` | `120000` | 单次脚本的时限。 |
| `probeTimeoutMs` | `20000` | 能力探针的时限。 |
| `maxOutputBytes` | `1048576` | 保留的脚本输出；超出保留尾部。 |
| `route` | `true` | 在 `/dsh-ego-browser/memory` 提供 store。 |
| `trustedHosts` | `[]` | 除 loopback 外允许读该路由的 authority。 |

只有 `subprocess` 是硬依赖。`tools` 和 `webServer` 存在时才接管，所以 headless profile 也能干净加载，只是没有路由。

---

## 哪些验证过，哪些没有

说实话，因为一个吹过头的浏览器插件比没有更糟。

**在这里验证过**（对着真实构建出的 `ego-browser` bundle 和真实 subprocess 接缝，66 个测试，`npm test`）：

- argv 探针在两代上都能选中可用形状，两种都失败时把两次的输出都报出来
- 表面探针对着真实 bundle 返回 `facade` 与 `page, browser, taskSpaces, site, fetch, cdp, help` —— 与其源码完全一致
- 脚本能跑、输出原样返回、抛错不会吞掉抛错前打印的内容
- 顶层 `return` 依然产出判定
- hard stop 被识别为 hard stop，而不是「结果丢了」
- store 闭环：写入、召回、计数、校验、遗忘
- `ego_learn` 拒收快照 ref、错误 schema、缺失导出、无法解析的源码 —— 每一种都不写入任何字节
- memory 路由接受 loopback，拒绝被重绑定的 Host 和跨站读

**没在这里验证的**：所有需要真实浏览器的路径 —— 真的加载页面、真的任务空间、真的用户接管 —— 因为 ego lite 是 macOS 应用，而这份代码写在 Linux 容器里。通向它的那根线是端到端跑过的；线那头的东西没有。请先在真机上跑 `ego_doctor`，若与本文所写不符，请带上它的输出开 issue。

---

## 相关工作

已经有两位把 ego 接进了 dsh，如果这个不合你的需求，它们值得一看：

- **[Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)** —— 32 个细粒度 `ego_*` 工具，外加一个可以直接点击操作的实时观察窗，并自带 ego 运行时的 Linux 移植，没有 macOS 应用也能跑。如果你要的是**看着** agent 浏览，选它。本插件不与之竞争，也不提供观察窗。
- **[Da1dr1em/dsh-ego-browser](https://github.com/Da1dr1em/dsh-ego-browser)** —— 围绕 Windows 预览宿主的三个工具：run、help、status。

两者都没有往 learnings store 里写东西，也都没有把 ego 的 hard stop 变成真正的提示框。这个插件补的就是这块。

---

## 许可

MIT。ego lite 是 [CitroLabs](https://github.com/citrolabs/ego-lite) 独立发布的免费下载，遵循它自己的 MIT 许可；本仓库未内嵌其任何代码。

与 DeepSeek、CitroLabs 均无关联。
