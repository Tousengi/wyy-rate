---
name: wyy-rate
description: 自动完成网易云音乐「音乐合伙人」当日评定任务——每日任务 5 首 + 加评 15 首，共 20 首；每首播放满 15 秒后总评 3 星、小项（旋律/演唱/歌词）随机 2~4 星，逐首提交，最后核对本期积分。用户说「评定」「打分」「合伙人任务」「跑一下评定」时使用。
---

# 音乐合伙人 自动评定

用 Claude in Chrome 驱动网页完成当天评定。**每天上限 20 首 = 每日任务 5 首 + 加评 15 首**；
积分：前 5 首合计约 +8 分，加评每首 +1 分。

## 网址

页面由 `BASE` 决定，`BASE` 是「音乐合伙人」小程序页面的地址前缀：

```
BASE = https://mp.music.163.com/<appId>/
```

- 用户在调用时给了网址或 appId，就用他给的。
- 否则用默认值 `68429fb40fd3640105f60c9a`（2026-09 实测可用），**不要以为它是每天变的，它是小程序发布号**。
- 默认值 404 / 白屏时，让用户从手机 App 里「音乐合伙人 → 分享 → 复制链接」发来一条，
  取路径第一段作为新的 appId；备用 appId：`605ab15bcc23b01f8e8a2dfb`。

三个要用的地址：

```
第一批 5 首   {BASE}mission/index.html?isH5=1&fromStudio=0&from=homeAss
第二批 15 首  {BASE}mission/index.html?isH5=1&fromStudio=0&from=homeAss&isContinue=1
主页(核对分)  {BASE}home/index.html?isH5=1
```

## 前置条件

- Chrome 已安装 Claude in Chrome 扩展并连接。
- **该 Chrome 里已登录网易云音乐**（登录 `music.163.com` 即可，页面走同一套 cookie）。
  没登录会看到未登录首页 —— 让用户自己登录，不要代填账号密码。
- 账号本身得是音乐合伙人，否则没有任务。

## 参数（用户可在调用时覆盖）

| 参数 | 默认 | 说明 |
|---|---|---|
| `songs` | 20 | 本次评几首 |
| `overall` | 3 | 总评星数 |
| `subMin`/`subMax` | 2 / 4 | 小项随机星数区间 |
| `listen` | 15 | 每首最少播放秒数 |
| `mute` | true | 静音播放（不影响计时，计时跟 `audio.currentTime`） |
| `dryRun` | false | 只打星不提交，用于验证页面没改版 |

## 执行步骤

1. `list_connected_browsers` 确认 Chrome 在线；`tabs_context_mcp{createIfEmpty:true}` 取 tabId。
   **每次会话重新取 tabId，不要复用旧的。**
2. 打开**第一批**网址，等 5~7 秒。首次可能有公告弹窗，「我知道了」常在可视区外，用 JS 点：
   `[...document.querySelectorAll('div,span,p,button,a')].find(e=>e.children.length===0&&e.textContent.trim()==='我知道了')?.click()`
3. 读同目录 `bot.js`，整段作为 `javascript_tool` 的 `text` 执行 → 返回 `wyy-rate driver ready`。
4. `__nmp.start({songs:20})`（异步，立即返回）。
   评完 5 首后会弹「评定完成」页，driver 会自己点「继续评定」续评剩下 15 首。
5. 轮询 `__nmp.status()` 直到 `running:false`。一首约 20 秒，20 首约 7 分钟。
   **轮询用 `browser_batch` 里最多 3~4 个 10 秒 `wait`（≈30~40 秒）**，60 秒的批次会把工具等超时。
6. 如果第 4 步在第 6 首报 `NEED_RELOAD`（完成页的「继续评定」点不动），
   改开**第二批**网址（`isContinue=1`）→ **重新注入 bot.js**（换页后脚本就没了）→ `__nmp.start({songs:15})`。
7. 打开主页核对「本期积分」，并汇报：评了几首、每首的总评与小项分（`__nmp.detail`）、当前积分、卡了几次。

## 判断「今天已经做完」

重开评定页时，如果歌曲**带着旧分数显示、且没有提交按钮**，说明这批已经评过了。
driver 会直接报「这首已经评过了」并停下 —— **不要重复评定**（不加分，还多一次无意义提交）。

## 卡住与断连

- 播放卡住（很常见）：driver 自带看门狗，4 秒不前进就「暂停→重播」，踢 4 次仍不动才抛 `STALLED`；
  这时重开当前批次网址、重新注入、按剩余首数再 `start`（已提交的不会重复出现）。
- Chrome 扩展中途断连不影响评定 —— **driver 跑在页面里会自己继续**；重连后 `__nmp.status()` 看进度即可。
- 浏览器拦截自动播放时 `audio.paused=true`，driver 会反复 `play()` 并按真实播放秒数计时，不会偷跑。

## 硬性规则

- **必须总评 + 所有小项星星全部打完才能点提交**；driver 逐个校验星星真的点亮，没打全宁可报错也不提交。
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
