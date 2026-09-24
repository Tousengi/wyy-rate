/* 解锁自动播放用的探点：算出一个「点下去不会触发任何东西」的坐标，交给 computer left_click。
 * 用法：先 computer screenshot 拿到 `coordinate frame: W×H`，然后把下面这行和本文件拼在一起执行：
 *   window.__NMP_FRAME = [W, H];
 * 返回 { frame:[x,y], tag, text, innerWidth, innerHeight }，frame 就是要点的坐标。
 * 坐标必须每次现算：屏幕尺寸、窗口大小、页面缩放每次都可能不同，写死会点到别的东西。
 * 惰性点 = 祖先链 5 层内没有 BUTTON/A/LI/UL、也没有挂 React onClick。
 */
(function () {
  var F = window.__NMP_FRAME;
  if (!F || !(F[0] > 0) || !(F[1] > 0)) return 'ERROR: 先设置 window.__NMP_FRAME = [截图的 coordinate frame 宽, 高]';
  var FRAME_W = F[0], FRAME_H = F[1];
  function inert(el) {
    var n = el;
    for (var i = 0; i < 5 && n; i++) {
      if (['BUTTON', 'A', 'LI', 'UL'].indexOf(n.tagName) >= 0) return false;
      var ks = Object.keys(n).filter(function (s) { return s.indexOf('__react') === 0; });
      for (var j = 0; j < ks.length; j++) {
        var v = n[ks[j]];
        if (v && (v.onClick || (v.memoizedProps && v.memoizedProps.onClick))) return false;
      }
      n = n.parentElement;
    }
    return !!el;
  }
  var fx = [0.5, 0.3, 0.7, 0.1, 0.9], fy = [0.02, 0.05, 0.10, 0.5, 0.95];
  for (var yi = 0; yi < fy.length; yi++)
    for (var xi = 0; xi < fx.length; xi++) {
      var x = innerWidth * fx[xi], y = innerHeight * fy[yi], el = document.elementFromPoint(x, y);
      if (inert(el)) return {
        frame: [Math.round(x * FRAME_W / innerWidth), Math.round(y * FRAME_H / innerHeight)],
        tag: el.tagName, text: ((el.textContent || '').trim()).slice(0, 30),
        innerWidth: innerWidth, innerHeight: innerHeight,
        activated: !!(navigator.userActivation && navigator.userActivation.hasBeenActive)
      };
    }
  return 'ERROR: 25 个候选点都不是惰性点（页面可能改版了）';
})();
