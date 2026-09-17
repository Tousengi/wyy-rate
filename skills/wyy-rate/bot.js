/* 网易云「音乐合伙人」评定自动化 driver
 * 注入后用法：
 *   __nmp.start({songs:20, overall:3, subMin:2, subMax:4})  // 开始（异步，立即返回）
 *   __nmp.status()                                          // 轮询进度
 *   __nmp.stop()                                            // 中止
 * 页面结构依赖（2026-09 实测）：
 *   - 提示文案  "聆听15S后才可评定" -> "请评定"
 *   - 星星控件  <ul> 内 5 个无文字 <li>；第 1 个 ul = 总评，其余 = 小项(旋律/演唱/歌词...)
 *   - 提交按钮  前 4 首 "提交并评下一首"，最后一首 "完成评定"
 */
(function () {
  var NMP = (window.__nmp = window.__nmp || {});
  if (NMP.running) return 'already running';

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
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

  // 每评完 5 首会插一个「评定完成」页，需要点「继续评定」才进下一批
  async function ensureRatingUI() {
    var clicks = 0;
    for (var k = 0; k < 8; k++) {
      if (NMP.abort) throw new Error('已手动中止');
      if (starULs().length) return true;
      var cont = findLeaf(/^继续评定$/);
      if (cont && clicks < 3) {
        clicks++; log('点击「继续评定」进入下一批 (' + clicks + ')');
        clickEl(cont); await sleep(rnd(1600, 2600)); continue;
      }
      // 「继续评定」有时也是 App 路由，点不动 => 让外面重开评定页再续跑
      if (cont) throw new Error('NEED_RELOAD');
      var cap = findLeaf(/上限|已达|没有更多|明天|已完成全部/);
      if (cap) throw new Error('不能再评了：' + txt(cap));
      await sleep(1000);
    }
    throw new Error('没等到评分控件（可能已达今日上限或页面卡住）');
  }

  // 等到可评定；同时看门狗：播放不前进就 暂停→播放 踢一下
  async function waitReady(maxWait) {
    var t0 = Date.now(), last = -1, lastMove = Date.now(), kicks = 0;
    while (Date.now() - t0 < maxWait * 1000) {
      if (NMP.abort) throw new Error('已手动中止');
      var a = audio();
      if (a) {
        if (NMP.cfg.mute) a.muted = true;
        if (a.paused) { try { await a.play(); } catch (e) {} }
        if (a.currentTime > last + 0.2) { last = a.currentTime; lastMove = Date.now(); }
        else if (Date.now() - lastMove > 4000) {           // 卡住了，踢一脚
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
      { songs: 20, overall: 3, subMin: 2, subMax: 4, listen: 15, mute: true, maxWait: 90, dryRun: false },
      userCfg || {}
    );
    NMP.running = true; NMP.abort = false; NMP.done = 0; NMP.error = null; NMP.log = []; NMP.detail = [];
    try {
      for (var i = 1; i <= NMP.cfg.songs; i++) {
        if (NMP.abort) throw new Error('已手动中止');
        var pager = txt(findLeaf(/^\d+\s*\/\s*\d+$/)) || '?';
        var title = txt(document.querySelector('#app h1, #app h2, #app h3')) || '';
        log('第 ' + i + ' 首开始 [' + pager + '] ' + title);

        await ensureRatingUI();
        await waitReady(NMP.cfg.maxWait);

        var uls = starULs();
        if (!uls.length) throw new Error('找不到星星控件');
        if (filled(uls[0]) > 0 && !findLeaf(/提交并评下一首|完成评定/)) {
          throw new Error('这首已经评过了（页面带出了旧评分，没有提交按钮）');
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
        // 前 4 首是「提交并评下一首」，最后一首是「完成评定」
        var btn = findLeaf(/提交并评下一首|完成评定|^提交$/);
        if (!btn) throw new Error('找不到提交/完成按钮');
        clickEl(btn);
        NMP.done = i;
        log('已提交第 ' + i + ' 首');
        await sleep(rnd(1500, 2600));
      }
      if (!NMP.cfg.dryRun) {
        await sleep(1200);
        var fin = findLeaf(/已完成今日|评定完成/);
        log('全部完成：' + NMP.done + ' 首' + (fin ? ' | ' + txt(fin) : ''));
      }
    } catch (e) {
      NMP.error = String((e && e.message) || e);
      log('中断：' + NMP.error);
    }
    NMP.running = false;
    return NMP.status();
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
  NMP.stop = function () { NMP.abort = true; return 'stopping'; };

  return 'wyy-rate driver ready';
})();
