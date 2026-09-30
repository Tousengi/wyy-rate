#!/usr/bin/env bash
# 安装终端命令 wyy-rate：
#   1. 检查 Node.js 22+，没有就问你要不要装
#   2. 检查 Chrome（或 Edge / Chromium）
#   3. 程序装到 ~/.local/share/wyy-rate/，命令链接到 PATH 里已有的目录，装完当前终端就能用
# 两种用法：
#   在仓库目录里运行 ./install.sh
#   不 clone，一条命令：curl -fsSL https://raw.githubusercontent.com/Tousengi/wyy-rate/main/install.sh | bash
# 装的是拷贝，clone 下来的文件夹删掉也不影响使用；更新时再运行一次安装命令即可。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" 2>/dev/null && pwd || pwd)"
ORIG_PATH="$PATH"
REPO_TARBALL="https://github.com/Tousengi/wyy-rate/archive/refs/heads/main.tar.gz"

# 通过 curl | bash 运行时旁边没有程序文件，先把仓库下载到临时目录
if [ ! -f "$ROOT/bin/wyy-rate.mjs" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "下载 wyy-rate ..."
  curl -fsSL "$REPO_TARBALL" | tar -xz -C "$TMP" --strip-components=1 \
    || { echo "✗ 下载失败，请检查网络，或 git clone 仓库后运行 ./install.sh"; exit 1; }
  ROOT="$TMP"
fi

ask() {  # 回车 / y 为是
  local r; read -r -p "$1 [Y/n] " r </dev/tty || r=n
  [[ -z "$r" || "$r" =~ ^[Yy] ]]
}
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }

# 1. Node.js
if node_ok; then
  echo "✓ Node.js $(node --version)"
else
  echo "需要 Node.js 22 或更新版本（当前：$(node --version 2>/dev/null || echo 未安装)）"
  if [ "$(uname)" = Darwin ] && command -v brew >/dev/null && ask "用 Homebrew 安装 Node.js 吗？"; then
    brew install node
  elif ask "打开 Node.js 官网下载页吗？（装好后重新运行本脚本）"; then
    if [ "$(uname)" = Darwin ]; then open https://nodejs.org/zh-cn/download; else xdg-open https://nodejs.org/zh-cn/download >/dev/null 2>&1 || true; fi
    exit 0
  fi
  node_ok || { echo "✗ 没有可用的 Node.js，装好后再运行本脚本"; exit 1; }
fi

# 2. 浏览器
found=""
for p in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app" "/Applications/Microsoft Edge.app" \
         "/Applications/Chromium.app" /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do
  [ -e "$p" ] && { found="$p"; break; }
done
if [ -n "$found" ]; then echo "✓ 浏览器：$found"
else echo "✗ 没找到 Chrome，请先安装 https://www.google.com/chrome/ （或用环境变量 WYY_CHROME 指定路径）"; fi

# 3. 程序和命令
DST="$HOME/.local/share/wyy-rate"
rm -rf "$DST"
mkdir -p "$DST/bin" "$DST/lib"
cp "$ROOT/bin/wyy-rate.mjs" "$DST/bin/"
cp "$ROOT"/lib/*.js "$DST/lib/"
chmod +x "$DST/bin/wyy-rate.mjs"

# 命令链接放进 PATH 里已有、且不用 sudo 就能写的目录，这样装完当前终端直接能用
in_path() { case ":$ORIG_PATH:" in *":$1:"*) return 0 ;; esac; return 1; }
BIN=""
for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/bin"; do
  if in_path "$d" && [ -d "$d" ] && [ -w "$d" ]; then BIN="$d"; break; fi
done
for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/bin"; do   # 清掉别处的旧链接
  [ "$d" != "$BIN" ] && [ -L "$d/wyy-rate" ] && rm -f "$d/wyy-rate"
done
NEED_NEW_SHELL=""
if [ -z "$BIN" ]; then
  # PATH 里没有可写的目录：退回 ~/.local/bin，并把它写进 shell 配置
  BIN="$HOME/.local/bin"
  rc="$HOME/.zshrc"; [ "${SHELL##*/}" = bash ] && rc="$HOME/.bashrc"
  grep -qs '.local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
  NEED_NEW_SHELL="$rc"
fi
mkdir -p "$BIN"
ln -sf "$DST/bin/wyy-rate.mjs" "$BIN/wyy-rate"
echo "✓ 命令已安装：$BIN/wyy-rate"

echo
if [ -n "$NEED_NEW_SHELL" ]; then
  echo "完成。已把 ~/.local/bin 加进 ${NEED_NEW_SHELL} —— 新开一个终端（或运行 source ${NEED_NEW_SHELL}）后输入 wyy-rate 开始评定。"
else
  echo "完成。现在就可以输入 wyy-rate 开始评定（第一次会弹出 Chrome 窗口让你用网易云 App 扫码登录）；wyy-rate -h 看参数。"
fi
