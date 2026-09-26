---
name: wyy-rate
description: 自动完成网易云音乐「音乐合伙人」当日评定任务——每日任务 5 首 + 加评 15 首，共 20 首；每首播放满 15 秒后总评 3 星、小项（旋律/演唱/歌词）随机 2~4 星，逐首提交，最后核对本期积分。用户说「评定」「打分」「合伙人任务」「跑一下评定」时使用。
allowed-tools:
  - Read
  - Write
  - Bash(open -b com.google.Chrome)
  - Bash(~/.claude/skills/wyy-rate/reset-zoom.sh)
  - Bash(osascript:*)
  - Bash(nohup caffeinate:*)
  - Bash(pkill caffeinate)
  - Bash(mkdir -p ~/.config/wyy-rate)
  - Bash(cat ~/.config/wyy-rate/config.json)
  - mcp__claude-in-chrome__list_connected_browsers
  - mcp__claude-in-chrome__tabs_context_mcp
  - mcp__claude-in-chrome__tabs_create_mcp
  - mcp__claude-in-chrome__tabs_close_mcp
  - mcp__claude-in-chrome__navigate
  - mcp__claude-in-chrome__computer
  - mcp__claude-in-chrome__javascript_tool
  - mcp__claude-in-chrome__browser_batch
  - mcp__claude-in-chrome__read_page
  - mcp__claude-in-chrome__find
---

# 音乐合伙人 自动评定

用 Claude in Chrome 驱动网页完成当天评定。**每天上限 20 首 = 每日任务 5 首 + 加评 15 首**；
积分：前 5 首合计约 +8 分，加评每首 +1 分。

## 配置文件与首次使用（在哪个目录调用都一样）

本 skill 装在 `~/.claude/skills/wyy-rate/`，**不依赖当前工作目录**，也不依赖任何项目记忆。
需要跨次保存的东西只有一份：`~/.config/wyy-rate/config.json`。

```json
{
  "appId": "68429fb40fd3640105f60c9a",
  "defaults": { "songs": 20, "overall": 3, "subMin": 2, "subMax": 4, "listen": 15 },
  "savedAt": "2026-09-26",
  "lastRun": { "date": "2026-09-26", "result": "success", "done": 20, "before": 272, "after": 295 }
}
```

**第 0 步（每次都做）**：`cat ~/.config/wyy-rate/config.json`。
- 有 → 用里面的 `appId` 和 `defaults`（调用时给的 flag 优先于 `defaults`），直接进「执行步骤」，**不问任何问题**。
- 没有（报 No such file）→ 本机第一次用：先按「执行步骤」第 1 步把 Chrome 连上，再弹下面的**三选一**。

### 三选一（首次使用、以及之后任何一次需要登录时）

用户 2026-09-26 定的规则：**第一次运行给三个选项；第二次起全自动、一个问题都不问；
只有后来又需要他登录时，才再次出现同样的三个选项。**

用 `AskUserQuestion` 弹出（header「开始方式」，单选）：

| 选项 | 说明文字 | 之后怎么做 |
|---|---|---|
| **我自己打开网页** | 你在 Chrome 里打开网页版「音乐合伙人」并登录好，我识别到就接手 | 见下面 A |
| **我把网址发给你** | 你从 App「音乐合伙人 → 分享 → 复制链接」复制网址发给我，我来打开；要扫码时我把登录页亮给你 | 见下面 B |
| **退出** | 这次先不评 | 按「结束汇报」输出 `❌ 评定失败：用户选择退出，今天 0 首`，收尾后结束 |

**A. 他自己打开网页**：回一句「好，打开并登录好就行，我识别到会自动开始」，然后**不结束回合**，
每 5 秒查一次（`browser_batch` 里 wait + Bash），最多等 5 分钟：
- macOS：`osascript -e 'tell application id "com.google.Chrome" to get URL of tabs of windows'`，
  在结果里找 `mp.music.163.com/<24 位十六进制>/`（0 个窗口时这条会报 `Can't get URL of tabs of every window`，当没找到）。
  找到了取那一段当 `appId`；非 macOS 就在任务标签里用 `tabs_context_mcp` 看有没有这样的地址。
- 找到后**在自己的任务标签里**打开第一批网址（同一个 Chrome，cookie 是同一套），按 2.1 查登录：
  已登录 → 写配置、开跑；仍是登录页 → 说「还没登录，请在那个网页里扫码登录」，继续按 A 等。
- 5 分钟没等到 → `❌ 评定失败：未等到网页打开（原因），今天 0 首`，收尾。他再调一次就会重新出三选一。

**B. 他把网址发过来**：回一句「请把网址直接发给我」，然后**结束回合等他回复**（这是唯一允许等回复的地方）。
- 从他发来的文字里取 `mp.music.163.com/<24 位十六进制>/` 的那一段当 `appId`；
  短链（`163cn.tv/...` 之类）先在任务标签里打开，跟随跳转后从 `location.href` 取。
- 取不到 → 说明「没认出网址，请发『音乐合伙人』页面的分享链接」，再等一次；还不行就用内置默认 appId。
- 打开第一批网址；落到登录页 → 走 2.1 的**扫码等待**（把 Chrome 亮到前台、每 10 秒查、最多 3 分钟），**不再重复弹三选一**。

**两条路都一样**：拿到 appId 且确认已登录后，`mkdir -p ~/.config/wyy-rate` 再用 `Write` 写 `config.json`
（`defaults` 用本文默认值：20 首 · 3 星 · 小项 2~4），汇报里带一句「已保存，以后直接 `/wyy-rate`」。
**不要停在这里，接着把今天的评定跑完。**

内置网址打开后 404 / 白屏 → 再弹一次三选一，拿到的新 appId 覆盖进配置。

用户中途说「改默认 4 星」「网址换成 xxx」这类 → 更新 `config.json` 对应字段。

## 网址

页面由 `BASE` 决定，`BASE` 是「音乐合伙人」小程序页面的地址前缀：

```
BASE = https://mp.music.163.com/<appId>/
```

- 优先级：调用时给的网址/appId ＞ `config.json` 的 `appId` ＞ 默认值。调用时给了新的就顺手写回 `config.json`。
- 都没有就用默认值 `68429fb40fd3640105f60c9a`（2026-09 实测可用），**不要以为它是每天变的，它是小程序发布号**。
- **有配置文件时绝不要让用户自己开页面、也不要问他要网址。** 直接开 URL 就行；
  只有首次使用、需要登录、或默认值和备用 appId 都打不开时，才弹「三选一」。
- 默认值 404 / 白屏时先试备用 appId：`605ab15bcc23b01f8e8a2dfb`；也打不开再弹「三选一」。

三个要用的地址：

```
第一批 5 首   {BASE}mission/index.html?isH5=1&fromStudio=0&from=homeAss
第二批 15 首  {BASE}mission/index.html?isH5=1&fromStudio=0&from=homeAss&isContinue=1
主页(核对分)  {BASE}home/index.html?isH5=1
```

## 前置条件

- Chrome 已安装 Claude in Chrome 扩展并连接。
- **该 Chrome 里已登录网易云音乐**（登录 `music.163.com` 即可，页面走同一套 cookie）。
  没登录/登录过期时评定页会跳到 `music.163.com/#/login` 二维码页 —— 按「执行步骤」2.1 弹三选一，不要代填账号密码。
- 账号本身得是音乐合伙人，否则没有任务。

## 调用参数

用户在 `/wyy-rate` 后面跟简短的 flag，`key value` 和 `key=value` 两种写法都认，顺序任意，
大小写不敏感；没给的用 `config.json` 里的 `defaults`，再没有才用下表默认值。用户用自然语言说（「只评 5 首」「总评打 4 星」）也照做。

```
/wyy-rate                          # 默认：20 首，总评 3 星，小项 2~4 星
/wyy-rate song 5                   # 只评 5 首
/wyy-rate star 4                   # 总评 4 星
/wyy-rate song 10 star 4           # 组合
/wyy-rate sub 3-5                  # 小项随机区间改成 3~5 星
/wyy-rate listen 20                # 每首至少听 20 秒
/wyy-rate dry                      # 只打星不提交（验证页面没改版）
/wyy-rate url <评定页网址>          # 指定自己的网址（或 appId <十六进制串>）
```

| flag | 别名 | 对应 `__nmp.start()` 参数 | 默认 | 说明 |
|---|---|---|---|---|
| `song N` | `songs`, `s` | `songs` | 20 | 评几首 |
| `star N` | `stars` | `overall` | 3 | 总评星数（1~5） |
| `sub A-B` | `subs` | `subMin`/`subMax` | 2-4 | 小项随机区间；写 `sub 3` 表示固定 3 星 |
| `listen N` | — | `listen` | 15 | 每首最少播放秒数 |
| `dry` | `dryrun` | `dryRun:true` | false | 只打星不提交 |
| `mute off` | — | `mute:false` | true(静音) | 让它出声 |
| `url <网址>` | `appid <id>` | — | 见上文 | 覆盖 `BASE` |

参数非法时（比如 `star 9`、`song 50`）不要瞎猜：按上限截断并在汇报里说明，或直接问用户。
今日上限是 20 首，`song` 超过 20 时提醒用户多出来的评不了。

## 执行步骤

1. `list_connected_browsers` 确认 Chrome 在线。**返回空数组时自己把浏览器叫起来，不要让用户动手**：
   - macOS：先跑同目录 `reset-zoom.sh`（Chrome 没开时把该域的页面缩放恢复成 100%，开着就自动跳过），
     再 `open -b com.google.Chrome`（没开就启动；开着但扩展 service worker 睡了，激活一下也会重连）
   - Windows：`start chrome`；Linux：`google-chrome &`
   - 然后重新 `list_connected_browsers` 复查，最多重试 3 次（每次调用本身就有几秒间隔）。
   - 仍连不上才找用户，并说明可能原因：机器刚休眠/锁屏、扩展被禁用、或没登录 claude.ai。
     机器休眠这一类我这边修不了，只能请用户唤醒电脑。
   连上后 `tabs_context_mcp{createIfEmpty:true}` 取 tabId。**每次会话重新取 tabId，不要复用旧的。**
2. 打开**第一批**网址，等 5~7 秒。
2.1 **登录检查**：`location.href` 含 `music.163.com/#/login`、或页面文字有「扫码登录」→ 登录态没了（第一次用或 cookie 过期，
   09-24 真遇到过）。这是唯一必须用户本人做的事：
   - **弹「三选一」**（见上文）。选 A → 按 A 等他自己打开并登录；选 B → 拿到网址后走下面的扫码等待；选「退出」→ 按结束汇报退出。
   - **扫码等待**（选 B 之后撞上登录页时）：
     `osascript -e 'tell application id "com.google.Chrome" to activate'` 把登录页亮给他（此时他反正要动手，抢前台是对的），
     然后说一句：「请在弹出的 Chrome 里用网易云 App 扫码，扫完我会自动继续。」
     **不要结束回合等回复**：每 10 秒查一次 `location.href`（`browser_batch` 里 3 个 10 秒 `wait` + 一次 JS），
     离开 login 页或 `document.cookie` 出现 `MUSIC_U` 就算登上，重新打开第一批网址往下走；最多等 3 分钟。
   - 等超时 → 按「结束汇报」报 ❌ 失败（原因：未登录），收尾关标签。他再调一次会重新出三选一。
   - 登上了但页面显示没有任务 / 不是合伙人 → 报 ❌ 失败（原因：账号不是音乐合伙人），不要反复重试。首次可能有公告弹窗，「我知道了」常在可视区外，用 JS 点：
   `[...document.querySelectorAll('div,span,p,button,a')].find(e=>e.children.length===0&&e.textContent.trim()==='我知道了')?.click()`
2.4 **先确认页面真的可见**：`{hidden:document.hidden, raf:1 秒内 rAF 次数, outerWidth, outerHeight, screenY}`。
   2026-09-26 实测：Chrome 0 窗口时扩展新建的窗口只有 235×110、`screenY` 等于屏幕高度（落在屏幕外）→ 必然 hidden。
   看到 `outerWidth < 400` 或 `screenY >= screen.height` 就先
   `osascript -e 'tell application id "com.google.Chrome" to set bounds of window 1 to {100, 80, 1380, 880}'` 拉回正常大小。
   `hidden:true` 或 rAF=0 → 窗口被遮挡，媒体一个字节都不会加载，见「窗口被遮挡时媒体根本不加载」。
2.5 **解锁自动播放**：截图拿坐标系尺寸 → 执行 `window.__NMP_FRAME=[W,H];` + 同目录 `unlock.js` 全文
   → 返回的 `frame` 就是坐标 → `computer left_click` 点它
   （见下面「必做的前置手势」，不做这步必卡；坐标必须算，不能写死）。
   **`unlock.js` 返回 `activated:true` 就不用点了**（sticky activation 已在）—— 09-24、09-25 两天
   driver 自己跳到 `isContinue=1` 后都是 `true`，同源跳转把激活态带过去了。第一批新开页面必然是 `false`，要点。
2.6 + 3. **`cdn-patch.js` 和 `bot.js` 拼在一次 `javascript_tool` 里注入**（补丁在前），见「某个 CDN 节点整个是死的」。
   返回 `wyy-rate driver ready`（有存档时带 `auto-resuming: …`）。两个都是幂等的，重复注入安全。
   **三个 .js 都是读文件原样注入，不要照着本文档的描述现写** —— 2026-09-23 现写的 CDN 补丁就缩了水。
4. 按上面的 flag 拼出配置，**一次就把 20 首全下去**：`__nmp.start({songs:20, overall:3})`（异步，立即返回）。
   不要分两次跑、也不要跑完 5 首就回来问用户要不要继续 —— 5 首和 15 首是一趟活。
5. 轮询 `__nmp.status()` 直到 `running:false`。一首约 20 秒，20 首约 7 分钟。
   **轮询用 `browser_batch` 里最多 3~4 个 10 秒 `wait`（≈30~40 秒）**，60 秒的批次会把工具等超时。
6. 评完 5 首后会弹「评定完成」页，driver 先自己点「继续评定」；点不动时（那是 App 路由）
   driver **自己跳到 `isContinue=1` 的网址**并把进度存进 `localStorage`。
   这时 `__nmp` 没了（换页脚本就清空），`javascript_tool` 会报 `__nmp is not defined` 或
   `status()` 拿不到 —— **别当成失败，也别问用户**：
   **先跑一次 `unlock.js`**，`activated:false` 才补点击（实测换页后通常还是 `true`），再重新注入 `cdn-patch.js` + bot.js，
   注入返回里会带 `auto-resuming: 5 done, 15 left`，它自己接着跑。整个过程中途不需要用户任何操作。
7. **先在评定页把 `__nmp.detail` 取出来**（一开主页就没了），再打开主页核对「本期积分」，并汇报：评了几首、每首的歌名/总评/小项分/实际听了几秒（`__nmp.detail`）、
   当前积分、卡了几次。**`listened` 明显不到 15 秒的那首要解释**：门禁本来就满足，还是页面没切歌导致的重复提交
   （后者积分会少 1；2026-09-21 踩过，`bot.js` 提交后已等总评星归零才往下走）。
   （09-24 两批第 1 首都记成 0 秒，是 cdn-patch 改写好节点协议导致重载，已修；09-25 起第 1 首会记成注入前已播的秒数，比如 27。）
   `subs` 为空也出现过（09-24 第 5 首，那首是页面「替换新歌曲」换来的），积分照样 +1、是被接受的。换页后 `__nmp.detail` 会从存档接上，不会丢前 5 首。
7.5 把本次结果写回 `config.json` 的 `lastRun`（成功、失败都写），然后按「结束汇报」输出。
8. **收尾**：`tabs_close_mcp` 关掉任务标签（MCP 标签组随之消失，不留已保存的组）；
   Chrome 是本流程第 1 步自己 `open -a` 起来的 → 直接退出 Chrome（`osascript -e 'tell application id "com.google.Chrome" to quit'`）；
   退出后再跑一次 `reset-zoom.sh`（保证下次打开是 100%）；杀掉开跑时挂的 `caffeinate`。

## 结束汇报（第一行必须是结论）

不管从哪一步结束，回复的**第一行**只能是下面三种之一，后面再跟明细（每首歌名/总评/小项/聆听秒数、卡了几次）：

```
✅ 评定成功：20/20 首，本期积分 272 → 295（+23）
⚠️ 部分完成：12/20 首，卡在第 13 首（原因），已提交的 12 首不会重复；再调一次 /wyy-rate 会接着评剩下的
❌ 评定失败：原因（未登录 / 不是合伙人 / 网址失效 / 浏览器连不上），今天 0 首
```

- 今天早就评完了（重开页面看到旧分数、没有提交按钮）→ `✅ 今天已经评过了，本期积分 X`，不算失败。
- 积分增量对不上（20 首应 +23）要在明细里写出来，不能报成功就完了。
- `dry` 模式写 `✅ 试跑完成（未提交）`。
- 跟用户同语言；中文用户就全中文。

## 判断「今天已经做完」

重开评定页时，如果歌曲**带着旧分数显示、且没有提交按钮**，说明这批已经评过了。
driver 会直接报「这首已经评过了」并停下 —— **不要重复评定**（不加分，还多一次无意义提交）。

## 必做的前置手势：解锁自动播放（2026-09-18 踩过，最容易卡死的地方）

**页面加载完必须先用 `computer` 点一下页面，否则 20 首一首都跑不了。** 原因：

```
audio.play() -> NotAllowedError: play() failed because the user didn't interact with the document first.
navigator.userActivation.hasBeenActive === false
```

静音豁免在这页不管用 —— **页面自己会把 `audio.muted` 改回 `false`**，于是变成「有声自动播放」被
Chrome 拦掉。只有 `computer` 的 `left_click`（走 CDP 的可信输入事件）能置上 user activation。

**`ref` 点击没用**（实测）：`computer {action:"left_click", ref:"ref_2"}` 走的是 DOM 层
`.click()`，`hasBeenActive` 仍是 `false`、`play()` 照样 `NotAllowedError`。所以必须给坐标。

**但绝对不要写死坐标** —— 每个人屏幕尺寸、窗口大小、页面缩放都不一样，写死会点到别的东西。
坐标要算出来：先截图拿到坐标系尺寸，再按比例扫一个"祖先链上没有 onClick、不在按钮/星星里"的
惰性点，最后按 `坐标系宽 / innerWidth` 换算。这套探点代码就是同目录的 **`unlock.js`**：
`computer screenshot` 拿到 `coordinate frame: W×H` 后，执行 `window.__NMP_FRAME=[W,H];` 拼上 `unlock.js`
全文，返回的 `frame` 就是要点的坐标（顺带返回命中元素的 `tag`/`text`，方便确认没点到按钮上）。

（09-18 实测时该域被设成了 25% 缩放、`innerWidth 7680`，第一个候选点 (50%, 2%) 命中歌名 `H4`、点完起播。
现在页面用正常 100% 缩放，坐标照样由 `unlock.js` 按当前尺寸现算。）

- 点完验一下 `navigator.userActivation.hasBeenActive === true`，再注入/`start()`。
- **一次点击对整个页面生命周期有效**，一批 20 首只需要点一次；但**每次换页/刷新后要重新点**
  （包括 driver 自己跳到 `isContinue=1` 那次）。
- **静音**：页面会自己把 `audio.muted` 改回 `false`，所以 driver 在 `play`/`playing`/
  `volumechange`/`loadedmetadata` 上都挂了钩子、外加 worker 时钟每 250ms 压一次
  `muted=true; volume=0`，注入即生效（不等 `start()`）。用户默认不想听见声音。
  **但页面加载到注入之间那几秒是压不住的** —— 想彻底安静就尽快注入，或者用 `mute off` 才放声。
- 忘了点的话 driver 会立刻抛 `NO_USER_GESTURE`（不再白等 90 秒）—— 补一次点击再 `start()` 即可。

## 后台标签页的定时器节流（2026-09-18 踩过）

评定页一旦变成隐藏页（`document.hidden===true`），Chrome 会把 `setTimeout` 节流到秒级甚至分钟级。实测后果：

- 小项循环从 3 秒变成 **2 分 41 秒**（一首 2.5 分钟 → 20 首要 50 分钟）；
- 看门狗误报「播放卡住」：音频明明在播，只是两次循环迭代的间隔被拉长超过了阈值，
  踢满 4 次就抛假 `STALLED`。

`bot.js` 里已经解决（定时器层面）：
- `sleep()` 用 `setTimeout` + 音频 `timeupdate` 双时钟，谁先到谁唤醒。媒体播放不受节流、
  `timeupdate` 每秒约 4 次照常触发，所以隐藏页里 sleep 也按真实时间走。
- 看门狗阈值放宽到 6 秒，且**播放一恢复就把踢计数清零**，切歌的短暂 paused 不再累进成 STALLED。

**但"隐藏"和"窗口被完全遮挡"是两回事，后者会让整趟跑不起来 —— 见下一节。**

## 窗口被遮挡时媒体根本不加载（2026-09-19 踩过，最贵的一次）

Chrome 判定窗口被**完全遮挡**（macOS occlusion，比如 Chrome 窗口整个被最大化的
Terminal/编辑器压在下面）时，会把**媒体加载整个推迟**。表现：

```
document.hidden === true, visibilityState 'hidden', requestAnimationFrame 一帧都不跑
audio.readyState 0 / networkState 2 / buffered 空，但 audio.error === null
await audio.play() 的 promise 永远不 resolve  →  driver 卡死在 waitReady 里，连看门狗都不再记日志
```

**决定性判据（别再去猜网络/CDN/混合内容）**：在页面里造一个本地 blob 音频，
`new Audio(URL.createObjectURL(<一段自己生成的 wav>))` 然后 `load()`。
- blob 也 `readyState 0` → **是遮挡**，跟网络无关；
- blob `readyState 4` → 媒体管道是好的，那才轮到查 CDN（下一节）。

**两个条件（2026-09-20 测准了，昨天写窄了）**：
1. 评定页必须是**它所在窗口的活动标签页** —— 后台标签页一样 `hidden:true`，媒体一样不加载。
   `tabs_context_mcp` 新建的标签页**未必是活动标签页**（实测它排在 "New Tab" 后面），要显式切过去。
   **Chrome 是本流程自己 `open -a` 起来的时候必然撞上这条**（2026-09-23 实测）：新窗口里
   New Tab 是第 1 个、任务页是第 2 个，`hidden:true`、rAF 0。切过去就行，**不用 activate**：
   ```bash
   osascript -e 'tell application id "com.google.Chrome" to set active tab index of window 1 to 2'
   ```
   （先用 `tell application id "com.google.Chrome" to get title of tabs of window 1` 确认序号，别写死 2。）
2. 那个窗口**不能被 100% 盖住** —— 只要露出一部分就行。

**不需要前台、不需要焦点。** 实测：VS Code 在前台、Chrome 窗口 `hasFocus()===false`，
只要 Chrome 窗口没被完全盖住，`hidden:false`、rAF 60 帧、20 首照常跑完。
正常情况下用户空着跑、没人遮挡，**正常大小的窗口即可**。真被盖住了（rAF 掉到 0），
**把 Chrome 窗口挪到盖不到的地方**（比如右下角 360×240），不用问 —— 这个 Chrome 是本流程自己开的（见下面
「这个 Chrome 归谁」）；不抢焦点也能恢复，2026-09-22 实测挪开即恢复。只有挪了也不行时才 activate：

```bash
osascript -e 'tell application id "com.google.Chrome"
  set bounds of window 1 to {1560, 720, 1920, 960}   -- 挪到角落，不抢焦点
end tell'
```

实在要抢前台（用户明确说人走了）才用：

```bash
osascript -e 'tell application id "com.google.Chrome"
  activate
  set active tab index of window 1 to <评定页所在的 tab index>
end tell'
```

- **这会抢前台焦点**，打断用户在别的 app 里的操作。用户说了人不在 / 让你自己搞定就直接 activate；
  否则优先挪窗口，挪窗口能解决就不 activate。
- 跑之前先量一把：`{hidden:document.hidden, raf:<1 秒内 rAF 次数>}`。`hidden:false` 且 rAF 有几十帧
  才算真可见 —— **`hidden:false` 单独不够**，遮挡状态更新有延迟，出现过 `hidden:false` 但 rAF 为 0。
- 跑的过程中屏幕不能睡，否则又变成遮挡。开跑前挂一个
  `nohup caffeinate -d -t 2700 &`，结束后再 `pmset displaysleepnow`（如果用户要求熄屏）。
- **别去试无头 Chrome / `--remote-debugging-port` / `--remote-debugging-pipe`**：
  2026-09-20 试过，auto-mode 安全分类器会直接拒（Security Weaken / Create RCE Surface），
  而且 `--disable-backgrounding-occluded-windows`、`--disable-features=MacWebContentsOcclusion`
  这两个启动开关在当前 Chrome 上**都挡不住遮挡判定**（实测 `hidden` 照样 true）。
  能解决问题的只有上面那两个条件。

## 某个 CDN 节点整个是死的（2026-09-19 踩过）

页面发的曲流地址形如 `http://mXXX.music.126.net/<时间戳>/<token>/...`。**个别节点会整个不出数据**：
请求挂在那里 150+ 秒只传 300 字节，`readyState` 一直 0，页面自己会弹「播放失败，已为你替换新歌曲」
然后换一首 —— 但换来的还是同一个死节点，于是一首都评不了。2026-09-19 死的是 **m804**。

**判据**：同一个路径换个 host 立刻就好。一次试完：

```js
var rest = audio.src.replace(/^https?:\/\/[^/]+/,'');
['m701','m704','m801','m802','m804'].forEach(h => { var t=new Audio(); t.src='https://'+h+'.music.126.net'+rest; t.load(); });
// 4~6 秒后看各自的 readyState：好节点会直接到 4、buffered 上百秒
```

**解法**：注入 bot.js **之前**先注入同目录的 **`cdn-patch.js`**（`window.__nmpCdn.status()` 看它换过几次节点）。它做的是：
劫持 `HTMLMediaElement.prototype.src` 的 setter + `Element.prototype.setAttribute` +
一个 `MutationObserver`（三条路都要，页面换歌时走的是其中之一），只把**已判死**节点的 host 换掉（顺带 `http:`→`https:`），好节点一律不动 —— 改好节点的 src 会让当前这首重载；
再挂一个 2 秒一次的看门狗，发现 `readyState 0 && buffered 空` 持续 9 秒就轮换到下一个节点重新 `load()`。
**换页后这个补丁会丢，跟解锁点击一样要重新打一遍**（第 5→6 首跳 `isContinue=1` 那次）。

顺带排除掉的两个假线索，别再往这两条路上走：
- **混合内容**（页面 https、曲流 http）：Chrome 会自动升级，实测 http 地址照样能到 `readyState 4`，不是病因；
- **缩放/坐标离谱**：从来都不是病因，见下面那节。

## AppleScript 一律用 bundle id（2026-09-26 踩过）

装了 Citrix Receiver 的机器上会有一个 Citrix 生成的「Google Chrome.app」外壳进程（`.../Citrix Receiver/Husk/...`），
`tell application "Google Chrome"` / `open -a "Google Chrome"` 按名字解析会落到它身上：拿不到任何窗口（-1728）、
`activate` 也激活错程序。所以本文所有脚本都写 `tell application id "com.google.Chrome"`、`open -b com.google.Chrome`，别改回名字。

## 这个 Chrome 归谁（2026-09-23 更正，之前写反了）

**跑评定用的 Chrome 默认就是本流程自己开、自己关的**（用户原话：「浏览器本来设定的就是你自己打开，做完了再关上」）。
所以：

- 第 1 步 `list_connected_browsers` 为空 → 自己 `open -a` 起来；**这个窗口归本流程**，被遮挡了直接挪、
  跑完直接退出 Chrome，都不用问。
- **例外**：开跑时 Chrome 本来就开着、里面有用户自己的窗口 → 那是他在用的浏览器。只动
  `tabs_context_mcp` 新建的那个任务窗口/标签，**不退出 Chrome**，跑完只关自己的标签；他的窗口不挪、不改大小。
- 无论哪种，**都不调 `resize_window`**。页面缩放用正常的 100%（用户 2026-09-26 要求：「网页不需要缩那么小，正常就可以」）——
  由 `reset-zoom.sh` 在 Chrome 没运行时清掉该域的缩放记录，**不要再把它缩小**。
  如果看到的缩放不是 100%（Chrome 开着时 reset 会跳过），也照跑、不去改：这页的 rem 布局在非 100% 缩放下 `getBoundingClientRect` 会给出很夸张的数（viewport 被算成
  7680px 宽、元素 y=10074、隐藏弹窗 x=-119988 之类）—— **这些不是故障，不用管**：
  driver 打星星、点提交全走 DOM `.click()`，不依赖坐标，缩放多少都能跑。
  唯一需要坐标的就是那一次解锁点击，`unlock.js` 会按当前尺寸换算。
- 别把这些坐标当成"排版坏了"去找用户改缩放。真正会卡死的只有 `NO_USER_GESTURE`、遮挡、死节点。

## 全自动循环（用户只输一条命令，中途别问他任何事）

一个稳定跑完 20 首的循环就这四步，卡住就回到第 1 步，不要找用户：

1. 开当前批次网址（第一批，或已评过 5 首就直接开 `isContinue=1`），等 7~8 秒；
2. 确认 `hidden:false` 且 rAF 在跑（被遮挡就先解决遮挡），然后**解锁自动播放**：
   截图 → `unlock.js` 探点 → `computer left_click` 点算出来的坐标，顺手 `audio.muted=true; volume=0`；
   **坐标每次算，别用上次的**；再注入一遍 `cdn-patch.js`；
3. 整段注入 `bot.js`。有存档时注入就返回 `auto-resuming: N done, M left`，不用再调 `start()`；
   没存档才 `__nmp.start({songs:20, overall:3})`；
4. 轮询 `__nmp.status()`。三种结果：
   - `running:true` → 继续轮询；
   - `running:false, error:null, done` 到数 → 完事，去主页核对积分；
   - `__nmp is not defined`（driver 自己换页了）或 `error` 非空 → **回第 1 步**，
     存档里的 `done` 会让它接着跑，已提交的不会重复评。

**轮询单次 `await` 不要超过 30 秒** —— CDP 的 `Runtime.evaluate` 到 45 秒会报
「timed out ... renderer may be frozen」，但那只是我的调用超时，driver 在页面里照跑。

## 卡住与断连

- 播放卡住（很常见）：driver 自带看门狗，6 秒不前进就「暂停→重播」，踢 4 次仍不动才抛 `STALLED`
  （音频 `readyState 0` 且装了 cdn-patch 时放宽到 8 次，等补丁换节点）。
  **先别重开页面**：看 `__nmpCdn.status()`，CDN 补丁的看门狗比 driver 慢（要 9 秒无数据才轮换），
  常常是 driver 先抛了 `STALLED`、补丁紧接着换好节点。音频恢复了（`readyState 4`、在走）就直接
  `__nmp.resume()`，同页接着跑（2026-09-24 实测：m804、m704 被判死换到 m701，resume 后跑完剩下 14 首）。
  还不行才重开当前批次网址、重新注入（存档自动接力，已提交的不会重复出现）。
- **某首歌的流是死的**（实测第 17 首：190 秒的曲子 2 分半只缓冲到 6 秒，`readyState:2`、
  `networkState:2` 一直 loading，`currentTime` 停在 4 秒，页面倒计时也冻在 11S）。
  看门狗救不了它 —— 播放进度确实在极慢地爬，`kicks` 会被不断重置，永远到不了 `STALLED`。
  **判据**：`buffered.end(0)` 几十秒都不涨。**解法**：重开网址重新取流，实测一次就好
  （缓冲立刻到 74 秒）。`maxWait` 已放宽到 180 秒，但别指望死等能等出来。
- Chrome 扩展中途断连不影响评定 —— **driver 跑在页面里会自己继续**；
  按第 1 步自己重连（`open -b com.google.Chrome`），再 `__nmp.status()` 看进度即可，不用打扰用户。
- 浏览器拦截自动播放时 `audio.paused=true`，driver 会反复 `play()` 并按真实播放秒数计时，不会偷跑。

## 硬性规则

- **必须总评 + 所有小项星星全部打完才能点提交**；driver 逐个校验星星真的点亮，没打全宁可报错也不提交。
- **聆听门禁按真实播放计时。** 等页面自己把「聆听15S后才可评定」变成「请评定」再打分。
  门禁偶发失效（网络差时提前可评）碰上就用，但不去制造这种状态 —— 那是平台的防刷机制。
- 中途不要把活推回给用户：浏览器没连上自己叫起来，换页了自己重新注入，
  只有"确实需要人"的事（登录、账号不是合伙人、网址全失效）才停下来找他。
- 只做评定，不顺手做「写乐评」「歌曲推荐」等别的任务，除非用户明确要求。
- 提交不可撤销：只在用户明确要求跑评定时执行；用户只说「看看 / 测一下」时用 `dryRun:true`。
- 如实汇报：卡在第几首就说第几首，别把没做完说成做完。

## 页面结构备忘（2026-09 实测，改版时按这个排查）

- 提示：`聆听15S后才可评定` → 满 15 秒变 `请评定`；计时跟音频实际播放秒数走，不是墙上时间。
- 星星：`<ul>` 里 5 个无文字 `<li>`；可见的第 1 个 ul = 总评，其后是小项（旋律 / 演唱 / 歌词）。
  点亮判定 = li 的 class 与末位 li 不同。class 名是构建哈希（如 `hly10v0F`）会随发版变，
  **bot.js 一律按结构特征找元素，不写死 class**。
- 按钮：一批中前几首是「提交并评下一首」，最后一首是「完成评定」；之后出现
  `评定完成 / 已完成今日N首歌曲的评定，获得X分 / 继续评定`。
- 页面里的「前往评定」「评定今日歌曲」、以及**主页上**的「继续评定」在浏览器里是死的 ——
  它们调的是 App 内路由（`orpheus://` / `pageName: mission/index`），所以本流程一律直接开 URL。
  `isContinue=1` 就是从主页「继续评定」的 onClick 里扒出来的。
  （完成页弹窗里的那个「继续评定」是页面内逻辑，调 `getcontinueDailyTask()`，正常可点。）
- 相关接口名（排查用）：`music/partner/daily/task/get`（每日 5 首）、
  `music/partner/extra/wait/evaluate/work/list`（加评列表）、`music/partner/work/evaluate`（提交评分）。
