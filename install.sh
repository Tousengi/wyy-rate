#!/usr/bin/env bash
# 把 wyy-rate 装成 Claude Code 的用户级 skill：装完在任何目录打开 claude 都能 /wyy-rate。
# 装的是一份拷贝，装完这个 clone 下来的文件夹删掉也不影响使用；更新时 git pull 后再跑一次本脚本。
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/skills/wyy-rate"
DST="$HOME/.claude/skills/wyy-rate"
mkdir -p "$HOME/.claude/skills"
if [ -L "$DST" ]; then rm "$DST"; fi
mkdir -p "$DST"
cp "$SRC"/SKILL.md "$SRC"/*.js "$DST"/
echo "已安装到 $DST"
echo "下一步：Chrome 装好并连接 Claude in Chrome 扩展，然后在任意目录运行 claude，输入 /wyy-rate"
echo "第一次运行会引导你确认网址、选默认评分方式；网易云没登录的话会提示你扫码。"
