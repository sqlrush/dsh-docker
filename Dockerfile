# DeepSeek Harness(dsh)容器镜像:官方 npm 包 @deepseek-ai/dsh + Node 24,浏览器访问 Web 界面。
# 面向鲲鹏(ARM64);也可以在 x86 上构建 amd64。构建:./build.sh(版本取自 VERSION 文件)。
FROM node:24-bookworm-slim

ARG DSH_VERSION
RUN test -n "$DSH_VERSION" || { echo "构建参数 DSH_VERSION 必填(见 VERSION 文件)" >&2; exit 1; }

# 智能体在容器里执行命令时常用的工具;tini 负责回收子进程、转发停止信号
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini git curl python3 procps less ripgrep jq unzip openssh-client \
 && rm -rf /var/lib/apt/lists/*

# 官方包,版本锁定;npm 按注册表记录的完整性校验值核对下载内容
RUN npm install -g --omit=dev --no-fund --no-audit "@deepseek-ai/dsh@${DSH_VERSION}" \
 && npm cache clean --force \
 && dsh --version

# 老浏览器兼容补丁:Windows 7 上的 Edge 109、360 企业安全浏览器(Chromium 108 内核)等缺新接口的浏览器。
# 只补缺的接口,新浏览器上不起作用;普通版镜像不装(DSH_LEGACY_COMPAT=0)。
# 参数放在这里而不是文件开头:前面各层(含 npm 安装的 dsh)两种版本共用、可复用缓存。
ARG DSH_LEGACY_COMPAT=0
COPY compat/ /opt/dsh-compat/
RUN if [ "$DSH_LEGACY_COMPAT" = 1 ]; then \
      python3 /opt/dsh-compat/patch.py "$(npm root -g)/@deepseek-ai/dsh" /opt/dsh-compat/legacy-compat.js; \
    fi

COPY entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 755 /usr/local/bin/dsh-entrypoint \
 && mkdir -p /data/dsh /workspace \
 && chown -R node:node /data /workspace

# 数据目录:配置、模型密钥、会话历史;工作区:智能体读写的文件。两个都建议挂卷。
ENV DSH_HOME=/data/dsh \
    DSH_TELEMETRY_DISABLED=1 \
    DSH_LISTEN_PORT=3080 \
    LANG=C.UTF-8 \
    TZ=Asia/Shanghai
VOLUME ["/data/dsh", "/workspace"]
WORKDIR /workspace
USER node
EXPOSE 3080

LABEL org.opencontainers.image.title="dsh" \
      org.opencontainers.image.description="DeepSeek Harness(@deepseek-ai/dsh)Web 版容器镜像,支持鲲鹏 ARM64" \
      org.opencontainers.image.version="${DSH_VERSION}" \
      org.opencontainers.image.source="https://github.com/sqlrush/dsh-docker" \
      org.opencontainers.image.licenses="MIT" \
      io.github.sqlrush.dsh.legacy-compat="${DSH_LEGACY_COMPAT}"

ENTRYPOINT ["tini", "--", "dsh-entrypoint"]
