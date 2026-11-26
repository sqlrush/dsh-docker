#!/bin/bash
# 构建 dsh 镜像并导出离线包。在装有 Docker 23 及以上(默认启用 BuildKit)的机器上运行。
#
#   ./build.sh                 构建 arm64(鲲鹏),导出 dist/dsh-<版本>-arm64.tar.gz 与 .sha256
#   ARCH=amd64 ./build.sh      构建 x86_64
#   COMPAT=1 ./build.sh        老浏览器兼容版(Edge 109 / Chromium 108 内核也能用),标签与离线包名带 -compat
#   HTTPS_PROXY=http://<代理> ./build.sh   构建期下载走代理(只在构建时用,不写进镜像)
#   PULL=0 ./build.sh          不重新拉底座,复用本机已有的层(给同一版本补出 compat 版时用,dsh 那一层与普通版完全相同)
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(tr -d '[:space:]' < VERSION)"
ARCH="${ARCH:-arm64}"
IMAGE="${IMAGE:-ghcr.io/sqlrush/dsh}"
COMPAT="${COMPAT:-0}"
case "$COMPAT" in 0) VARIANT="$VERSION" ;; 1) VARIANT="$VERSION-compat" ;; *) echo "COMPAT 只能是 0 或 1" >&2; exit 1 ;; esac
TAG="$VARIANT-$ARCH"
proxy=()
pull=(--pull)
[ "${PULL:-1}" = 0 ] && pull=()
[ -n "${HTTPS_PROXY:-}" ] && proxy+=(--build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}")

# ${a[@]+"${a[@]}"}:数组为空时什么都不展开(macOS 自带的 bash 3.2 在 set -u 下展开空数组会报错)
docker build --platform "linux/$ARCH" ${pull[@]+"${pull[@]}"} \
  --build-arg "DSH_VERSION=$VERSION" --build-arg "DSH_LEGACY_COMPAT=$COMPAT" ${proxy[@]+"${proxy[@]}"} \
  -t "$IMAGE:$TAG" .

echo "== 自检"
docker run --rm --platform "linux/$ARCH" "$IMAGE:$TAG" --version
docker image inspect "$IMAGE:$TAG" --format '架构 {{.Architecture}}  大小 {{.Size}} 字节'
if [ "$COMPAT" = 1 ]; then
  docker run --rm --platform "linux/$ARCH" --entrypoint sh "$IMAGE:$TAG" -c \
    'd="$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist"; grep -q "legacy-compat.js" "$d/index.html" && test -s "$d/legacy-compat.js"' \
    && echo "兼容补丁:已装入" || { echo "兼容补丁没有装进镜像" >&2; exit 1; }
fi

mkdir -p dist
OUT="dist/dsh-$VARIANT-$ARCH.tar.gz"
docker save --platform "linux/$ARCH" "$IMAGE:$TAG" | gzip -6 > "$OUT"
( cd dist && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" 2>/dev/null \
  || shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
# 解压后的 .tar 也给出校验值:现场有时先解压再传
TAR_SUM="$(gunzip -c "$OUT" | { sha256sum 2>/dev/null || shasum -a 256; } | awk '{print $1}')"
TAR_SIZE="$(gunzip -c "$OUT" | wc -c | tr -d '[:space:]')"
echo "$TAR_SUM  $(basename "${OUT%.gz}")" > "${OUT%.gz}.sha256"
ls -l "$OUT"; cat "$OUT.sha256"
echo "解压后 $(basename "${OUT%.gz}"):$TAR_SIZE 字节"; cat "${OUT%.gz}.sha256"
