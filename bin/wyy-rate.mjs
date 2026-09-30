#!/usr/bin/env node
// wyy-rate：网易云「音乐合伙人」每日评定，终端命令版。不需要 npm 包（Node 22+ 自带 WebSocket）。
// 做法：用一个独立的 Chrome 配置目录启动 Chrome（不碰你平时用的浏览器），通过 DevTools 协议
// 打开评定页、原样注入 lib/ 下的 cdn-patch.js + bot.js，盯进度、换页后重注入、最后去主页核对积分。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const JS_DIR = path.join(HERE, '..', 'lib');
const CONF_DIR = path.join(os.homedir(), '.config', 'wyy-rate');
const CONF_FILE = path.join(CONF_DIR, 'config.json');
const PROFILE = path.join(CONF_DIR, 'chrome-profile');
const DEFAULT_APPID = '68429fb40fd3640105f60c9a';
const BACKUP_APPID = '605ab15bcc23b01f8e8a2dfb';
const DEFAULTS = { songs: 20, overall: 3, subMin: 2, subMax: 4, listen: 15 };

const HELP = `用法：wyy-rate [参数]
  wyy-rate                 默认：20 首，总评 3 星，小项 2~4 星，每首听 15 秒
  wyy-rate song 5          只评 5 首
  wyy-rate star 4          总评 4 星
  wyy-rate sub 3-5         小项随机 3~5 星（sub 3 = 固定 3 星）
  wyy-rate listen 20       每首至少听 20 秒
  wyy-rate dry             只打星不提交（检查页面有没有改版）
  wyy-rate mute off        出声（默认静音）
  wyy-rate url <网址>      换评定页网址（或 appid <24 位十六进制>），会记住
  wyy-rate login           只打开窗口登录，不评定
key value 和 key=value 都行，顺序随意。第一次运行会弹出 Chrome 窗口让你用网易云 App 扫码登录，以后自动。`;

// ---------------------------------------------------------------- 参数与配置
function parseArgs(argv) {
  const toks = argv.flatMap((a) => (a.includes('=') ? a.split('=') : [a]));
  const o = {};
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i].toLowerCase(), v = toks[i + 1];
    if (['-h', '--help', 'help'].includes(k)) o.help = true;
    else if (['song', 'songs', 's'].includes(k)) { o.songs = +v; i++; }
    else if (['star', 'stars'].includes(k)) { o.overall = +v; i++; }
    else if (['sub', 'subs'].includes(k)) {
      const [a, b] = String(v).split('-').map(Number); o.subMin = a; o.subMax = b ?? a; i++;
    }
    else if (k === 'listen') { o.listen = +v; i++; }
    else if (['dry', 'dryrun'].includes(k)) o.dryRun = true;
    else if (k === 'mute') { o.mute = !/^(off|false|0|no)$/i.test(v); i++; }
    else if (k === 'url' || k === 'appid') { o.appId = (String(v).match(/[0-9a-f]{24}/i) || [])[0]; i++; if (!o.appId) die(`没认出网址里的 appId：${v}`); }
    else if (k === 'login') o.loginOnly = true;
    else die(`不认识的参数：${toks[i]}\n\n${HELP}`);
  }
  for (const [k, lo, hi] of [['songs', 1, 20], ['overall', 1, 5], ['subMin', 1, 5], ['subMax', 1, 5], ['listen', 1, 600]]) {
    if (k in o && !(o[k] >= lo && o[k] <= hi)) die(`${k} 应在 ${lo}~${hi} 之间（今天上限 20 首）`);
  }
  return o;
}
function loadConf() { try { return JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')); } catch { return {}; } }
function saveConf(c) { fs.mkdirSync(CONF_DIR, { recursive: true }); fs.writeFileSync(CONF_FILE, JSON.stringify(c, null, 2)); }
function die(m) { console.error(m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv-SE');

// ---------------------------------------------------------------- Chrome
function findChrome() {
  const c = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    win32: [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).flatMap((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'),
        path.join(d, 'Microsoft/Edge/Application/msedge.exe')]),
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  if (process.env.WYY_CHROME) c.unshift(process.env.WYY_CHROME);
  return c.find((p) => fs.existsSync(p));
}

async function launchChrome() {
  const exe = findChrome();
  if (!exe) die('❌ 评定失败：没找到 Chrome（也可以用环境变量 WYY_CHROME 指定路径）');
  fs.mkdirSync(PROFILE, { recursive: true });
  const portFile = path.join(PROFILE, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const args = [
    `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    // 不点页面也能自动播放
    '--autoplay-policy=no-user-gesture-required',
    // 窗口被盖住 / 在后台时照常加载媒体、不节流定时器
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
    '--window-size=1100,860',
  ];
  args.push('about:blank');
  const proc = spawn(exe, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
  let exited = false; proc.on('exit', () => { exited = true; });
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(portFile)) {
      const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
      if (port) return { proc, port };
    }
    if (exited) break;
    await sleep(200);
  }
  try { proc.kill(); } catch {}
  die('❌ 评定失败：Chrome 没启动起来。可能上一次的 wyy-rate 窗口还开着，关掉它再试');
}

class CDP {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((ok, bad) => { this.ws.onopen = ok; this.ws.onerror = bad; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, bad } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? bad(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) this.handlers.forEach((h) => h(m));
    };
    this.ws.onclose = () => { this.closed = true; for (const { bad } of this.pending.values()) bad(new Error('CDP closed')); };
  }
  // 每条命令都带超时：页面主线程被占满时（music.163.com 的登录页就会）Runtime.evaluate 永远不回
  send(method, params = {}, timeout = 15000) {
    if (this.closed) return Promise.reject(new Error('CDP closed'));
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, bad) => {
      const t = setTimeout(() => { this.pending.delete(id); bad(new Error('timeout: ' + method)); }, timeout);
      this.pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, bad: (e) => { clearTimeout(t); bad(e); } });
    });
  }
}

async function openPage(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) { const c = new CDP(pg.webSocketDebuggerUrl); await c.ready; return c; }
    } catch {}
    await sleep(300);
  }
  die('❌ 评定失败：连不上 Chrome 的调试端口');
}

// ---------------------------------------------------------------- 页面操作
let cdp, curUrl = '';
const onMp = () => curUrl.startsWith('https://mp.music.163.com/');
async function evaluate(expression) {
  try {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  } catch (e) { return { __error: String(e.message || e) }; }   // 换页中上下文被销毁，当作暂时拿不到
}
async function waitLoaded(timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!onMp()) { await sleep(500); continue; }   // 被跳去别的站（登录页）就不往里执行脚本
    const s = await evaluate(`document.readyState === 'complete' && !!document.body && document.body.innerText.trim().length > 0`);
    if (s === true) return true;
    await sleep(500);
  }
  return false;
}
async function goto(url) {
  // 刚扫完码时，登录页自己还会再跳一次 music.163.com/，会盖掉这里的导航 → 没落在 mp 域就重来
  for (let i = 0; i < 3; i++) {
    await cdp.send('Page.navigate', { url }).catch(() => {});
    await sleep(1500);
    await waitLoaded();
    await sleep(3000);           // SPA 渲染 + 可能的跳登录页
    if (onMp() || !url.startsWith('https://mp.music.163.com/') || !(await loggedIn())) return;
  }
}
const pageText = () => (onMp() ? evaluate(`document.body ? document.body.innerText : ''`) : '');
// 登录态只看 MUSIC_U cookie：由浏览器进程回答，不受页面卡顿影响
async function loggedIn() {
  try {
    const { cookies } = await cdp.send('Network.getCookies', { urls: ['https://music.163.com', 'https://mp.music.163.com'] });
    return cookies.some((c) => c.name === 'MUSIC_U' && c.value);
  } catch { return false; }
}
async function dismissPopups() {
  await evaluate(`[...document.querySelectorAll('div,span,p,button,a')].find(e=>e.children.length===0&&e.textContent.trim()==='我知道了')?.click()`);
}
async function readPoints(base) {
  await goto(`${base}home/index.html?isH5=1`);
  for (let i = 0; i < 10; i++) {
    if (!onMp()) return null;
    const t = await pageText();
    const m = typeof t === 'string' && t.match(/本期积分[^\d]{0,20}(\d+)/);
    if (m) return +m[1];
    await sleep(1000);
  }
  return null;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  if (typeof WebSocket === 'undefined') die('需要 Node.js 22 或更新版本（当前 ' + process.version + '）');
  if (!fs.existsSync(path.join(JS_DIR, 'bot.js'))) die('找不到 bot.js，请重新运行 install.sh');

  const conf = loadConf();
  if (opts.appId) conf.appId = opts.appId;
  conf.appId ||= DEFAULT_APPID;
  conf.defaults = { ...DEFAULTS, ...(conf.defaults || {}) };
  const cfg = { ...conf.defaults, mute: true, dryRun: false };
  for (const k of ['songs', 'overall', 'subMin', 'subMax', 'listen', 'mute', 'dryRun']) if (k in opts) cfg[k] = opts[k];
  if (cfg.subMin > cfg.subMax) [cfg.subMin, cfg.subMax] = [cfg.subMax, cfg.subMin];

  const { proc, port } = await launchChrome();
  let caffeinate;
  if (process.platform === 'darwin') caffeinate = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
  const cleanup = () => {
    try { cdp?.send('Browser.close').catch(() => {}); } catch {}
    setTimeout(() => { try { process.platform === 'win32' ? proc.kill() : process.kill(-proc.pid); } catch {} }, 1500);
    try { caffeinate?.kill(); } catch {}
  };
  process.on('SIGINT', () => { console.log('\n已中止。已提交的不会重复，再运行一次会接着评剩下的。'); cleanup(); setTimeout(() => process.exit(130), 1600); });

  cdp = await openPage(port);
  cdp.handlers.push((m) => { if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) curUrl = m.params.frame.url; });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');

  const finish = (line, extra = [], lastRun) => {
    console.log('\n' + line); extra.forEach((l) => console.log(l));
    if (lastRun) { conf.lastRun = { date: today(), ...lastRun }; }
    saveConf(conf);
    cleanup();
    setTimeout(() => process.exit(line.startsWith('❌') ? 1 : 0), 1800);
  };

  // 1. 登录（独立配置目录，第一次要扫码，之后 cookie 一直在）
  if (!(await loggedIn())) {
    console.log('需要登录：请在弹出的 Chrome 窗口里用网易云音乐 App 扫码（最多等 3 分钟）');
    await cdp.send('Page.navigate', { url: 'https://music.163.com/#/login' }).catch(() => {});
    const t0 = Date.now();
    while (!(await loggedIn())) {
      if (Date.now() - t0 > 180000) return finish('❌ 评定失败：3 分钟内没有扫码登录，今天 0 首', [], { result: 'fail', reason: 'login' });
      await sleep(3000);
    }
    console.log('登录成功，已保存（以后不用再扫）');
    await sleep(5000);           // 让登录页把自己的跳转做完，免得盖掉下一步的导航
  }

  // 2. 主页：记下开跑前的积分；默认 appId 打不开就试备用
  let base = `https://mp.music.163.com/${conf.appId}/`;
  process.stdout.write('打开音乐合伙人主页… ');
  let before = await readPoints(base);
  if (before === null && onMp()) {
    const alt = conf.appId === BACKUP_APPID ? DEFAULT_APPID : BACKUP_APPID;
    const altBase = `https://mp.music.163.com/${alt}/`;
    const p2 = await readPoints(altBase);
    if (p2 !== null) { conf.appId = alt; base = altBase; before = p2; }
  }
  if (opts.loginOnly) return finish('✅ 已登录。之后直接运行 wyy-rate 即可');
  if (before === null) {
    if (!onMp()) return finish('❌ 评定失败：登录失效了，请运行 wyy-rate login 重新扫码', [`被跳转到：${curUrl}`], { result: 'fail', reason: 'login' });
    const t = String(await pageText()).slice(0, 200).replace(/\s+/g, ' ');
    return finish('❌ 评定失败：主页没读到「本期积分」（账号不是音乐合伙人，或网址失效）', [`页面内容：${t}`], { result: 'fail', reason: 'home' });
  }
  console.log(`本期积分 ${before}`);

  // 3. 评定页：注入补丁和 driver，一次跑完
  const inject = async () => {
    await dismissPopups();
    const src = ['cdn-patch.js', 'bot.js'].map((f) => fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
    await evaluate(src[0]);
    return evaluate(src[1]);
  };
  await goto(`${base}mission/index.html?isH5=1&fromStudio=0&from=homeAss`);
  const r0 = await inject();
  if (!String(r0).includes('auto-resuming')) await evaluate(`__nmp.start(${JSON.stringify(cfg)}), 'started'`);
  console.log(`开始评定：${cfg.songs} 首 · 总评 ${cfg.overall} 星 · 小项 ${cfg.subMin}~${cfg.subMax} 星${cfg.dryRun ? ' · 试跑不提交' : ''}（一首约 20 秒）`);

  let printed = 0, reloads = 0, detail = [], st = null, missing = 0, lastDone = -1, lastChange = Date.now();
  const total = cfg.songs;
  while (true) {
    await sleep(3000);
    st = await evaluate(`window.__nmp && window.__nmp.status ? Object.assign(__nmp.status(), {detail: __nmp.detail || []}) : null`);
    if (!st || st.__error) {
      // driver 自己跳去续评页了（或正在加载）：等页面好了重注入，它会从 localStorage 接着跑
      if (++missing >= 2) { await waitLoaded(); await sleep(2500); await inject(); missing = 0; }
      continue;
    }
    missing = 0;
    detail = st.detail;
    for (; printed < detail.length; printed++) {
      const d = detail[printed];
      console.log(`  ✓ ${String(printed + 1).padStart(2)}/${total} ${d.song || '(未取到歌名)'}  总评 ${d.overall} · ${d.subs.join(' ') || '无小项'} · 听了 ${d.listened} 秒`);
    }
    if (st.done !== lastDone) { lastDone = st.done; lastChange = Date.now(); }
    if (st.running) {
      if (Date.now() - lastChange > 6 * 60000) {   // 6 分钟一首没进展，当卡死处理
        await evaluate(`__nmp.abort = true`); st.error = 'STALLED';
      } else continue;
    }
    if (st.error === 'NAVIGATING') continue;        // 正在跳续评页，下一轮会重注入
    if (!st.error) break;
    if (/已经评过|不能再评|上限|已完成全部/.test(st.error)) break;
    if (/^(STALLED|等待聆听超时|没等到评分控件)/.test(st.error) && reloads < 3) {
      reloads++;
      console.log(`  … 卡住了（${st.error}），刷新页面接着评（第 ${reloads} 次）`);
      await cdp.send('Page.reload'); await sleep(1500); await waitLoaded(); await sleep(3000);
      const r = await inject();
      if (!String(r).includes('auto-resuming')) break;  // 没有存档可接，说明其实跑完了
      lastChange = Date.now();
      continue;
    }
    break;
  }

  // 4. 回主页核对积分，汇报
  const done = st?.done ?? detail.length;
  const err = st?.error;
  const already = !!err && /已经评过|不能再评|上限|已完成全部/.test(err);
  if (cfg.dryRun) return finish(done === 0 && !detail.length && already
    ? '✅ 试跑结束：今天已经评满了，没有可以打星的歌'
    : `✅ 试跑完成（未提交）：打星 ${detail.length} 首，页面结构正常`);
  const after = await readPoints(base);
  const delta = after !== null ? after - before : null;
  const pts = after !== null ? `本期积分 ${before} → ${after}（+${delta}）` : `本期积分没读到（开跑前 ${before}）`;
  const run = { done, before, after, reloads };
  if (done === 0 && already)
    return finish(`✅ 今天已经评过了，本期积分 ${after ?? before}`, [], { result: 'already', ...run });
  if (!err || done >= total)
    return finish(`✅ 评定成功：${done}/${total} 首，${pts}`, reloads ? [`中途刷新 ${reloads} 次`] : [], { result: 'success', ...run });
  if (done > 0)
    return finish(`⚠️ 部分完成：${done}/${total} 首，卡在第 ${done + 1} 首（${err}），${pts}`,
      ['已提交的不会重复；再运行一次 wyy-rate 会接着评剩下的'], { result: 'partial', reason: err, ...run });
  return finish(`❌ 评定失败：${err}，今天 0 首`, [], { result: 'fail', reason: err, ...run });
}

main().catch((e) => { console.error('❌ 评定失败：' + (e?.stack || e)); process.exit(1); });
