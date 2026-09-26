#!/bin/bash
# 把 Chrome 对 mp.music.163.com 单独记的页面缩放（曾是 25%）删掉，恢复成默认 100%。
# 只能在 Chrome 没运行时改：运行中改 Preferences 会被 Chrome 退出时写回的内存值覆盖。
pgrep -x "Google Chrome" >/dev/null && { echo "chrome-running: skipped"; exit 0; }
/usr/bin/python3 - <<'PY'
import json, glob, os
base = os.path.expanduser('~/Library/Application Support/Google/Chrome')
for f in glob.glob(base + '/*/Preferences'):
    d = json.load(open(f))
    changed = False
    for levels in (d.get('partition', {}).get('per_host_zoom_levels') or {}).values():
        if isinstance(levels, dict) and levels.pop('mp.music.163.com', None) is not None:
            changed = True
    if changed:
        json.dump(d, open(f, 'w'), separators=(',', ':'))
    print(os.path.basename(os.path.dirname(f)), 'reset' if changed else 'already 100%')
PY
