#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 Ginkgo 的 Markdown 指南转成 HTML。

两种模式：
  web  —— 单文件、浅色主题、可直接分享/手机阅读（默认）
  word —— 按 Word 转换引擎的排版契约生成（宋体优先/小四/首行缩进/h1~h3 标题语义），
          再由 workbuddy-docx 的 html-to-doc 转成 .docx

用法：
    python tools/md2html.py 社员使用指南.md                      # web 版
    python tools/md2html.py 社员使用指南.md out.html word        # word 版（供转 docx）

不依赖任何第三方库。
"""
import html
import io
import os
import re
import sys

# ---------------------------------------------------------------- web 模式

WEB_CSS = """
:root{
  --bg:#f7f5f0; --card:#ffffff; --ink:#22201c; --ink-soft:#5b564e;
  --muted:#8a8378; --line:#e6e0d6; --accent:#C0392B; --accent-soft:#fdf3ef;
  --gold:#B5651D; --code-bg:#f2efe8;
}
*{box-sizing:border-box}
body{
  margin:0; padding:0 16px 80px;
  background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  font-size:16px; line-height:1.75;
}
.wrap{max-width:820px;margin:0 auto}
header.hero{
  margin:28px 0 8px;padding:26px 28px;border-radius:16px;
  background:linear-gradient(135deg,#ffffff 0%,#fdf6ef 100%);
  border:1px solid var(--line);
}
header.hero h1{margin:0 0 6px;font-size:26px;letter-spacing:.5px}
header.hero .sub{color:var(--ink-soft);font-size:14px}
h1{font-size:26px;margin:36px 0 14px;padding-bottom:10px;border-bottom:2px solid var(--line)}
h2{font-size:21px;margin:34px 0 12px;padding-left:12px;border-left:4px solid var(--accent)}
h3{font-size:17px;margin:24px 0 10px;color:var(--gold)}
h4{font-size:15px;margin:18px 0 8px;color:var(--ink-soft)}
p{margin:10px 0}
a{color:var(--accent);text-decoration:none;word-break:break-all}
a:hover{text-decoration:underline}
ul,ol{margin:10px 0;padding-left:26px}
li{margin:5px 0}
blockquote{
  margin:14px 0;padding:12px 16px;border-radius:10px;
  background:var(--accent-soft);border-left:4px solid var(--accent);
  color:var(--ink-soft);
}
blockquote p{margin:4px 0}
hr{border:none;border-top:1px solid var(--line);margin:32px 0}
code{
  background:var(--code-bg);padding:2px 6px;border-radius:5px;
  font-family:"SFMono-Regular",Consolas,"Courier New",monospace;font-size:.92em;
}
pre{
  background:var(--code-bg);border:1px solid var(--line);border-radius:10px;
  padding:14px 16px;overflow-x:auto;margin:14px 0;
}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:15px;
  background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top}
th{background:#f0ece4;font-weight:600;white-space:nowrap}
tbody tr:nth-child(even){background:#fcfaf6}
.toc{
  margin:20px 0 8px;padding:16px 20px;background:var(--card);
  border:1px solid var(--line);border-radius:14px;
}
.toc b{display:block;margin-bottom:8px;font-size:15px}
.toc a{display:inline-block;margin:3px 14px 3px 0;color:var(--ink-soft);font-size:14px}
.toc a:hover{color:var(--accent)}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);
  color:var(--muted);font-size:13px;text-align:center}
@media (max-width:600px){
  body{font-size:15px}
  header.hero{padding:20px 18px}
  header.hero h1{font-size:22px}
  table{font-size:14px}
  th,td{padding:7px 9px}
}
@media print{ body{background:#fff} .toc{display:none} }
"""

# --------------------------------------------------------------- word 模式
# 契约（workbuddy-docx / html-to-doc）：
#   1. font-family 第一项必须是 SimSun/宋体，否则 Word 的 eastAsia 字体失效
#   2. 正文小四 = 12pt，且必须显式写 text-indent:2em（不写就没有缩进）
#   3. 章节标题必须用 h1~h3（用 div+class 会被转成表格，导航窗格/目录失效）
#   4. 样式写两份：<style> 管页面级规则，inline 管元素视觉（引擎按元素算样式）

# ⚠️ 实测：转换引擎里 <style> 的标签选择器会盖掉元素上的 inline style。
# 所以这里只留 body 级兜底，其余全部写成元素的 inline style，否则代码块会
# 被 p{...} 统一拉回宋体，等宽失效、ASCII 图错位。
WORD_CSS = """
body{font-family:'SimSun','宋体',serif;font-size:12pt;line-height:1.6;color:#22201c}
"""

# ⚠️ 字体名一律用**单引号**：style 属性本身由双引号包裹，值里再用双引号会把
# 属性截断（实测：样式从 font-family: 处被切断，标题全部退回默认宋体）。
WORD_STYLE = {
    'h1': "font-family:'SimHei','黑体',serif;font-size:18pt;font-weight:bold;"
          "text-align:center;color:#C0392B;margin:0 0 18pt 0;text-indent:0",
    'h2': "font-family:'SimHei','黑体',serif;font-size:14pt;font-weight:bold;"
          "color:#B5651D;margin:16pt 0 8pt 0;text-indent:0",
    'h3': "font-family:'SimHei','黑体',serif;font-size:12pt;font-weight:bold;"
          "color:#22201c;margin:12pt 0 6pt 0;text-indent:0",
    'h4': "font-family:'SimSun','宋体',serif;font-size:12pt;font-weight:bold;"
          "color:#5b564e;margin:10pt 0 6pt 0;text-indent:0",
    'p':  "font-family:'SimSun','宋体',serif;font-size:12pt;line-height:1.6;"
          "margin:4pt 0;text-indent:2em",
    'li': "font-family:'SimSun','宋体',serif;font-size:12pt;line-height:1.6;"
          "margin:2pt 0;text-indent:0",
    'th': "font-family:'SimHei','黑体',serif;font-size:10.5pt;font-weight:bold;"
          "background:#F0ECE4;border:1px solid #B9B2A2;padding:4pt 6pt;"
          "text-align:left;text-indent:0",
    'td': "font-family:'SimSun','宋体',serif;font-size:10.5pt;"
          "border:1px solid #B9B2A2;padding:4pt 6pt;text-align:left;"
          "vertical-align:top;text-indent:0",
    'codep': "font-family:'Consolas','Courier New',monospace;font-size:9pt;"
             "margin:0;text-indent:0;line-height:1.35",
    'quotep': "font-family:'SimSun','宋体',serif;font-size:11pt;color:#5b564e;"
              "text-indent:0;margin:2pt 0",
}


def inline(text):
    """行内标记：转义 → 代码 → 粗体 → 斜体 → 链接"""
    out = html.escape(text, quote=False)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    out = re.sub(r'(^|[^*])\*([^*\n]+)\*(?!\*)', r'\1<em>\2</em>', out)
    out = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)',
                 r'<a href="\2" target="_blank" rel="noopener">\1</a>', out)
    return out


def slug(text):
    s = re.sub(r'[^\w\u4e00-\u9fff]+', '-', text).strip('-').lower()
    return s or 'sec'


def convert(md_text, title, mode='web'):
    lines = md_text.split('\n')
    body = []
    toc = []
    i = 0
    n = len(lines)
    word = (mode == 'word')

    def st(key):
        return ' style="%s"' % WORD_STYLE[key] if word else ''

    while i < n:
        line = lines[i]

        # 代码块
        if line.strip().startswith('```'):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            if word:
                # 逐行成段：保证 Word 里保留换行与等宽，ASCII 图不塌成一团
                rows = ''.join(
                    '<p%s>%s</p>' % (st('codep'),
                                      html.escape(b) if b.strip() else '&nbsp;')
                    for b in buf)
                body.append('<div style="background:#F4F2EA;border:1px solid #D8D0BE;'
                            'padding:6pt 8pt;margin:8pt 0">%s</div>' % rows)
            else:
                body.append('<pre><code>%s</code></pre>' % html.escape('\n'.join(buf)))
            continue

        if not line.strip():
            i += 1
            continue

        if re.match(r'^\s*(-{3,}|\*{3,}|_{3,})\s*$', line):
            # word 模式下分隔线会退化成一条细表，改用空段过渡
            body.append('<p style="margin:6pt 0;text-indent:0"></p>' if word else '<hr/>')
            i += 1
            continue

        m = re.match(r'^(#{1,4})\s+(.*)$', line)
        if m:
            lvl = len(m.group(1))
            text = inline(m.group(2).strip())
            plain = re.sub(r'<[^>]+>', '', text)
            if lvl == 1 and not title:
                title = plain
            if lvl == 2:
                toc.append((slug(plain), plain))
            body.append('<h%d%s>%s</h%d>' % (lvl, st('h%d' % lvl), text, lvl))
            i += 1
            continue

        # 表格
        if line.strip().startswith('|') and i + 1 < n and re.match(r'^\s*\|[\s:|-]+\|\s*$', lines[i + 1]):
            header = [c.strip() for c in line.strip().strip('|').split('|')]
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            tbl_style = (' style="border-collapse:collapse;width:100%;margin:8pt 0"'
                         if word else '')
            parts = ['<table%s><thead><tr>' % tbl_style]
            parts += ['<th%s>%s</th>' % (st('th'), inline(c)) for c in header]
            parts.append('</tr></thead><tbody>')
            for r in rows:
                parts.append('<tr>' + ''.join('<td%s>%s</td>' % (st('td'), inline(c))
                                              for c in r) + '</tr>')
            parts.append('</tbody></table>')
            body.append(''.join(parts))
            continue

        # 引用
        if line.lstrip().startswith('>'):
            buf = []
            while i < n and lines[i].lstrip().startswith('>'):
                buf.append(re.sub(r'^\s*>\s?', '', lines[i]))
                i += 1
            inner = []
            for b in buf:
                if b.strip():
                    inner.append('<p%s>%s</p>' % (st('quotep'), inline(b)))
            style = (' style="background:#FDF3EF;border-left:4px solid #C0392B;'
                     'padding:6pt 10pt;margin:8pt 0"') if word else ''
            body.append('<blockquote%s>%s</blockquote>' % (style, ''.join(inner)))
            continue

        # 列表
        m = re.match(r'^(\s*)([-*+]|\d+\.)\s+(.*)$', line)
        if m:
            ordered = bool(re.match(r'^\d+\.', m.group(2)))
            tag = 'ol' if ordered else 'ul'
            items = []
            while i < n:
                mm = re.match(r'^(\s*)([-*+]|\d+\.)\s+(.*)$', lines[i])
                if not mm:
                    break
                is_ord = bool(re.match(r'^\d+\.', mm.group(2)))
                if is_ord != ordered:
                    break
                items.append('<li%s>%s</li>' % (st('li'), inline(mm.group(3))))
                i += 1
            body.append('<%s>%s</%s>' % (tag, ''.join(items), tag))
            continue

        # 段落
        buf = [line]
        i += 1
        while i < n and lines[i].strip() and not re.match(
                r'^\s*(#{1,4}\s|>|```|\||\s*([-*+]|\d+\.)\s|(-{3,}|\*{3,}|_{3,})\s*$)', lines[i]):
            buf.append(lines[i])
            i += 1
        body.append('<p%s>%s</p>' % (st('p'), inline(' '.join(buf))))

    toc_html = ''
    if not word and len(toc) >= 3:
        toc_html = '<nav class="toc"><b>目录</b>' + ''.join(
            '<a href="#%s">%s</a>' % (a, html.escape(t)) for a, t in toc) + '</nav>'

    return title, toc_html, '\n'.join(body)


def build(md_path, out_path=None, mode='web'):
    with io.open(md_path, encoding='utf-8') as f:
        md_text = f.read()

    title, toc_html, body_html = convert(md_text, None, mode)

    if mode == 'word':
        doc = u'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<section role="body" data-page-restart="1">
{body}
</section>
</body>
</html>
'''.format(title=html.escape(title), css=WORD_CSS, body=body_html)
        if not out_path:
            out_path = os.path.splitext(md_path)[0] + '.word.html'
    else:
        doc = u'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div class="wrap">
<header class="hero">
  <h1>{title}</h1>
  <div class="sub">电子科技大学 Ginkgo 烹饪社 · 内部工具文档</div>
</header>
{toc}
{body}
<footer>由 tools/md2html.py 从 Markdown 自动生成 · 源文件：{src}</footer>
</div>
</body>
</html>
'''.format(title=html.escape(title), css=WEB_CSS, toc=toc_html,
           body=body_html, src=html.escape(os.path.basename(md_path)))
        if not out_path:
            out_path = os.path.splitext(md_path)[0] + '.html'

    with io.open(out_path, 'w', encoding='utf-8') as f:
        f.write(doc)
    return out_path


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else None
    mode = sys.argv[3] if len(sys.argv) > 3 else 'web'
    print('wrote', build(src, dst, mode))
