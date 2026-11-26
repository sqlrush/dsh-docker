#!/usr/bin/env python3
"""把老浏览器兼容补丁装进镜像里的 dsh 网页(构建 compat 版镜像时在 Dockerfile 里以 root 运行)。

    python3 patch.py <dsh 安装目录> <legacy-compat.js>

做两件事:
1. 把 legacy-compat.js 复制到前端 dist 根目录(dsh 服务端原样下发 dist 里的静态文件,不需要登录)。
2. 在 index.html 的 <head> 标签**前面**插一行 <script src="./legacy-compat.js">。
   dsh 服务端下发页面时会在 <head> 后面插自己的内联脚本(其中就用到 Promise.withResolvers),
   补丁要比它们先执行,所以放在 <head> 之前;HTML 解析器会把它归进 head,行为与写在 head 里一致。

任何一步对不上(找不到 dist、<head> 不止一个、已经打过补丁)都直接失败,不产出半成品镜像。
"""
import pathlib
import re
import shutil
import sys

FRONTEND_REL = "node_modules/@deepseek-ai/dsh-web-frontend/dist"
SCRIPT_NAME = "legacy-compat.js"
TAG = '<script src="./%s"></script>' % SCRIPT_NAME
HEAD_OPEN = re.compile(r"<head(?:\s[^>]*)?>", re.I)


def fail(msg: str) -> None:
    print("兼容补丁失败:" + msg, file=sys.stderr)
    sys.exit(1)


def inject(html: str) -> str:
    if SCRIPT_NAME in html:
        fail("index.html 里已经有 %s,不重复注入" % SCRIPT_NAME)
    heads = HEAD_OPEN.findall(html)
    if len(heads) != 1:
        fail("index.html 里应恰好有一个 <head> 标签,实际 %d 个" % len(heads))
    m = HEAD_OPEN.search(html)
    module = html.find('<script type="module"')
    if module < 0 or module < m.start():
        fail("index.html 的入口脚本不在 <head> 里,页面结构与预期不同")
    return html[:m.start()] + TAG + "\n  " + html[m.start():]


def main(argv) -> int:
    if len(argv) != 3:
        fail("用法: patch.py <dsh 安装目录> <legacy-compat.js>")
    dsh_root, script = pathlib.Path(argv[1]), pathlib.Path(argv[2])
    dist = dsh_root / FRONTEND_REL
    index = dist / "index.html"
    if not index.is_file():
        fail("找不到前端入口 %s" % index)
    if not script.is_file():
        fail("找不到补丁脚本 %s" % script)
    patched = inject(index.read_text(encoding="utf-8"))
    shutil.copyfile(script, dist / SCRIPT_NAME)
    (dist / SCRIPT_NAME).chmod(0o644)
    index.write_text(patched, encoding="utf-8")
    print("兼容补丁已装入:%s(%d 字节),index.html 已注入" % (dist / SCRIPT_NAME, (dist / SCRIPT_NAME).stat().st_size))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
