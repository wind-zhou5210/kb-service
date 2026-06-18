"""渲染服务：取原文 + 为 HTML 渲染做净化与包装。

职责：
- Markdown：直接返回原文，前端用 react-markdown 渲染。
- HTML：bleach 净化高危片段（第二道防线）+ 注入高度上报脚本（postMessage），
  最终作为 iframe 的 srcdoc 内容返回。
"""
from __future__ import annotations

import warnings

import bleach

# 保原貌策略下保留 style 属性，但 bleach 未配 css_sanitizer 时会告警，抑制之。
warnings.filterwarnings("ignore", message=".*css_sanitizer.*")

# 策略：保原貌为主，sandbox 是主防线，服务端只做属性级净化（移除 on* 事件处理器、
# javascript: 协议等高危片段）作为第二道防线。因此放开绝大多数 HTML5 标签，
# 但 attributes 白名单不含任何 on* 属性，bleach 会自动剔除事件处理器。
_HTML5_TAGS = {
    # 文档结构
    "html", "head", "body", "title", "meta", "link", "base", "style", "script", "noscript",
    # 区块与文本
    "div", "span", "p", "br", "hr", "pre", "blockquote", "q", "cite", "address",
    "article", "section", "aside", "header", "footer", "nav", "main", "figure", "figcaption",
    # 标题
    "h1", "h2", "h3", "h4", "h5", "h6",
    # 列表
    "ul", "ol", "li", "dl", "dt", "dd",
    # 表格
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
    # 格式化
    "a", "b", "i", "em", "strong", "u", "s", "strike", "del", "ins", "mark", "small",
    "sub", "sup", "abbr", "bdi", "bdo", "code", "kbd", "samp", "var", "time", "wbr",
    # 媒体与嵌入
    "img", "picture", "source", "audio", "video", "track", "iframe", "embed", "object",
    "param", "canvas", "map", "area",
    # 表单（HTML 原貌渲染一般不含，但保留以兼容）
    "form", "input", "button", "textarea", "select", "option", "optgroup", "label",
    "fieldset", "legend", "datalist", "output", "progress", "meter",
    # 交互
    "details", "summary", "dialog",
    # SVG（常见）
    "svg", "path", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "defs", "use", "symbol", "linearGradient", "radialGradient", "stop",
    "clipPath", "pattern", "image", "title",
}
ALLOWED_TAGS = _HTML5_TAGS

# 允许的属性：白名单内不含任何 on* 事件属性，故 onclick/onload 等会被 bleach 自动剔除。
# * 通用属性；特定标签的专属属性单列。
ALLOWED_ATTRS = {
    "*": ["class", "id", "style", "title", "lang", "dir", "role", "tabindex", "hidden",
          "data-"],
    "a": ["href", "target", "rel", "name", "download"],
    "img": ["src", "alt", "width", "height", "srcset", "sizes", "loading"],
    "source": ["src", "srcset", "type", "media", "sizes"],
    "link": ["href", "rel", "type", "media", "sizes", "crossorigin"],
    "meta": ["name", "content", "charset", "http-equiv"],
    "script": ["src", "type", "async", "defer", "crossorigin", "integrity"],
    "style": ["type", "media"],
    "video": ["src", "poster", "width", "height", "controls", "autoplay", "loop", "muted", "preload"],
    "audio": ["src", "controls", "autoplay", "loop", "muted", "preload"],
    "iframe": ["src", "width", "height", "frameborder", "allow", "allowfullscreen"],
    "table": ["border", "cellpadding", "cellspacing", "width"],
    "td": ["colspan", "rowspan", "width", "height", "align", "valign"],
    "th": ["colspan", "rowspan", "width", "height", "align", "valign", "scope"],
    "col": ["span", "width"],
    "colgroup": ["span", "width"],
    "form": ["action", "method", "enctype", "target"],
    "input": ["type", "name", "value", "placeholder", "checked", "disabled", "readonly",
              "required", "min", "max", "step", "maxlength", "size", "src", "alt", "width", "height"],
    "button": ["type", "name", "value", "disabled"],
    "textarea": ["name", "rows", "cols", "placeholder", "disabled", "readonly", "required"],
    "select": ["name", "disabled", "required", "multiple", "size"],
    "option": ["value", "selected", "disabled"],
    "optgroup": ["label", "disabled"],
    "label": ["for"],
    "details": ["open"],
    "dialog": ["open"],
    # SVG 通用
    "svg": ["viewBox", "width", "height", "xmlns", "preserveAspectRatio", "fill", "stroke",
            "stroke-width", "class", "style", "id"],
    "path": ["d", "fill", "stroke", "stroke-width", "fill-rule", "clip-rule", "class", "style"],
    "g": ["transform", "fill", "stroke", "class", "style"],
    "rect": ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "class", "style"],
    "circle": ["cx", "cy", "r", "fill", "stroke", "class", "style"],
    "ellipse": ["cx", "cy", "rx", "ry", "fill", "stroke", "class", "style"],
    "line": ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "class", "style"],
    "polyline": ["points", "fill", "stroke", "class", "style"],
    "polygon": ["points", "fill", "stroke", "class", "style"],
    "text": ["x", "y", "dx", "dy", "font-size", "font-family", "fill", "text-anchor", "class", "style"],
    "tspan": ["x", "y", "dx", "dy", "font-size", "fill", "class", "style"],
    "use": ["href", "xlink:href", "x", "y", "width", "height"],
    "linearGradient": ["id", "x1", "y1", "x2", "y2", "gradientUnits"],
    "radialGradient": ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits"],
    "stop": ["offset", "stop-color", "stop-opacity"],
}

# 高度上报脚本：受信代码，注入到 HTML 末尾。
# sandbox 不给 allow-same-origin，iframe 内脚本无法操作父 DOM，
# 故通过 postMessage 上报自身高度，父窗口据此调整 iframe 高度。
RESIZE_SCRIPT = """
<script>
(function(){
  function report(){
    var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    parent.postMessage({type:'kb-resize', height:h}, '*');
  }
  if (document.readyState === 'complete') report();
  else window.addEventListener('load', report);
  // 内容变化时持续上报（防抖）
  var t;
  new MutationObserver(function(){ clearTimeout(t); t=setTimeout(report,100); }).observe(
    document.body, {subtree:true, childList:true, attributes:true}
  );
  window.addEventListener('resize', function(){ clearTimeout(t); t=setTimeout(report,100); });
  // 拦截锚点链接（href 以 # 开头）：sandbox 阻止片段导航会导致 iframe 重新加载为空白，
  // 故阻止默认导航，改用 scrollIntoView 在 iframe 内定位目标元素。
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    if (!id) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var el = document.getElementById(id) || (document.getElementsByName(id)[0]);
    if (el) {
      // iframe 固定视口高度、内部可滚动，直接在 iframe 内滚动到目标。
      // 这样 HTML 文档自带的 position:fixed 侧边导航保持固定，仅内容滚动（与真实浏览器一致）。
      var rect = el.getBoundingClientRect();
      var curTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop;
      window.scrollTo({ top: curTop + rect.top - 10, behavior: 'smooth' });
    }
  });
})();
</script>
"""


def sanitize_html(raw: str) -> str:
    """净化 HTML：移除 on* 事件属性与 javascript: 协议等高危片段。"""
    return bleach.clean(
        raw,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=list(bleach.sanitizer.ALLOWED_PROTOCOLS) + ["data"],
        strip=False,
    )


def wrap_html_for_srcdoc(raw_html: str) -> str:
    """取 HTML 原文 → 净化 → 注入高度上报脚本 → 返回最终 HTML 字符串。

    返回值将作为 iframe 的 srcdoc 属性值，由前端负责 HTML 转义后再赋给属性。
    """
    cleaned = sanitize_html(raw_html)
    # 在 </body> 前注入脚本；若无 </body> 则追加到末尾
    if "</body>" in cleaned.lower():
        idx = cleaned.lower().rfind("</body>")
        wrapped = cleaned[:idx] + RESIZE_SCRIPT + cleaned[idx:]
    else:
        wrapped = cleaned + RESIZE_SCRIPT
    return wrapped
