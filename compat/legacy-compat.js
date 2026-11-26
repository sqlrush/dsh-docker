/*
 * dsh 网页的老浏览器兼容补丁(dsh-docker 的 compat 版镜像注入到 index.html 最前面)。
 *
 * dsh 前端要 Chrome / Edge 122 以上。Windows 7 上的 Edge 109、360 企业安全浏览器(Chromium 108 内核)
 * 缺几个新接口,WebSocket 握手成功后立刻断开、页面一直「重新连接中」,模型也配不了。
 * 这里只补「缺了才补」的接口(新浏览器上什么都不做),外加把 color-mix() / light-dark() 颜色换算成老浏览器认的颜色。
 *
 * - JS 接口:Promise.withResolvers、AbortSignal.any、Set 集合运算、Array 的 toSorted 等不改原数组的方法、
 *   Symbol.dispose、URL.canParse / URL.parse、ReadableStream 的 for await、Iterator 辅助方法、
 *   Object.groupBy / Map.groupBy、Array.fromAsync、Promise.try、String 的 isWellFormed / toWellFormed、
 *   crypto.randomUUID(http 访问时浏览器不提供)。
 * - CSS:color-mix()(Chrome 111+)换成运行时算好的颜色变量;light-dark()(Chrome 123+)取浅色值。
 *
 * 结果写在 window.__dshLegacyCompat,便于排查。
 */
(function () {
  "use strict";
  var report = { version: "1", js: [], css: { colorMix: false, lightDark: false, styles: 0, links: 0, colors: 0, unresolved: 0 }, errors: [] };
  window.__dshLegacyCompat = report;

  function warn(what, err) {
    report.errors.push(what + ": " + (err && err.message ? err.message : String(err)));
    try { console.warn("[dsh-legacy-compat] " + what, err); } catch (_) { /* 没有 console 也不影响页面 */ }
  }

  function define(target, name, value, label) {
    if (target == null || name in target) return;
    try {
      Object.defineProperty(target, name, { value: value, writable: true, configurable: true, enumerable: false });
      report.js.push(label || name);
    } catch (err) { warn("补 " + (label || name) + " 失败", err); }
  }

  function guarded(label, fn) {
    try { fn(); } catch (err) { warn(label, err); }
  }

  // ---------------------------------------------------------------- Promise
  guarded("Promise", function () {
    define(Promise, "withResolvers", function withResolvers() {
      var out = {};
      out.promise = new this(function (resolve, reject) { out.resolve = resolve; out.reject = reject; });
      return out;
    }, "Promise.withResolvers");
    define(Promise, "try", function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new this(function (resolve) { resolve(fn.apply(undefined, args)); });
    }, "Promise.try");
  });

  // ---------------------------------------------------------------- AbortSignal.any
  // 合成的信号只弱引用:合成信号被回收后,从各个源信号上摘掉监听,避免长寿命信号上越挂越多。
  guarded("AbortSignal.any", function () {
    if (typeof AbortSignal === "undefined" || typeof AbortController === "undefined") return;
    var controllers = new WeakMap();
    var cleanup = typeof FinalizationRegistry === "function"
      ? new FinalizationRegistry(function (held) { held.forEach(function (p) { p[0].removeEventListener("abort", p[1]); }); })
      : null;
    define(AbortSignal, "any", function any(signals) {
      var list = Array.from(signals);
      var controller = new AbortController();
      var combined = controller.signal;
      for (var i = 0; i < list.length; i++) {
        if (list[i].aborted) { controller.abort(list[i].reason); return combined; }
      }
      controllers.set(combined, controller);
      var ref = typeof WeakRef === "function" ? new WeakRef(combined) : { deref: function () { return combined; } };
      var pairs = [];
      var onAbort = function () {
        var target = ref.deref();
        pairs.forEach(function (p) { p[0].removeEventListener("abort", p[1]); });
        if (target && !target.aborted) controllers.get(target).abort(this.reason);
      };
      list.forEach(function (s) { s.addEventListener("abort", onAbort); pairs.push([s, onAbort]); });
      if (cleanup) cleanup.register(combined, pairs);
      return combined;
    }, "AbortSignal.any");
  });

  // ---------------------------------------------------------------- Set 集合运算(参数是「类集合」:有 size / has / keys)
  guarded("Set", function () {
    function record(other) {
      if (other == null || typeof other !== "object" && typeof other !== "function") throw new TypeError("参数不是集合");
      var size = Number(other.size);
      if (size !== size) throw new TypeError("集合的 size 不是数字");
      if (typeof other.has !== "function" || typeof other.keys !== "function") throw new TypeError("集合缺少 has / keys");
      return { size: size, has: function (v) { return other.has(v); }, each: function (fn) {
        var it = other.keys(), r;
        while (!(r = it.next()).done) { if (fn(r.value) === false) { if (typeof it.return === "function") it.return(); return false; } }
        return true;
      } };
    }
    var P = Set.prototype;
    define(P, "union", function (other) { var o = record(other), out = new Set(this); o.each(function (v) { out.add(v); }); return out; }, "Set.prototype.union");
    define(P, "intersection", function (other) {
      var o = record(other), self = this, out = new Set();
      if (this.size <= o.size) this.forEach(function (v) { if (o.has(v)) out.add(v); });
      else o.each(function (v) { if (self.has(v)) out.add(v); });
      return out;
    }, "Set.prototype.intersection");
    define(P, "difference", function (other) {
      var o = record(other), out = new Set(this);
      if (this.size <= o.size) this.forEach(function (v) { if (o.has(v)) out.delete(v); });
      else o.each(function (v) { out.delete(v); });
      return out;
    }, "Set.prototype.difference");
    define(P, "symmetricDifference", function (other) {
      var o = record(other), self = this, out = new Set(this);
      o.each(function (v) { if (self.has(v)) out.delete(v); else out.add(v); });
      return out;
    }, "Set.prototype.symmetricDifference");
    define(P, "isSubsetOf", function (other) {
      var o = record(other), ok = true;
      if (this.size > o.size) return false;
      this.forEach(function (v) { if (ok && !o.has(v)) ok = false; });
      return ok;
    }, "Set.prototype.isSubsetOf");
    define(P, "isSupersetOf", function (other) {
      var o = record(other), self = this;
      if (this.size < o.size) return false;
      return o.each(function (v) { return self.has(v); });
    }, "Set.prototype.isSupersetOf");
    define(P, "isDisjointFrom", function (other) {
      var o = record(other), self = this, ok = true;
      if (this.size <= o.size) { this.forEach(function (v) { if (ok && o.has(v)) ok = false; }); return ok; }
      return o.each(function (v) { return !self.has(v); });
    }, "Set.prototype.isDisjointFrom");
  });

  // ---------------------------------------------------------------- 不改原数组的 Array / TypedArray 方法(Chrome 110)
  guarded("Array", function () {
    function copy(arr) { var n = arr.length >>> 0, out = new Array(n); for (var i = 0; i < n; i++) out[i] = arr[i]; return out; }
    function index(arr, i) { var n = arr.length >>> 0, k = Math.trunc(Number(i)) || 0; k = k < 0 ? n + k : k; if (k < 0 || k >= n) throw new RangeError("下标越界"); return k; }
    var A = Array.prototype;
    define(A, "toSorted", function (cmp) {
      if (cmp !== undefined && typeof cmp !== "function") throw new TypeError("比较函数必须是函数");
      return copy(this).sort(cmp);
    }, "Array.prototype.toSorted");
    define(A, "toReversed", function () { return copy(this).reverse(); }, "Array.prototype.toReversed");
    define(A, "toSpliced", function () { var out = copy(this); A.splice.apply(out, arguments); return out; }, "Array.prototype.toSpliced");
    define(A, "with", function (i, value) { var k = index(this, i), out = copy(this); out[k] = value; return out; }, "Array.prototype.with");
    var TA = typeof Uint8Array === "function" ? Object.getPrototypeOf(Uint8Array.prototype) : null;
    if (TA) {
      define(TA, "toSorted", function (cmp) { return this.slice().sort(cmp); }, "TypedArray.prototype.toSorted");
      define(TA, "toReversed", function () { return this.slice().reverse(); }, "TypedArray.prototype.toReversed");
      define(TA, "with", function (i, value) { var k = index(this, i), out = this.slice(); out[k] = value; return out; }, "TypedArray.prototype.with");
    }
    define(Array, "fromAsync", async function (items, mapFn, thisArg) {
      var out = [], i = 0, v;
      if (items != null && typeof items[Symbol.asyncIterator] === "function") {
        for await (v of items) out.push(mapFn ? await mapFn.call(thisArg, v, i++) : v);
      } else {
        var src = items != null && typeof items[Symbol.iterator] === "function" ? items : Array.from(items);
        for (v of src) { v = await v; out.push(mapFn ? await mapFn.call(thisArg, v, i++) : v); }
      }
      return out;
    }, "Array.fromAsync");
    function groupInto(items, cb, add) { var i = 0; for (var v of items) add(cb(v, i++), v); }
    define(Object, "groupBy", function (items, cb) {
      var out = Object.create(null);
      groupInto(items, cb, function (k, v) { k = typeof k === "symbol" ? k : String(k); (out[k] || (out[k] = [])).push(v); });
      return out;
    }, "Object.groupBy");
    define(Map, "groupBy", function (items, cb) {
      var out = new Map();
      groupInto(items, cb, function (k, v) { if (!out.has(k)) out.set(k, []); out.get(k).push(v); });
      return out;
    }, "Map.groupBy");
  });

  // ---------------------------------------------------------------- String
  guarded("String", function () {
    var lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    define(String.prototype, "isWellFormed", function () { return !lone.test(String(this)); }, "String.prototype.isWellFormed");
    define(String.prototype, "toWellFormed", function () {
      return String(this).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|([^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, function (m, pre) {
        return pre === undefined ? "\uFFFD" : pre + "\uFFFD";
      });
    }, "String.prototype.toWellFormed");
  });

  // ---------------------------------------------------------------- Symbol.dispose / asyncDispose
  guarded("Symbol", function () {
    define(Symbol, "dispose", Symbol("Symbol.dispose"), "Symbol.dispose");
    define(Symbol, "asyncDispose", Symbol("Symbol.asyncDispose"), "Symbol.asyncDispose");
  });

  // ---------------------------------------------------------------- URL.canParse / URL.parse
  guarded("URL", function () {
    define(URL, "canParse", function (url, base) { try { new URL(url, base); return true; } catch (_) { return false; } }, "URL.canParse");
    define(URL, "parse", function (url, base) { try { return new URL(url, base); } catch (_) { return null; } }, "URL.parse");
  });

  // ---------------------------------------------------------------- ReadableStream 的 for await(Chrome 124)
  guarded("ReadableStream", function () {
    if (typeof ReadableStream === "undefined") return;
    var P = ReadableStream.prototype;
    var values = function (options) {
      var reader = this.getReader(), preventCancel = !!(options && options.preventCancel);
      return (async function* () {
        var finished = false;
        try {
          for (;;) {
            var r = await reader.read();
            if (r.done) { finished = true; return; }
            yield r.value;
          }
        } finally {
          if (!finished && !preventCancel) { try { await reader.cancel(); } catch (_) { /* 已经出错的流取消失败无妨 */ } }
          try { reader.releaseLock(); } catch (_) { /* 锁已释放 */ }
        }
      })();
    };
    define(P, "values", values, "ReadableStream.prototype.values");
    define(P, Symbol.asyncIterator, values, "ReadableStream.prototype[Symbol.asyncIterator]");
  });

  // ---------------------------------------------------------------- Iterator 辅助方法(Chrome 122)
  guarded("Iterator", function () {
    var IP = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    function close(it) { if (typeof it.return === "function") { try { it.return(); } catch (_) { /* 关闭失败不影响结果 */ } } }
    function lazy(it, step) {
      return (function* () {
        var done = false;
        try {
          for (var i = 0; ; i++) { var r = it.next(); if (r.done) { done = true; return; } var out = step(r.value, i); if (out === STOP) return; if (out !== SKIP) yield* out; }
        } finally { if (!done) close(it); }
      })();
    }
    var SKIP = {}, STOP = {};
    function fn(f) { if (typeof f !== "function") throw new TypeError("参数必须是函数"); return f; }
    define(IP, "map", function (f) { fn(f); return lazy(this, function (v, i) { return [f(v, i)]; }); }, "Iterator.prototype.map");
    define(IP, "filter", function (f) { fn(f); return lazy(this, function (v, i) { return f(v, i) ? [v] : SKIP; }); }, "Iterator.prototype.filter");
    define(IP, "take", function (n) { var left = Number(n); return lazy(this, function (v) { return left-- > 0 ? [v] : STOP; }); }, "Iterator.prototype.take");
    define(IP, "drop", function (n) { var left = Number(n); return lazy(this, function (v) { return left-- > 0 ? SKIP : [v]; }); }, "Iterator.prototype.drop");
    define(IP, "flatMap", function (f) { fn(f); return lazy(this, function (v, i) { return { [Symbol.iterator]: function () { var r = f(v, i); return r[Symbol.iterator] ? r[Symbol.iterator]() : r; } }; }); }, "Iterator.prototype.flatMap");
    function each(it, f) { for (var i = 0; ; i++) { var r = it.next(); if (r.done) return true; if (f(r.value, i) === false) { close(it); return false; } } }
    define(IP, "toArray", function () { var out = []; each(this, function (v) { out.push(v); }); return out; }, "Iterator.prototype.toArray");
    define(IP, "forEach", function (f) { fn(f); each(this, function (v, i) { f(v, i); }); }, "Iterator.prototype.forEach");
    define(IP, "some", function (f) { fn(f); var hit = false; each(this, function (v, i) { if (f(v, i)) { hit = true; return false; } }); return hit; }, "Iterator.prototype.some");
    define(IP, "every", function (f) { fn(f); return each(this, function (v, i) { return !!f(v, i); }); }, "Iterator.prototype.every");
    define(IP, "find", function (f) { fn(f); var found; each(this, function (v, i) { if (f(v, i)) { found = v; return false; } }); return found; }, "Iterator.prototype.find");
    define(IP, "reduce", function (f) {
      fn(f); var hasInit = arguments.length > 1, acc = arguments[1], first = !hasInit;
      each(this, function (v, i) { if (first) { acc = v; first = false; } else acc = f(acc, v, i); });
      if (first) throw new TypeError("空迭代器且没有初始值");
      return acc;
    }, "Iterator.prototype.reduce");
    if (typeof globalThis.Iterator === "undefined") {
      var Iterator = function Iterator() { if (new.target === undefined || new.target === Iterator) throw new TypeError("Iterator 不能直接构造"); };
      Iterator.prototype = IP;
      Iterator.from = function (o) {
        var it = typeof o[Symbol.iterator] === "function" ? o[Symbol.iterator]() : o;
        if (IP.isPrototypeOf(it)) return it;
        return (function* () { yield* { [Symbol.iterator]: function () { return it; } }; })();
      };
      define(globalThis, "Iterator", Iterator, "Iterator");
    }
  });

  // ---------------------------------------------------------------- crypto.randomUUID(非 https 页面上浏览器不提供)
  guarded("crypto.randomUUID", function () {
    var c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== "function" || typeof c.randomUUID === "function") return;
    var target = typeof Crypto === "function" && c instanceof Crypto ? Crypto.prototype : c;
    define(target, "randomUUID", function () {
      var b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.from(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join("");
      return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    }, "crypto.randomUUID");
  });

  // ================================================================ CSS:color-mix() / light-dark()
  var supports = function (decl) { try { return CSS.supports(decl); } catch (_) { return true; } };
  var lowerMix = !supports("color: color-mix(in srgb, red 50%, blue)");
  var lowerLightDark = !supports("color: light-dark(red, blue)");
  report.css.colorMix = lowerMix;
  report.css.lightDark = lowerLightDark;
  if (!lowerMix && !lowerLightDark) return;

  var NEEDS = new RegExp((lowerMix ? ["color-mix\\("] : []).concat(lowerLightDark ? ["light-dark\\("] : []).join("|"), "i");
  var mixes = [];            // [{ id, space, c1, p1, c2, p2 }]
  var mixIds = new Map();    // 归一后的表达式 → 编号

  function closeParen(text, open) {
    var depth = 0, quote = null;
    for (var i = open; i < text.length; i++) {
      var ch = text[i];
      if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) return i;
    }
    return -1;
  }

  function splitTop(text) {
    var parts = [], depth = 0, start = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(text.slice(start).trim());
    return parts;
  }

  // 找下一个函数调用 name(...);内层不再含同名调用的才处理(由内向外)
  function replaceCalls(text, name, render) {
    var re = new RegExp("(^|[^\\w-])" + name + "\\(", "gi"), changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      re.lastIndex = 0;
      var out = "", last = 0, m;
      while ((m = re.exec(text))) {
        var start = m.index + m[1].length, open = start + name.length, end = closeParen(text, open);
        if (end < 0) break;
        var inner = text.slice(open + 1, end);
        if (new RegExp("(^|[^\\w-])" + name + "\\(", "i").test(inner)) continue;  // 先处理里层
        var rep = render(inner);
        if (rep === null) continue;
        out += text.slice(last, start) + rep;
        last = end + 1;
        re.lastIndex = last;
        changed = true;
      }
      text = out + text.slice(last);
    }
    return text;
  }

  // 「颜色 百分比」或「百分比 颜色」;rgb(0 0 0 / 50%) 这类以括号结尾的颜色不会被误认
  function parsePart(part) {
    var m = /^(\d*\.?\d+)%\s+([\s\S]+)$/.exec(part);
    if (m) return { color: m[2].trim(), pct: parseFloat(m[1]) / 100 };
    m = /^([\s\S]+?)\s+(\d*\.?\d+)%$/.exec(part);
    if (m) return { color: m[1].trim(), pct: parseFloat(m[2]) / 100 };
    return { color: part, pct: null };
  }

  function mixVar(inner) {
    var parts = splitTop(inner);
    if (parts.length !== 3 || !/^in\s/i.test(parts[0])) return null;
    var key = inner.replace(/\s+/g, " ").trim();
    if (!mixIds.has(key)) {
      var a = parsePart(parts[1]), b = parsePart(parts[2]);
      mixIds.set(key, mixes.length);
      mixes.push({ id: mixes.length, space: parts[0].slice(3).trim(), c1: a.color, p1: a.pct, c2: b.color, p2: b.pct });
    }
    return "var(--dsh-compat-mix-" + mixIds.get(key) + ")";
  }

  function lowerCss(text) {
    if (lowerLightDark) text = replaceCalls(text, "light-dark", function (inner) { var p = splitTop(inner); return p.length === 2 ? p[0] : null; });
    if (lowerMix) text = replaceCalls(text, "color-mix", mixVar);
    return text;
  }

  // ---- 运行时求值:在 body 里放一个隐藏探针,让 var() 按当前主题展开,再按 srgb 预乘 alpha 混合
  var probe = null, colorsStyle = null;

  function rgba(probeEl, colorText) {
    probeEl.style.setProperty("--dsh-compat-probe", colorText);
    var raw = getComputedStyle(probeEl).getPropertyValue("--dsh-compat-probe").trim();
    if (!raw || NEEDS.test(raw) || !supports("color: " + raw)) return null;
    probeEl.style.color = "";
    probeEl.style.color = raw;
    var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(probeEl).color);
    if (!m) return null;
    var n = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
  }

  function mixOne(e) {
    var c1 = rgba(probe, e.c1), c2 = rgba(probe, e.c2);
    if (!c1 || !c2) return null;
    var p1 = e.p1, p2 = e.p2;
    if (p1 == null && p2 == null) { p1 = 0.5; p2 = 0.5; } else if (p1 == null) p1 = 1 - p2; else if (p2 == null) p2 = 1 - p1;
    var sum = p1 + p2;
    if (!(sum > 0)) return null;
    var scale = sum < 1 ? sum : 1;
    p1 /= sum; p2 /= sum;
    var a = c1[3] * p1 + c2[3] * p2;
    if (a === 0) return "rgba(0, 0, 0, 0)";
    var ch = function (i) { return Math.round((c1[i] * c1[3] * p1 + c2[i] * c2[3] * p2) / a); };
    return "rgba(" + ch(0) + ", " + ch(1) + ", " + ch(2) + ", " + +(a * scale).toFixed(4) + ")";
  }

  function computeColors() {
    if (!mixes.length || !document.body) return;
    if (!probe) {
      probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.display = "none";
    }
    if (probe.parentNode !== document.body) document.body.appendChild(probe);
    if (!colorsStyle) {
      colorsStyle = document.createElement("style");
      colorsStyle.setAttribute("data-dsh-legacy-compat", "colors");
      own.add(colorsStyle);
    }
    if (!colorsStyle.isConnected) document.head.appendChild(colorsStyle);
    var prev = null, text = "";
    for (var pass = 0; pass < 4 && text !== prev; pass++) {   // 颜色变量互相引用时多算几轮
      prev = text;
      var decls = [], bad = 0;
      mixes.forEach(function (e) { var v = mixOne(e); if (v) decls.push("--dsh-compat-mix-" + e.id + ":" + v); else bad++; });
      text = ":root{" + decls.join(";") + "}";
      colorsStyle.textContent = text;
      report.css.colors = decls.length;
      report.css.unresolved = bad;
    }
  }

  var pending = 0;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = 0; guarded("计算颜色", computeColors); }, 30);
  }

  // ---- 样式来源:<style>(插件运行时插入)和 <link rel=stylesheet>(打包的静态样式,取回文本改写后替换)
  var own = new WeakSet(), lastText = new WeakMap(), seenLinks = new WeakSet();

  function handleStyle(st) {
    if (own.has(st)) return;
    var text = st.textContent;
    if (lastText.get(st) === text || !NEEDS.test(text)) return;
    var lowered = lowerCss(text);
    lastText.set(st, lowered);
    st.textContent = lowered;
    report.css.styles++;
    schedule();
  }

  function rebase(css, href) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (all, q, u) {
      if (/^(data:|[a-z][a-z0-9+.-]*:|#|\/)/i.test(u)) return all;
      try { return "url(" + q + new URL(u, href).href + q + ")"; } catch (_) { return all; }
    });
  }

  function handleLink(link) {
    if (seenLinks.has(link) || !/(^|\s)stylesheet(\s|$)/i.test(link.rel || "") || !link.href) return;
    seenLinks.add(link);
    var href = link.href;
    fetch(href, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (text) {
        if (!text || !NEEDS.test(text)) return;
        var st = document.createElement("style");
        st.setAttribute("data-dsh-legacy-compat", href);
        own.add(st);
        st.textContent = rebase(lowerCss(text), href);
        link.parentNode.insertBefore(st, link.nextSibling);
        link.disabled = true;
        report.css.links++;
        schedule();
      })
      .catch(function (err) { warn("改写样式 " + href + " 失败", err); });
  }

  // 只看直接插入的 <style> / <link>(插件样式都直接插进 head),不遍历新增节点的子树,免得聊天流式输出时白耗
  function visit(node) {
    if (node.nodeType !== 1) return;
    if (node.nodeName === "STYLE") handleStyle(node);
    else if (node.nodeName === "LINK") handleLink(node);
  }

  guarded("监听样式", function () {
    var styles = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i], t = r.target;
        if (r.type === "childList") {
          for (var j = 0; j < r.addedNodes.length; j++) visit(r.addedNodes[j]);
          if (t.nodeName === "STYLE") handleStyle(t);
        } else if (r.type === "characterData" && t.parentNode && t.parentNode.nodeName === "STYLE") {
          handleStyle(t.parentNode);
        }
      }
    });
    // 同一个观察者对同一节点再次 observe 会覆盖前一次的选项,所以 html 只注册一次;head 另注册(要看样式文字的改动)
    styles.observe(document.documentElement, { childList: true, subtree: true });
    styles.observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
    // 主题切换:只看 html / body 自身的属性
    var themeAttrs = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-scheme"] };
    var theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, themeAttrs);
    var watchBody = function () {
      if (document.body) theme.observe(document.body, themeAttrs);
      document.querySelectorAll("style, link[rel~=stylesheet]").forEach(visit);
      schedule();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchBody); else watchBody();
    window.addEventListener("load", schedule);
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", schedule);
    }
  });
})();
