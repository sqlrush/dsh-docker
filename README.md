# dsh-docker：DeepSeek Harness 容器镜像（鲲鹏 ARM64）

把 DeepSeek 官方的 **DeepSeek Harness**（npm 包 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)）装进一个容器镜像，用浏览器访问它的 Web 界面。

| 项 | 内容 |
|---|---|
| dsh 版本 | `0.2.2-rc.5`：npm 上标为最新稳定（`latest`）的版本。上游目前还没有不带 `rc` 的正式版，`0.2.3` 仍是 alpha，没有采用 |
| 架构 | `arm64`（鲲鹏 920 等 ARM64 服务器） |
| 基础 | Debian 12 + Node.js 24，以普通用户（uid 1000）运行 |
| 镜像名 | `ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64` |
| 离线包 | `dsh-0.2.2-rc.5-arm64.tar.gz`，约 364 MB（导入后约 2.1 GB） |

镜像里只有官方的 dsh 和智能体常用的命令行工具（git、curl、python3、ripgrep、jq 等），不含第三方的管理面板或远程桌面。

---

## 1. 下载

**离线包（推荐，服务器不能上外网时用）**：打开 [发布页](https://github.com/sqlrush/dsh-docker/releases/tag/v0.2.2-rc.5)，下载两个文件：

- `dsh-0.2.2-rc.5-arm64.tar.gz`
- `dsh-0.2.2-rc.5-arm64.tar.gz.sha256`

或者用命令：

```bash
B=https://github.com/sqlrush/dsh-docker/releases/download/v0.2.2-rc.5
curl -fLO $B/dsh-0.2.2-rc.5-arm64.tar.gz
curl -fLO $B/dsh-0.2.2-rc.5-arm64.tar.gz.sha256
```

**直接拉取（服务器能访问 ghcr.io 时）**：

```bash
docker pull ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64
```

拉取后跳到第 3 步。

---

## 2. 校验并导入离线包

把两个文件拷到服务器的同一个目录，**每拷到一台机器都先校验一次**：

```bash
sha256sum -c dsh-0.2.2-rc.5-arm64.tar.gz.sha256
```

> 必须显示 `dsh-0.2.2-rc.5-arm64.tar.gz: OK`。

**不是 `OK` 就停下，重新传。** 文件在传输途中（跨网摆渡、安全网关、U 盘）被破坏时，大小往往看起来是对的，内容却可能全是 0。导入时报 `unrecognized image format`、`tar -tf` 什么都列不出来，都是这个原因。

导入（按服务器上有的工具二选一）：

```bash
# 有 docker
docker load -i dsh-0.2.2-rc.5-arm64.tar.gz

# 只有 containerd（K8s 节点常见）。-n k8s.io 不能省,否则 K8s 看不到这个镜像
gunzip -c dsh-0.2.2-rc.5-arm64.tar.gz | ctr -n k8s.io images import -
```

> 最后一行出现镜像名 `ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64`。确认：`docker images | grep dsh` 或 `ctr -n k8s.io images ls -q | grep dsh`。

---

## 3. 启动

### 3.1 用 docker（nerdctl 的参数相同，未实测）

```bash
mkdir -p /srv/dsh/data /srv/dsh/workspace
chown -R 1000:1000 /srv/dsh            # 容器以 uid 1000 运行,数据目录要让它能写

docker run -d --name dsh --restart unless-stopped \
  -p 3080:3080 \
  -e DSH_PUBLIC_URL=http://<服务器IP>:3080/ \
  -v /srv/dsh/data:/data/dsh \
  -v /srv/dsh/workspace:/workspace \
  ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64
```

`<服务器IP>` 换成浏览器访问这台服务器用的地址。`DSH_PUBLIC_URL` 必须和浏览器地址栏里的地址一致，否则页面能打开、但所有操作都会返回 403。

### 3.2 用 K8s

用本仓库的 [`k8s/dsh.yaml`](k8s/dsh.yaml)，先改文件里标了「改」的三处：

- 镜像标签；
- `DSH_PUBLIC_URL`：写 `http://<节点IP>:30080/`；
- 数据目录：默认放在节点的 `/srv/dsh`，多节点集群要用 `nodeSelector` 把 Pod 固定在一个节点上。

然后执行：

```bash
kubectl apply -f dsh.yaml
kubectl -n dsh rollout status deploy/dsh
```

> `deployment "dsh" successfully rolled out`。

不要用 `kubectl port-forward` 访问：dsh 只监听 Pod 自己的地址，端口转发连不上，请用节点端口 30080。

---

## 4. 第一次登录

dsh 每次启动会生成一个一次性登录令牌，写在启动日志里：

```bash
docker logs dsh 2>&1 | grep token=                 # docker
kubectl -n dsh logs deploy/dsh | grep token=       # K8s
```

> `dsh web: http://<服务器IP>:3080/?token=…`

在浏览器里打开这个完整地址，进去以后浏览器会记住登录状态，之后直接打开 `http://<服务器IP>:3080/` 即可。

- **这个地址等同于口令**，只发给要用的人，不要贴到群里。
- 容器重启后令牌会换新，已经登录的浏览器要重新从日志里取一次地址。
- 日志里的地址是容器内部地址（如 `192.168.x.x`）时，说明没设 `DSH_PUBLIC_URL`，见第 3 步。

---

## 5. 配置模型

两种方式任选一种：

- **在页面里填**：登录后打开 **设置 → 模型**，在 DeepSeek 卡片里填 API 密钥并保存。密钥保存在数据目录里，重启不丢。
- **用环境变量**：启动时加 `-e DEEPSEEK_API_KEY=<密钥>`。K8s 的写法见 `k8s/dsh.yaml` 里的注释，建议放 Secret。

用公司内部的 OpenAI 兼容模型服务时，在 **设置 → 模型** 里添加自定义提供商。详见官方文档 [模型提供商](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.zh.md)。

**出网要走代理**时，启动时加上：

```bash
-e HTTPS_PROXY=http://<代理>:<端口> -e HTTP_PROXY=http://<代理>:<端口> -e NO_PROXY=localhost,127.0.0.1
```

---

## 6. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PUBLIC_URL` | 空 | 浏览器访问用的地址，如 `http://10.1.2.3:3080/`。设了它，日志里打印的登录地址就是这个，并自动信任它 |
| `DSH_TRUSTED_HOSTS` | 空 | 另外允许的访问地址，逗号分隔（`主机` 或 `主机:端口`）。同一个服务用多个地址或域名访问时填 |
| `DSH_LISTEN_PORT` | `3080` | 容器内的监听端口 |
| `DSH_BIND` | 容器自己的 IP | 监听地址。dsh 不接受 `0.0.0.0`，只能是某一个网卡的地址；用宿主机网络（`--network host`）时填服务器网卡的 IP |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 的 API 密钥（也可以在页面里填） |
| `HTTPS_PROXY` 等 | 空 | 出网代理 |

| 目录 | 内容 |
|---|---|
| `/data/dsh` | 配置、模型密钥、会话历史。**一定要挂到宿主机目录**，否则删掉容器就全没了 |
| `/workspace` | 智能体读写文件的工作区 |

带参数启动时，参数原样交给 dsh，例如：

```bash
docker run --rm ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64 --version
docker run --rm -e DEEPSEEK_API_KEY=<密钥> ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64 headless "用一句话介绍你自己"
```

---

## 7. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 导入报 `unrecognized image format`，或 `tar -tf` 列不出内容 | 离线包在传输途中被破坏 | 第 2 步的校验，不是 `OK` 就重新传 |
| 打开页面提示 401 | 没带登录令牌 | 用日志里带 `token=` 的完整地址（第 4 步） |
| 页面打开了，但操作都返回 403 | 浏览器地址和 `DSH_PUBLIC_URL` 不一致 | 改成一致后重建容器；或把浏览器用的地址加进 `DSH_TRUSTED_HOSTS` |
| 容器起不来，日志说「目录不可写」 | 宿主机目录的属主不是 1000 | `chown -R 1000:1000 <宿主机目录>` |
| K8s 里一直 `ErrImagePull` / `ImagePullBackOff` | Pod 所在节点没导入镜像，或导入时漏了 `-n k8s.io` | 在那个节点上重做第 2 步的 `ctr` 导入 |
| `kubectl port-forward` 连不上 | dsh 只监听 Pod 自己的地址 | 用节点端口 30080 访问 |
| 对话报模型错误 | 没配密钥，或服务器连不到模型服务 | 第 5 步；在服务器上 `curl -I https://api.deepseek.com` 看网络 |

---

## 8. 安全提醒

- 服务是明文 HTTP。只在内网使用，不要映射到公网；需要 HTTPS 时放到反向代理后面（见官方文档 [公开部署](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/public-deployments.zh.md)），或在启动参数里给证书。
- 智能体能在容器里执行命令、读写 `/workspace`。不要把敏感目录挂进容器。

---

## 9. 验证情况与已知限制

在 Apple Silicon 的 ARM64 Linux 环境（4K 内存页）上实测通过：

- 真实调用一次 DeepSeek 模型；
- 网页登录流程：无令牌 401、带令牌跳转、带会话 200、不受信任的地址 403；
- 断开外网时能正常启动；
- K8s 部署样例经节点端口访问；
- 离线包用 containerd 的 `ctr` 导入。

**64K 内存页内核（部分鲲鹏服务器的默认配置）上还没有实测。** 装好后先执行：

```bash
docker run --rm ghcr.io/sqlrush/dsh:0.2.2-rc.5-arm64 --version
```

能输出 `0.2.2-rc.5` 再往下做。遇到崩溃请把输出发给我们。查内核页大小：`getconf PAGESIZE`，`65536` 即 64K。

---

## 10. 自己构建

需要 Docker 23 及以上，构建机能访问 Docker Hub、Debian 软件源和 npm：

```bash
./build.sh                                   # arm64,产物在 dist/
ARCH=amd64 ./build.sh                        # x86_64
HTTPS_PROXY=http://<代理>:<端口> ./build.sh   # 构建期走代理(不写进镜像)
```

换 dsh 版本：改 `VERSION` 文件。

---

## 许可

DeepSeek Harness 由 DeepSeek 以 MIT 许可发布，上游仓库：<https://github.com/deepseek-ai/deepseek-harness>。镜像里保留了它的许可证文件（`/usr/local/lib/node_modules/@deepseek-ai/dsh/LICENSE`）。本仓库只包含打包脚本。
