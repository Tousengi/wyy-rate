/* CDN 改写补丁：个别 mXXX.music.126.net 节点整个不出数据（2026-09-19 的 m804），
 * 页面换歌换来的还是同一个死节点。本补丁在 bot.js 之前注入，做两件事：
 *   1) 改写：劫持 HTMLMediaElement.prototype.src 的 setter、Element.prototype.setAttribute、
 *      外加一个 MutationObserver —— 页面换歌走的是其中之一，三条路都要堵。
 *      只换掉已判死的 host，顺手 http: -> https:；好节点不动。
 *   2) 看门狗：Worker 时钟每 2 秒查一次，某个 <audio> networkState=LOADING 且
 *      readyState 0、buffered 空持续 9 秒 -> 判当前 host 死，轮换到下一个节点重新 load()。
 * 换页后补丁会丢（跟解锁点击一样），重新注入即可；重复注入是安全的。
 * 状态：window.__nmpCdn.status()
 */
(function () {
  var P = (window.__nmpCdn = window.__nmpCdn || {});
  if (P.installed) return 'cdn-patch already installed | ' + JSON.stringify(P.status());
  P.installed = true;
  P.hosts = ['m701', 'm704', 'm801', 'm802', 'm804'];
  P.dead = {};
  P.rotations = 0;
  P.log = [];
  var RE = /^https?:\/\/(m\d+)\.music\.126\.net(\/.*)$/;

  function note(m) {
    P.log.push({ t: new Date().toLocaleTimeString('zh-CN'), m: m });
    if (P.log.length > 30) P.log.shift();
    console.log('[nmp-cdn]', m);
  }
  function nextAlive(h) {
    var i = P.hosts.indexOf(h);
    for (var k = 1; k <= P.hosts.length; k++) {
      var c = P.hosts[(i + k + P.hosts.length) % P.hosts.length];
      if (!P.dead[c]) return c;
    }
    // 全判死了：多半是误判（网络整体抖动），清空重来
    P.dead = {};
    note('所有节点都被判死，清空重来');
    return P.hosts[(i + 1 + P.hosts.length) % P.hosts.length];
  }
  function rewrite(url) {
    if (typeof url !== 'string') return url;
    var m = RE.exec(url);
    if (!m) return url;
    var h = P.dead[m[1]] ? nextAlive(m[1]) : m[1];
    return 'https://' + h + '.music.126.net' + m[2];
  }
  P.rewrite = rewrite;
  var isMedia = function (el) {
    return el instanceof HTMLMediaElement || el instanceof HTMLSourceElement;
  };

  // 1a) src setter
  var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (desc && desc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, enumerable: desc.enumerable, get: desc.get,
      set: function (v) { desc.set.call(this, rewrite(v)); }
    });
  }
  // 1b) setAttribute('src', ...)
  var rawSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if (isMedia(this) && String(n).toLowerCase() === 'src') v = rewrite(v);
    return rawSet.call(this, n, v);
  };
  // 1c) MutationObserver：兜住上面两条都没走到的（innerHTML、框架直接写属性等）
  function fix(el) {
    if (!isMedia(el)) return;
    var cur = el.getAttribute('src');
    if (!cur) return;
    var nu = rewrite(cur);
    if (nu !== cur) rawSet.call(el, 'src', nu);
  }
  new MutationObserver(function (muts) {
    muts.forEach(function (mu) {
      if (mu.type === 'attributes') fix(mu.target);
      else [].forEach.call(mu.addedNodes, function (n) {
        if (n.nodeType !== 1) return;
        fix(n);
        [].forEach.call(n.querySelectorAll ? n.querySelectorAll('audio,video,source') : [], fix);
      });
    });
  }).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['src']
  });
  [].forEach.call(document.querySelectorAll('audio,video,source'), fix);

  // 2) 看门狗
  var stuckSince = new WeakMap();
  function check() {
    [].forEach.call(document.querySelectorAll('audio'), function (a) {
      var m = RE.exec(a.currentSrc || a.src || '');
      if (!m) return;
      var stuck = a.networkState === 2 && a.readyState === 0 && a.buffered.length === 0;
      if (!stuck) { stuckSince.delete(a); return; }
      var s = stuckSince.get(a);
      if (!s || s.src !== a.src) { stuckSince.set(a, { src: a.src, t: Date.now() }); return; }
      if (Date.now() - s.t < 9000) return;
      P.dead[m[1]] = true;
      a.src = a.src;                        // 走劫持过的 setter -> 换成下一个活节点
      a.load();
      a.play().catch(function () {});       // 卡在这里的一定是想播的那首，load() 后要重新 play
      P.rotations++;
      stuckSince.delete(a);
      note(m[1] + ' 9 秒没数据，判死，轮换到 ' + (RE.exec(a.src) || [])[1]);
    });
  }
  try {
    P._ticker = new Worker(URL.createObjectURL(new Blob(
      ['setInterval(function(){postMessage(0)},2000)'], { type: 'application/javascript' })));
    P._ticker.onmessage = check;
  } catch (e) { setInterval(check, 2000); }

  P.status = function () {
    var a = document.querySelector('audio');
    return {
      dead: Object.keys(P.dead), rotations: P.rotations,
      host: a ? (RE.exec(a.currentSrc || a.src || '') || [])[1] || null : null,
      readyState: a ? a.readyState : null, log: P.log.slice(-5)
    };
  };
  var st = P.status();
  return 'cdn-patch installed | host=' + st.host + ' readyState=' + st.readyState;
})();
