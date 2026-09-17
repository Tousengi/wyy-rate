#!/usr/bin/env bash
# 把 wyy-rate 装到全局 skills 目录，装完在任何目录都能用 /wyy-rate
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills/wyy-rate"
DEST="${HOME}/.claude/skills/wyy-rate"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "已安装到 $DEST"
echo "重启 Claude Code 后即可用 /wyy-rate"
