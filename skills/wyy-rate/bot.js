/* 网易云「音乐合伙人」评定自动化 driver
 * 注入后用法：
 *   __nmp.start({songs:20, overall:3, subMin:2, subMax:4})  // 开始（异步，立即返回）
 *   __nmp.status()                                          // 轮询进度
 *   __nmp.resume()                                          // 换页/重注入后续跑（注入时会自动调用）
 *   __nmp.stop()                                            // 中止
 * 页面结构依赖（2026-09 实测）：
 *   - 提示文案  "聆听15S后才可评定" -> "请评定"
 *   - 星星控件  <ul> 内 5 个无文字 <li>；第 1 个 ul = 总评，其余 = 小项(旋律/演唱/歌词...)
 *   - 提交按钮  前 4 首 "提交并评下一首"，最后一首 "完成评定"
 * 跨页续跑：进度存在 localStorage['__nmp_state']；第 5 首后完成页「继续评定」点不动时，
 *   driver 自己跳到 isContinue=1 的网址，外面只需重新注入本脚本，注入时会自动 resume。
 * 聆听门禁：以页面自己的提示（"聆听15S" -> "请评定"）为准，按音频真实播放秒数计时。
 */
(function () {
  var NMP = (window.__nmp = window.__nmp || {});
  if (NMP.running) return 'already running';

  var KEY = '__nmp_state';
  // 后台标签页里 Chrome 会把页面的 setTimeout 节流到秒级甚至分钟级（实测小项循环 3 秒变 161 秒，
  // 看门狗 50 秒只踢了 1 次）。sleep 因此挂三路时钟，谁先到就谁唤醒：
  //   1) setTimeout —— 页面可见时最准；
  //   2) 音频 timeupdate —— 媒体播放不受节流，每秒约 4 次；但音频卡住不播时它也不来，
  //      而那正是最需要看门狗的时刻，所以还需要第 3 路；
  //   3) Web Worker 里的 setInterval —— worker 的定时器不吃页面那套 intensive throttling，
  //      音频停着也照常滴答。
  // 有了这三路，整套流程在后台标签页里都按真实时间走，用户不用把页面切到前台。
  var ticker = NMP._ticker;
  if (!ticker) {
    try {
      var src = 'setInterval(function(){postMessage(0)},250)';
      ticker = NMP._ticker = new Worker(URL.createObjectURL(
        new Blob([src], { type: 'application/javascript' })));
    } catch (e) { ticker = null; }
  }
  var sleep = function (ms) {
    return new Promise(function (r) {
      var t0 = Date.now(), fired = false, a = audio();
      var fin = function () {
        if (fired) return;
        fired = true;
        clearTimeout(id);
        if (a) a.removeEventListener('timeupdate', tick);
        if (ticker) ticker.removeEventListener('message', tick);
        r();
      };
      var tick = function () { if (Date.now() - t0 >= ms) fin(); };
      var id = setTimeout(fin, ms);
      if (a) a.addEventListener('timeupdate', tick);
      if (ticker) ticker.addEventListener('message', tick);
    });
  };
  // 强制静音：页面自己会把 audio.muted 改回 false，所以既在媒体事件上拦，
  // 也拿 worker 时钟每 250ms 压一次（后台标签页里 setInterval 会被节流，worker 不会）。
  // 注入即生效，不用等 start()，免得页面加载那几秒先响出来。
  function muteAll() {
    if (!NMP.cfg || NMP.cfg.mute !== false) {
      [].forEach.call(document.querySelectorAll('audio,video'), function (a) {
        try { if (!a.muted) a.muted = true; if (a.volume !== 0) a.volume = 0; } catch (e) {}
      });
    }
  }
  if (!NMP._muteHooked) {
    NMP._muteHooked = true;
    ['play', 'playing', 'volumechange', 'loadedmetadata'].forEach(function (ev) {
      document.addEventListener(ev, muteAll, true);
    });
    if (ticker) ticker.addEventListener('message', muteAll);
  }
  muteAll();

  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var rndInt = function (a, b) { return Math.floor(rnd(a, b + 1)); };
  var txt = function (e) { return ((e && e.textContent) || '').trim(); };
  var vis = function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  function leaves() {
    var root = document.getElementById('app') || document.body;
    return [].slice.call(root.querySelectorAll('*')).filter(function (e) {
      return e.children.length === 0 && txt(e);
    });
  }
  function findLeaf(re) { return leaves().find(function (e) { return re.test(txt(e)); }); }

  // 星星 ul：正好 5 个无文字 li，且可见（排除歌词 ul 和标签 ul）
  function starULs() {
    return [].slice.call(document.querySelectorAll('ul')).filter(function (u) {
      return u.children.length === 5 && vis(u) &&
        [].every.call(u.children, function (li) { return li.tagName === 'LI' && !txt(li); });
    });
  }
  // 已点亮的星数：末位 li 的 class 视为“空星”样式
  function filled(ul) {
    var lis = [].slice.call(ul.children), empty = lis[4].className;
    for (var i = 0; i < 5; i++) if (lis[i].className === empty) return i;
    return 5;
  }
  function labelFor(ul) {
    var p = ul.parentElement;
    for (var i = 0; i < 4 && p; i++) {
      var hit = [].slice.call(p.querySelectorAll('*')).find(function (e) {
        return e.children.length === 0 && /^[一-龥]{2,4}$/.test(txt(e));
      });
      if (hit && !ul.contains(hit)) return txt(hit);
      p = p.parentElement;
    }
    return '小项';
  }
  // 找到真正挂了 onClick 的那层再点（React 合成事件）
  function clickEl(e) {
    var n = e;
    for (var i = 0; i < 4 && n; i++) {
      var ks = Object.keys(n).filter(function (k) { return k.indexOf('__react') === 0; });
      for (var j = 0; j < ks.length; j++) { var v = n[ks[j]]; if (v && v.onClick) { n.click(); return; } }
      n = n.parentElement;
    }
    e.click();
  }
  var audio = function () { return document.querySelector('audio'); };

  function log(m, extra) {
    var row = { t: new Date().toLocaleTimeString('zh-CN'), m: m };
    if (extra) row.d = extra;
    NMP.log.push(row);
    console.log('[nmp]', m, extra || '');
  }

  // ---- 跨页进度：让第 5 首之后的续评不需要人工介入 ----------------------
  function saveState(pending) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        cfg: NMP.cfg, done: NMP.done || 0, detail: NMP.detail || [],
        pending: !!pending, ts: Date.now()
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      // 超过 2 小时的残留不认，免得跑到隔天还接着旧进度
      if (s && s.ts && Date.now() - s.ts < 2 * 3600 * 1000) return s;
    } catch (e) {}
    return null;
  }
  function clearState() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function continueUrl() {
    var u = location.href.split('#')[0].replace(/([?&])isContinue=1&?/g, '$1').replace(/[?&]$/, '');
    return u + (u.indexOf('?') < 0 ? '?' : '&') + 'isContinue=1';
  }

  // 把第 idx 个星星 ul 打到 v 星；已是 v 星就不重复点（重复点可能清掉）
  async function setStars(idx, v) {
    for (var k = 0; k < 3; k++) {
      var ul = starULs()[idx];
      if (!ul) return false;
      if (filled(ul) === v) return true;
      ul.children[v - 1].click();
      await sleep(rnd(200, 420));
      var after = starULs()[idx];
      if (after && filled(after) === v) return true;
    }
    var last = starULs()[idx];
    return !!last && filled(last) === v;
  }

  // 一批评完 / 完成页：先点「继续评定」，点不动（调的是 App 路由）就自己跳 isContinue=1 的网址
  async function goContinue() {
    for (var k = 0; k < 3; k++) {
      var cont = findLeaf(/^继续评定$/);
      if (!cont) break;
      log('点击「继续评定」进入下一批 (' + (k + 1) + ')');
      clickEl(cont);
      await sleep(rnd(1600, 2600));
      if (starULs().length && findLeaf(/提交并评下一首|完成评定/)) return true;
    }
    if (NMP.cfg.autoNav === false) throw new Error('NEED_RELOAD');
    log('「继续评定」进不去，自己跳转续评页（重新注入后会自动 resume）');
    saveState(true);
    NMP.running = false;
    location.href = continueUrl();
    throw new Error('NAVIGATING');                // 本次执行到此为止，等重新注入
  }

  // 每评完 5 首会插一个「评定完成」页，需要点「继续评定」才进下一批
  async function ensureRatingUI() {
    for (var k = 0; k < 8; k++) {
      if (NMP.abort) throw new Error('已手动中止');
      if (starULs().length) return true;
      if (findLeaf(/^继续评定$/)) return await goContinue();
      var cap = findLeaf(/上限|已达|没有更多|明天|已完成全部/);
      if (cap) throw new Error('不能再评了：' + txt(cap));
      await sleep(1000);
    }
    throw new Error('没等到评分控件（可能已达今日上限或页面卡住）');
  }

  // 等到可评定；同时看门狗：播放不前进就 暂停→播放 踢一下
  // 门禁以页面提示为准；没有提示时按音频真实播放秒数计时，不偷跑
  async function waitReady(maxWait) {
    var t0 = Date.now(), last = -1, lastMove = Date.now(), kicks = 0;
    while (Date.now() - t0 < maxWait * 1000) {
      if (NMP.abort) throw new Error('已手动中止');
      var a = audio();
      if (a) {
        // 页面自己会把 muted 改回 false，所以顺手把 volume 也压成 0，保证真静音
        if (NMP.cfg.mute) { a.muted = true; a.volume = 0; }
        if (a.paused) {
          try { await a.play(); }
          catch (e) {
            // 没有用户手势时 play() 必然被拒；空等 90 秒没意义，立刻报出来让外面点一下页面
            if (e && e.name === 'NotAllowedError' &&
                !(navigator.userActivation && navigator.userActivation.hasBeenActive)) {
              throw new Error('NO_USER_GESTURE');
            }
          }
        }
        // 播放恢复就把踢计数清零：切歌时音频会短暂 paused，不该累进到 STALLED
        if (a.currentTime > last + 0.2) { last = a.currentTime; lastMove = Date.now(); kicks = 0; }
        else if (Date.now() - lastMove > 6000) {           // 卡住了，踢一脚
          kicks++; log('播放卡住，暂停→重播 (' + kicks + ')');
          try { a.pause(); await sleep(400); await a.play(); } catch (e) {}
          lastMove = Date.now();
          if (kicks >= 4) throw new Error('STALLED');        // 交给外面刷新页面
        }
      }
      var hint = findLeaf(/请评定|聆听\s*\d+\s*S/i);
      var uls = starULs();
      var played = a ? a.currentTime : 0;
      // 有提示就以提示为准；没提示时必须确认真的播够 15 秒，别空等也别偷跑
      if (uls.length && (hint ? /请评定/.test(txt(hint)) : played >= (NMP.cfg.listen || 15))) return true;
      await sleep(700);
    }
    throw new Error('等待聆听超时');
  }

  NMP.start = async function (userCfg) {
    if (NMP.running) return 'already running';
    NMP.cfg = Object.assign(
      { songs: 20, overall: 3, subMin: 2, subMax: 4, listen: 15, mute: true,
        maxWait: 180, dryRun: false, autoNav: true },
      userCfg || {}
    );
    var total = NMP.cfg.songs + (NMP.cfg._doneBefore || 0);
    NMP.running = true; NMP.abort = false; NMP.error = null; NMP.log = [];
    NMP.done = NMP.cfg._doneBefore || 0;
    NMP.detail = NMP.cfg._detailBefore || [];
    var handoffs = 0;
    try {
      for (var i = NMP.done + 1; i <= total; i++) {
        if (NMP.abort) throw new Error('已手动中止');
        var pager = txt(findLeaf(/^\d+\s*\/\s*\d+$/)) || '?';
        var title = txt(document.querySelector('#app h1, #app h2, #app h3')) || '';
        log('第 ' + i + '/' + total + ' 首开始 [' + pager + '] ' + title);

        await ensureRatingUI();
        await waitReady(NMP.cfg.maxWait);

        var uls = starULs();
        if (!uls.length) throw new Error('找不到星星控件');
        // 带着旧分数、又没有提交按钮：这一批评完了，页面把上一首留在原位（第 5→6 首的交界）
        // 不是"今天已做完"，先去下一批；真的连着 3 次都过不去才报错
        if (filled(uls[0]) > 0 && !findLeaf(/提交并评下一首|完成评定/)) {
          if (handoffs++ >= 3) throw new Error('这首已经评过了（页面带出了旧评分，没有提交按钮）');
          log('这一批已评完，去下一批');
          await goContinue();
          i--; continue;
        }
        var ok = await setStars(0, NMP.cfg.overall);
        log('总评 ' + NMP.cfg.overall + ' 星' + (ok ? '' : '（未确认点亮！）'));
        await sleep(rnd(300, 700));

        // 小项：必须全部打完才能提交
        var subs = [], tries = 0;
        while (tries++ < 4) {
          uls = starULs();
          var pending = [];
          for (var k = 1; k < uls.length; k++) if (filled(uls[k]) === 0) pending.push(k);
          if (!pending.length) break;
          for (var m = 0; m < pending.length; m++) {
            var idx = pending[m], ul0 = starULs()[idx];
            if (!ul0) continue;
            var name = labelFor(ul0), v = rndInt(NMP.cfg.subMin, NMP.cfg.subMax);
            await setStars(idx, v);
            var now = starULs()[idx];
            subs.push(name + ':' + (now ? filled(now) : '?'));
            await sleep(rnd(280, 700));
          }
        }
        uls = starULs();
        var unrated = [];
        for (var q = 0; q < uls.length; q++) if (filled(uls[q]) === 0) unrated.push(q);
        if (unrated.length) throw new Error('还有 ' + unrated.length + ' 项没打星，不提交');
        log('小项 ' + subs.join(' / '));

        NMP.detail.push({ song: title, pager: pager, overall: NMP.cfg.overall, subs: subs });
        if (NMP.cfg.dryRun) { log('dryRun：到此为止，不提交'); break; }

        await sleep(rnd(400, 900));
        // 一批里前几首是「提交并评下一首」，最后一首是「完成评定」
        var btn = findLeaf(/提交并评下一首|完成评定|^提交$/);
        if (!btn) throw new Error('找不到提交/完成按钮');
        var prevPager = pager;
        clickEl(btn);
        NMP.done = i;
        saveState(i < total);
        log('已提交第 ' + i + ' 首');
        await sleep(rnd(1500, 2600));
        // 等页面真的切到下一首再往下走。不等的话（2026-09-21 踩过）会对着刚提交的那一页
        // 再提交一次：总评/小项都还带着旧分 -> setStars 直接返回 true、pending 为空，
        // 于是 1 秒内“评完”并提交，done 虚高 1，当天实际少评一首。
        // 判据用“总评星归零”（新歌未评），pager 更新有滞后，不能只看它。
        for (var w = 0; w < 12; w++) {
          var u0 = starULs()[0];
          var np = txt(findLeaf(/^\d+\s*\/\s*\d+$/)) || '?';
          if (!u0 || filled(u0) === 0 || np !== prevPager || findLeaf(/^继续评定$/)) break;
          await sleep(700);
        }
      }
      if (!NMP.cfg.dryRun) {
        await sleep(1200);
        var fin = findLeaf(/已完成今日|评定完成/);
        log('全部完成：' + NMP.done + ' 首' + (fin ? ' | ' + txt(fin) : ''));
      }
      clearState();
    } catch (e) {
      NMP.error = String((e && e.message) || e);
      log('中断：' + NMP.error);
      if (NMP.error === 'NAVIGATING') return { navigating: true, done: NMP.done, total: total };
      saveState(NMP.done < total);         // 让重新注入能接着跑
    }
    NMP.running = false;
    return NMP.status();
  };

  // 换页 / 重新注入后接着跑（注入时会自动调用，不用外面再发命令）
  NMP.resume = function () {
    var st = loadState();
    if (!st || !st.cfg) return 'no state to resume';
    var left = st.cfg.songs + (st.cfg._doneBefore || 0) - st.done;
    if (left <= 0) { clearState(); return 'nothing left'; }
    NMP.start(Object.assign({}, st.cfg, {
      songs: left, _doneBefore: st.done, _detailBefore: st.detail || []
    }));
    return 'resuming: ' + st.done + ' done, ' + left + ' left';
  };

  NMP.status = function () {
    var a = audio();
    return {
      running: !!NMP.running, done: NMP.done || 0, error: NMP.error || null,
      hint: txt(findLeaf(/请评定|聆听\s*\d+\s*S/i)) || null,
      pager: txt(findLeaf(/^\d+\s*\/\s*\d+$/)) || null,
      audio: a ? { t: Math.round(a.currentTime), paused: a.paused, muted: a.muted } : null,
      log: (NMP.log || []).slice(-10)
    };
  };
  NMP.stop = function () { NMP.abort = true; clearState(); return 'stopping'; };
  NMP.reset = function () { clearState(); return 'state cleared'; };

  // 注入即自动续跑：从上一页跳转过来时不需要外面再发命令
  var st0 = loadState();
  if (st0 && st0.pending) { return 'wyy-rate driver ready | auto-' + NMP.resume(); }
  return 'wyy-rate driver ready';
})();
