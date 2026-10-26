# -*- coding: utf-8 -*-
"""把 build/ 下的分块源码内联成单文件 index.html。

约定：
  template.html 中的 /*__CSS__*/ 、 //__CORE__ 、 //__SEED__ 、 //__APP__ 为占位符，
  封面图以 base64 data URL 注入到 window.GINKGO_COVER。
"""
import io
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(BASE), "index.html")


def read(name):
    with io.open(os.path.join(BASE, name), "r", encoding="utf-8") as f:
        return f.read()


def main():
    template = read("template.html")
    css = read("style.css")
    core = read("core.js")
    seed = read("seed.js")
    app = read("app.js")
    cover_b64 = read("_cover.b64.txt").strip()

    cover_line = (
        "/* 封面：社团提供的表情包，已压缩为 640px 宽 JPEG(q82)，仅限社团内部使用 */\n"
        "window.GINKGO_COVER = 'data:image/jpeg;base64,%s';\n" % cover_b64
    )

    html = template
    html = html.replace("/*__CSS__*/", css)
    html = html.replace("//__CORE__", core)
    html = html.replace("//__SEED__", cover_line + seed)
    html = html.replace("//__APP__", app)

    for marker in ("/*__CSS__*/", "//__CORE__", "//__SEED__", "//__APP__"):
        assert marker not in html, "占位符未替换: %s" % marker

    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    size = os.path.getsize(OUT)
    lines = html.count("\n") + 1
    print("written: %s" % OUT)
    print("size: %.1f KB (%d bytes), lines: %d" % (size / 1024.0, size, lines))


if __name__ == "__main__":
    main()
