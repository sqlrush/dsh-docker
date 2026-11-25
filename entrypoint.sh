#!/bin/bash
# dsh 容器入口:按环境变量拼出 `dsh web` 的参数并启动。
#
#   DSH_PUBLIC_URL     浏览器访问用的地址,如 http://10.1.2.3:3080/ 。设了它:启动日志里打印的登录地址就是这个,
#                      并自动信任它的主机名。不设:登录地址显示容器内部地址,要自己把主机部分换成服务器地址。
#   DSH_TRUSTED_HOSTS  另外允许的访问地址,逗号分隔(主机名或 主机:端口),经反向代理、域名访问时用
#   DSH_LISTEN_PORT    容器内监听端口,默认 3080。(不叫 DSH_PORT:K8s 会给名为 dsh 的 Service 自动注入同名变量)
#   DSH_BIND           容器内监听地址,默认容器自己的 IP(dsh 不允许监听 0.0.0.0);用宿主机网络(--network host)时要指定
#
# 不带参数时启动 Web 界面;带参数时原样交给 dsh,例如 `docker run … <镜像> --version`、`… headless "任务"`。
set -euo pipefail

die() { echo "dsh 容器:$*" >&2; exit 1; }

for d in "$DSH_HOME" /workspace; do
  mkdir -p "$d" 2>/dev/null || true
  [ -w "$d" ] || die "目录 $d 不可写。容器以 uid $(id -u) 运行,挂载的宿主目录请先执行:chown -R $(id -u):$(id -g) <宿主目录>"
done

if [ "$#" -gt 0 ]; then
  exec dsh "$@"
fi

port="${DSH_LISTEN_PORT:-3080}"
case "$port" in ''|*[!0-9]*) die "DSH_LISTEN_PORT 必须是数字,现在是「$port」" ;; esac

bind="${DSH_BIND:-}"
if [ -z "$bind" ]; then
  # hostname -I 直接列网卡地址,不依赖域名解析;容器没有网络(--network none)时退回本机回环地址
  bind="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$bind" ] || bind="$(hostname -i 2>/dev/null | awk '{print $1}')"
  [ -n "$bind" ] || bind=127.0.0.1
fi
case "$bind" in 0.0.0.0|::|'[::]') die "DSH_BIND 不能是 $bind:dsh 只接受某一个网卡的具体地址" ;; esac

args=(web --no-open --host "$bind" --port "$port")

if [ -n "${DSH_PUBLIC_URL:-}" ]; then
  case "$DSH_PUBLIC_URL" in http://*|https://*) ;; *) die "DSH_PUBLIC_URL 要以 http:// 或 https:// 开头,现在是「$DSH_PUBLIC_URL」" ;; esac
  authority="${DSH_PUBLIC_URL#*://}"
  authority="${authority%%/*}"
  args+=(--public-url "$DSH_PUBLIC_URL" --trusted-host "$authority")
fi

IFS=',' read -r -a extra <<< "${DSH_TRUSTED_HOSTS:-}"
for h in "${extra[@]}"; do
  h="$(echo "$h" | tr -d '[:space:]')"
  [ -n "$h" ] && args+=(--trusted-host "$h")
done

echo "dsh 容器:dsh $(dsh --version),监听 ${bind}:${port},数据目录 ${DSH_HOME},工作区 /workspace"
[ -n "${DSH_PUBLIC_URL:-}" ] || echo "dsh 容器:没设 DSH_PUBLIC_URL —— 下面打印的登录地址是容器内部地址,浏览器打开前把主机部分换成服务器地址,并用 DSH_TRUSTED_HOSTS 信任它"
exec dsh "${args[@]}"
