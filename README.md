# wyy-rate

网易云音乐「音乐合伙人」每日评定任务的自动化 [Claude Code](https://claude.com/claude-code) Skill。
配合 [Claude in Chrome](https://claude.ai/chrome) 扩展，在你自己的浏览器里完成当天的 20 首评定。

> ⚠️ 自动打分是刷任务行为，平台如果检测到可能限制或取消你的合伙人资格，评分数据也会影响被评的音乐人。
> 本仓库仅作技术演示，用不用、怎么用你自己判断，后果自负。

## 它做什么

- 打开评定页 → 每首**静音播放满 15 秒**（页面的倒计时跟音频播放秒数走，不能跳过）
- 总评 3 星，小项（旋律 / 演唱 / 歌词）随机 2~4 星，逐项校验星星确实点亮
- 点「提交并评下一首」，一批评完后自动点「继续评定」续评
- 每日任务 5 首 + 加评 15 首 = 当日上限 20 首，跑完回主页核对「本期积分」

星数、首数、听歌秒数都能在调用时改；`dryRun` 模式只打星不提交，用来验证页面有没有改版。

## 安装

```bash
git clone https://github.com/<your-name>/wyy-rate.git
mkdir -p ~/.claude/skills
cp -r wyy-rate/skills/wyy-rate ~/.claude/skills/
```

放进 `~/.claude/skills/` 是全局可用；只想在某个项目里用就放 `<项目>/.claude/skills/`。

## 使用

前置：Chrome 装好 Claude in Chrome 扩展并连接，**且那个 Chrome 里已经登录网易云音乐**
（登录 `music.163.com` 即可，页面走同一套 cookie）。账号得是音乐合伙人，否则没有任务。

```
/wyy-rate                      # 按默认跑完当天 20 首
/wyy-rate 只评 5 首             # 改首数
/wyy-rate 总评 4 星             # 改分数
/wyy-rate dryRun               # 只打星不提交，验证页面没改版
/wyy-rate https://mp.music.163.com/<appId>/mission/index.html?isH5=1&from=homeAss   # 指定自己的网址
```

### 关于网址

页面地址长这样，`<appId>` 是「音乐合伙人」小程序的发布号：

```
https://mp.music.163.com/<appId>/mission/index.html?isH5=1&fromStudio=0&from=homeAss
https://mp.music.163.com/<appId>/mission/index.html?isH5=1&fromStudio=0&from=homeAss&isContinue=1   # 加评 15 首
```

**它不是每天变的**，存一次就能一直用。Skill 里内置了一个实测可用的默认值；
如果哪天 404 或白屏，从手机 App「音乐合伙人 → 分享 → 复制链接」拿一条新的，
把路径第一段（那串十六进制）作为新的 appId 告诉 Claude 即可。

网页里的「前往评定」「评定今日歌曲」、以及主页上的「继续评定」按钮在电脑浏览器里**是点不动的**
（它们调的是 App 内部路由 `orpheus://`），所以这个 Skill 一律直接开 URL —— 这也是它能在电脑上跑通的原因。

## 结构

```
skills/wyy-rate/
├── SKILL.md   # 给 Claude 看的流程：开哪个网址、怎么注入、怎么轮询、卡住怎么办
└── bot.js     # 注入页面的 driver：__nmp.start() / status() / stop()
```

`bot.js` 里所有元素都按**结构特征**定位（比如「5 个无文字 `<li>` 的 `<ul>` 就是星星」），
不依赖网易云那些构建哈希 class（`hly10v0F` 之类），所以对方发版后大概率还能用。

## 已知的坑（都已处理）

| 坑 | 处理 |
|---|---|
| 音频经常加载不出来卡住 | 看门狗：4 秒不前进就「暂停→重播」，踢 4 次仍不动才报错 |
| 浏览器拦截自动播放 | 反复 `play()`，并按 `audio.currentTime` 判断真的听够了没，不靠提示文案偷跑 |
| 一批最后一首按钮叫「完成评定」不是「提交」 | 两种文案都认 |
| 重开页面会带出已评过的旧分数且没有提交按钮 | 识别为「已评过」直接停，不重复提交 |
| Chrome 扩展中途断连 | driver 跑在页面里会自己继续，重连后 `__nmp.status()` 接着看 |
| Chrome 没开 / 扩展 service worker 睡了 | Claude 自己 `open -a "Google Chrome"` 唤醒并重连，不需要你动手 |

## License

MIT
