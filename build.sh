#!/bin/bash
# 构建 dsh 镜像并导出离线包。在装有 Docker 23 及以上(默认启用 BuildKit)的机器上运行。
#
#   ./build.sh                 构建 arm64(鲲鹏),导出 dist/dsh-<版本>-arm64.tar.gz 与 .sha256
#   ARCH=amd64 ./build.sh      构建 x86_64
#   HTTPS_PROXY=http://<代理> ./build.sh   构建期下载走代理(只在构建时用,不写进镜像)
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(tr -d '[:space:]' < VERSION)"
ARCH="${ARCH:-arm64}"
IMAGE="${IMAGE:-ghcr.io/sqlrush/dsh}"
TAG="$VERSION-$ARCH"
proxy=()
[ -n "${HTTPS_PROXY:-}" ] && proxy+=(--build-arg "HTTPS_PROXY=$HTTPS_PROXY" --build-arg "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}")

docker build --platform "linux/$ARCH" --pull \
  --build-arg "DSH_VERSION=$VERSION" "${proxy[@]}" \
  -t "$IMAGE:$TAG" .

echo "== 自检"
docker run --rm --platform "linux/$ARCH" "$IMAGE:$TAG" --version
docker image inspect "$IMAGE:$TAG" --format '架构 {{.Architecture}}  大小 {{.Size}} 字节'

mkdir -p dist
OUT="dist/dsh-$VERSION-$ARCH.tar.gz"
docker save --platform "linux/$ARCH" "$IMAGE:$TAG" | gzip -6 > "$OUT"
( cd dist && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" 2>/dev/null \
  || shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
ls -l "$OUT"; cat "$OUT.sha256"
