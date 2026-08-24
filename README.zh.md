<div align="center">

```
    ___  __ _  ___
   / _ \/ _` |/ _ \    dsh-ego-browser
  |  __/ (_| | (_) |
   \___|\__, |\___/    ego lite for DeepSeek Harness,
        |___/          with a memory it keeps
```

**给 dsh 浏览器 agent 的站点技能记忆。**

</div>

<p align="center"><strong>
7 个工具 · 用 ego lite 自己的 <code>learnings/</code> 格式存 · 在 dsh 0.1.1-rc.2 上验证过 · 72 个测试，不需要浏览器 · 纯 host 插件 · MIT
</strong></p>

<p align="center">
<a href="https://github.com/dshworks/dsh-ego-browser/actions/workflows/ci.yml"><img src="https://github.com/dshworks/dsh-ego-browser/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3DA639" alt="MIT"></a>
<img src="https://img.shields.io/badge/node-%E2%89%A520-5FA04E" alt="Node >= 20">
<img src="https://img.shields.io/badge/dsh-0.1.1--rc.2%20verified-1E90FF" alt="verified against dsh 0.1.1-rc.2">
</p>

<p align="center">
<a href="#它做什么">它做什么</a> ·
<a href="#上手60-秒">60 秒上手</a> ·
<a href="#凭据">凭据</a> ·
<a href="#什么时候用什么时候别用">什么时候别用</a> ·
<a href="#相关工作">相关工作</a> ·
<a href="llms.txt">llms.txt</a> ·
<a href="README.md">English</a>
</p>

---

ego lite 是一个人和 agent 共用的浏览器：agent 在自己的 Space 里干活，复用你真实的登录态，你的标签页还是你的。这个插件把它接进 dsh —— 并补上 ego 自己 README 里仍标着「即将推出」的那一半。

> *「Experience accumulation that makes your agent faster the more you use it **(coming soon)**」* —— [ego lite README](https://github.com/citrolabs/ego-lite)

读的那半边其实已经发布了：`site.learnContext`、`site.runTool`、`site.runBrowserTool` 会从 `EGO_BROWSER_AGENT_WORKSPACE` 指向的目录里加载 `learnings/`。缺的是**写**的那半边。

```
  ego_recall  ──▶  ego_run  ──▶  ego_learn  ──▶  ego_site_run
   这个 agent      一次浏览器      把跑通的那       下次一次调用，
   已经学到的      任务写一段      一步固化         而不是重新摸
   关于该站点      脚本                             一遍页面
   的东西
                        │
                        └──▶  ego_handoff —— 页面需要真人时，
                              真的去问，然后再把控制权拿回来
```

闭环就成立了。第二次抓同一个后台时，agent 调的是它上周自己写的工具，而不是重新摸一遍页面。

## 它做什么

- **动手前先回忆** —— `ego_recall` 直接从磁盘返回某个 hostname 的笔记与工具签名。不开浏览器、不加载页面、不花 token 重新摸索上个月已经跑通过的东西。
- **一次任务一段脚本** —— `ego_run` 把整个浏览器任务交给 ego 运行时的一段脚本，这正是 ego 自己 benchmark 所依据的设计。
- **把跑通的固化下来** —— `ego_learn` 把有效的一步变成真正的站点工具，用 ego 的格式存，并拒收那些活不到明天的。
- **调用学过的东西** —— `ego_site_run` 按名字调用已存工具并计数，于是没人用的工具一眼可见。
- **真的把键盘交给你** —— `ego_handoff` 弹出真正的 dsh **Continue / Finish task** 提示 —— 这正是 ego 自己的 hard-stop 文案在向 harness 要的东西 —— 你说继续，它才把控制权拿回来。
- **告诉模型你装的是哪一代 ego** —— `ego_doctor` 探测已安装的命令，而不是相信文档，因为同一个命令名后面有两套互不兼容的运行时。
- **一开始就不是空的** —— 首次启动时，store 会继承你机器上已有 ego skill 的 `learnings/`。

## 它怎么工作（30 秒）

```
  dsh agent
     │  ego_run / ego_site_run                    ego_recall / ego_learn
     ▼                                                      │
  ┌──────────────────────────────┐                          ▼
  │ dsh-ego-browser（host 半边） │              ┌──────────────────────────┐
  │  · argv 与 helper 表面探针   │              │ learnings/<site>/        │
  │  · 脚本包装与结果归类        │─────────────▶│   manifest.json          │
  │  · 晋升闸                    │    写入      │   notes/*.md             │
  └──────────────┬───────────────┘              │   tools/*.js             │
                 │ stdin heredoc                │   browser-tools/*.js     │
                 ▼                              └──────────┬───────────────┘
          `ego-browser`                                    │ EGO_BROWSER_
                 │                                         │ AGENT_WORKSPACE
                 ▼                                         ▼
          ego lite 应用  ◀────────── 同一份 store，ego 自己也读得回去
          （你的登录态，它自己的 Space）
```

唯一的那根线就是 ego lite 应用装的 `ego-browser` 命令。这里不内嵌、不打补丁、也不启动任何浏览器。

## 上手（60 秒）

需要运行 dsh 的机器上已安装并完成 ego lite 引导（[lite.ego.app](https://lite.ego.app/)），使 `ego-browser` 在 PATH 上。

```sh
# 1. 安装 —— 构建产物已入库，不需要再构建
dsh plugin --profile web add -w github:dshworks/dsh-ego-browser

# 2. 重启 dsh

# 3. 确认装上了 —— 七个名字；如果是 [] 就是没装上
curl -s localhost:8090/dsh-ego-browser/memory | jq .tools
```

`add` 会顺手把 bundle 登记进 profile 花名册。然后让 agent 先跑一次 `ego_doctor` —— 它就是这样弄清楚该给你装的这一代 ego 写 `cliLog()` 还是 `console.log()` 的：

```
command: ego-browser   invoked as: ego-browser <<'JS'
ego runtime surface: facades (console.log / page / browser / taskSpaces); 7 helper names visible.
store: ~/.dsh/ego-browser/workspace (3 sites)
  github — github.com, *.github.com — 3 tool(s): search_repos (0x), get_open_issues (0x), get_repo_stats (0x)
  google — google.com, *.google.com, www.google.com — 2 tool(s): search_and_extract (0x), get_autocomplete_suggestions (0x)
  x-com — x.com, *.x.com, twitter.com, *.twitter.com — 3 tool(s): get_timeline_posts (0x), search_users (0x), post_from_active_element (0x)
```

*agent 还没浏览任何东西，就已经有三个站点、八个工具 —— 这是 store 把 ego 自带的东西继承了过来。*

## 凭据

**在真实 dsh 上跑过**（0.1.1-rc.2，把插件 link 进 profile 后启动）：

| 声称 | 怎么验的 |
|---|---|
| 七个工具全部注册 | `GET /dsh-ego-browser/memory` 会列出它们；tools 服务没到位时是 `[]` |
| store 会自动继承 | 启动后带着 `github`（3 个工具）、`google`（2 个）、`x-com`（3 个），来自 `~/.claude/skills/ego-browser/learnings/` |
| 我们的校验器与 ego 的格式一致 | 对 ego 自带站点报出**零问题** —— 这个方向的检查才有意义 |
| 路由有围栏 | loopback 返回 200，`Host` 指向别处返回 **403** |

**对着真实构建出的 `ego-browser` bundle** 和真实 subprocess 接缝：

| 声称 | 怎么验的 |
|---|---|
| argv 探针能找到可用形状 | 在当前 CLI 上选中裸调用，在旧版上选中 `nodejs`；两种都失败时把两次输出都报出来 |
| 表面探针准确 | 对着真实 bundle 返回 `facade` 与 `page, browser, taskSpaces, site, fetch, cdp, help` —— 与其源码完全一致 |
| 出错也不丢输出 | 抛错不会吞掉抛错前打印的内容；顶层 `return` 依然产出判定 |
| 用户接管被识别为接管 | 而不是「结果丢了」—— 见[一个命令名，两套运行时](#一个命令名两套运行时) |
| 晋升闸拦得住 | 快照 ref、错误 schema、缺失导出、无法解析的源码全部拒收，且不写入任何字节 |

```sh
npm install && npm test    # 72 个测试，不需要浏览器，约 2 秒
```

`fixtures/` 里的 CLI 替身是从 ego 自己的源码逐条转写的 —— argv 处理来自 `src/run.ts`，输出 sink 来自 `src/output-sink.ts`，helper 表面来自 `src/helpers.ts` —— 每个文件头都写明了它跟的是上游哪个文件，因为比生产环境更弱的替身什么都测不出来。

**没有验证的**：所有需要真实浏览器的路径 —— 真的加载页面、真的任务空间、真的用户接管。ego lite 是 macOS 应用，而这份代码写在 Linux 容器里。通向它的那根线对着真实 CLI bundle 端到端跑过；线那头的东西没有。请先在真机上跑 `ego_doctor`，若与本页所写不符，请带上它的输出[开 issue](https://github.com/dshworks/dsh-ego-browser/issues/new/choose)。

## 让这份记忆值钱的那道闸

`ego_learn` 会拒绝含快照 ref 的代码：

```
this is not storable yet:
  - code contains a snapshot ref (@21 / ref=21). Those are rebuilt on every
    snapshotText() call and mean nothing on the next run — re-express the step
    with a stable locator (a CSS selector, or the loc=... value from the
    snapshot) before promoting it.
```

这就是「记忆」和「一堆死选择器」的全部差别。刚跑通的脚本里**满是** `@21`，因为五秒前 agent 就是这么找到元素的。原样存下来等于什么都没存。这条规则是 ego 自己的 —— 它的校验器拒绝同一个模式 —— 在写入时就执行它，才能把「跑通过一次」变成「还能再跑」。

## 一个命令名，两套运行时

值得明说，因为任何人写 ego 集成都会碰上。

**argv 形状不稳定。** 已发布的 skill 写的是 `ego-browser nodejs <<'EOF'`；`citrolabs/ego-lite@main` 里的 CLI **完全不接受 argv**，多一个 `nodejs` 就打印用法并 **exit 2**；社区 Linux 移植则把 `nodejs` 当成空前缀吞掉。一个命令名，三种行为。

**helper 表面同样不稳定。** 一代装的是扁平全局量 —— `cliLog`、`snapshotText`、`useOrCreateTaskSpace`；另一代装的是 Playwright 风格的 facade —— `page`、`browser`、`taskSpaces`、`site`，并且用 `console.log` 取代了 `cliLog`。为其中一代写的脚本在另一代上直接 `ReferenceError`，而且靠文档解决不了：两份文档在各自的世界里都是对的。哪怕在 ego 自己仓库的 HEAD 上，`SKILL.md` 和 `references/install.md` 也互相矛盾。

所以这个插件不假设，它**问** —— 每次启动问一次，然后把答案交给模型。

**还有：输出 sink 会吃掉你的结果。** 用户把任务空间收回去时，ego 会标记 hard stop 并**丢弃脚本打印的每一行**，只留它自己的提示。任何从 stdout 里解析结果哨兵的集成，这时会什么都读不到，然后报一个「解析失败」。在这里，哨兵的**缺席本身**就是信号，这次运行会被正确归类：

```
hardStop: true —— 用户已接管该任务空间，ego 暂停了 agent。不要重试，也不要自行夺回控制权；
去问用户，等他们说继续之后用 ego_handoff 恢复。
```

## 什么时候用，什么时候别用

**适合你**，如果：你希望浏览器工作第二次做起来更便宜；你在 macOS 上装了 ego lite；你想让 agent 访问你已经登录的站点；或者你希望登录墙变成一个你能回答的提示框，而不是白白浪费一轮。

**别用**，如果：

- **你想看着 agent 浏览。** 这个插件没有观察窗。用 [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser) —— 可以直接点击操作的实时观察窗，外加一份 ego 运行时的 Linux 移植，没有 macOS 应用也能跑。
- **你不在 macOS 上。** ego lite 目前只发 macOS。同样推荐上面那个。
- **你想要细粒度的 `click` / `fill` / `scroll` 工具。** 这是故意不做的：ego 自己的 benchmark 把速度归因于「一次任务一段脚本」，堆三十个小动词等于把这个优势花掉。如果你的模型 JavaScript 写得不好，细粒度设计更适合你。
- **浏览器活儿你只做一次。** 记忆才是重点。没有重复，它相对原版 `ego-browser` skill 只是额外开销。
- **你要在 CI 里无头跑。** ego lite 是带真实 profile 的桌面应用。这时该用 Playwright 类插件。

## 七个工具

| 工具 | 作用 |
|---|---|
| `ego_run` | 在 ego 运行时里跑一段脚本。传 `url` 会先把该站点已学到的东西贴上来；传 `taskSpace` 会用正确的方言先开好任务空间。 |
| `ego_recall` | 某个 URL 的笔记与工具签名，直接读磁盘。 |
| `ego_site_run` | 按站点和名字调用已学会的工具，并记一次调用。 |
| `ego_learn` | 把跑通的一步固化成站点工具 —— 活不到明天的一律拒收。 |
| `ego_forget` | 删掉一个工具或整个站点。错的记忆比没有记忆更糟。 |
| `ego_handoff` | 交出浏览器，弹出真正的 Continue / Finish task，选 Continue 就把控制权拿回来。 |
| `ego_doctor` | 哪个 ego、哪种 argv、哪套 helper、store 在哪、里面有什么。 |

<details>
<summary><strong>store 用的是 ego 的格式，不是我们的</strong></summary>

```
<workspace>/learnings/<site-id>/manifest.json          id、name、domains、notes、tools
<workspace>/learnings/<site-id>/notes/*.md             agent 摸清楚的东西，用散文写
<workspace>/learnings/<site-id>/tools/*.js             node 工具：export async function f(ctx, args)
<workspace>/learnings/<site-id>/browser-tools/*.js     页面工具：在标签页里求值
```

这里学到的东西，在 dsh 之外的原版 `ego-browser` skill 里同样能加载，指向同一个 workspace 的其它 agent 也一样。没有私有格式，也没有需要迁出的东西。

首次启动时，如果找得到已有的 ego skill workspace，会把它的 `learnings/` 继承过来一次。只继承一次；你删掉的站点不会自己回来。

一切都在写入前校验，被拒的晋升不会改动 store 分毫：manifest 形状、域名模式、参数与返回 schema、声明的导出，以及源码语法 —— 用 `node --check` 在**进程外**解析，绝不 import，因为那段代码是写给浏览器运行时的，没有理由在 harness 进程里执行。

随时读 store：

```sh
curl -s localhost:8090/dsh-ego-browser/memory | jq
```

</details>

<details>
<summary><strong>配置</strong></summary>

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

</details>

<details>
<summary><strong>handoff 的完整流程</strong></summary>

ego 自己的 hard-stop 文案，几乎是逐字在向 harness 要这个能力：

> *「Offer the user choices like "Continue" or "Finish task" if your harness supports it」*

dsh 支持。`ego_handoff` 交出任务空间，弹出一个带这两个选项的真实 dsh 提问，选 **Continue** 后把控制权拿回来，下一次 `ego_run` 直接续上 —— 不用「你回一句 continue 我再试试」，也不会在用户还在输密码时把键盘抢走。

如果根本没人可问 —— headless、没有提问 UI，或者调用方是子 agent（harness 会用 `DELEGATED_CALLER` 拒绝而不是永远阻塞）—— 它会直说，而不是假装收到了答案。

</details>

## 相关工作

已经有两位先把 ego 接进了 dsh，两个都值得一看：

- **[Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)** —— 32 个细粒度 `ego_*` 工具，外加一个可以直接点击操作的实时观察窗，并自带 ego 运行时的 Linux 移植，没有 macOS 应用也能跑。是真下了功夫的作品，对自身局限也很坦诚；如果你要的是**看着** agent 浏览，选它。本插件不与之竞争，也不提供观察窗。
- **[Da1dr1em/dsh-ego-browser](https://github.com/Da1dr1em/dsh-ego-browser)** —— 围绕 Windows 预览宿主的三个工具：run、help、status。能跑起来的最小诚实实现。

两者都没有往 learnings store 里写东西，也都没有把 ego 的 hard stop 变成真正的提示框。这个插件补的就是这块。

还有东西本身：[**ego lite**](https://github.com/citrolabs/ego-lite)（[CitroLabs](https://github.com/citrolabs) 出品）才是这里的好点子 —— 人和 agent 共用一个浏览器，而不是用框架去驱动另一个。store 格式、临时 ref 规则、handoff 协议全是他们的；这个插件只是把它们填满。

## 贡献 · 安全 · 许可

[CONTRIBUTING.md](CONTRIBUTING.md) —— 哪些需要真实浏览器，哪些不需要。如果你手上有装了 ego lite 的 Mac，真机上的 `ego_doctor` 输出是你能提供的最有用的东西。

[SECURITY.md](SECURITY.md) —— agent 操作的是你真实的登录会话。安装前值得花两分钟看看。

MIT。ego lite 是独立发布的免费下载，遵循它自己的 MIT 许可；本仓库未内嵌其任何代码。与 DeepSeek、CitroLabs 均无关联。
