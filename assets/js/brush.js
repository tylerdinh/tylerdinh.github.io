/*
 * Brushstroke highlights.
 *
 * Paints three layered, filtered strokes over each line of a highlighted
 * phrase so it reads like a dry-brush wash rather than a flat marker band.
 * Strokes sit on top of the text with a blend mode (multiply in light mode,
 * screen in dark mode), so the text itself stays crisp and selectable.
 *
 * What gets highlighted:
 *   - <mark> and any element with class="brush" in page content
 *   - the big title at the top of each page (your name on the about page)
 *
 * The strokes wiggle gently (see animate() below); the motion is turned off
 * for visitors whose system asks for reduced motion.
 *
 * Colors live in _sass/_parchment.scss as --brush-* custom properties.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  var TARGETS = ["mark", ".brush", ".post-header .post-title", ".header-bar h1"];

  // Each stroke is described relative to the line height (h) of the text it covers.
  var STROKES = [
    // wide, faint smear that bleeds past the words
    { cls: "brush-stroke--wide", filter: "brush-wide", top: 0.24, bottom: 0.02, left: 0.16, right: 0.22, skew: 1.6 },
    // dense main band across the lower half of the letters
    { cls: "brush-stroke--main", filter: "brush-main", top: 0.48, bottom: 0.08, left: 0.06, right: 0.1, skew: 0 },
    // dry, scratchy ghost riding higher
    { cls: "brush-stroke--dry", filter: "brush-dry", top: 0.18, bottom: 0.36, left: 0.1, right: 0.03, skew: -1.8 },
  ];

  var painted = [];
  var scheduled = false;

  function ensureFilters() {
    if (document.getElementById("brush-filters")) return;
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "brush-filters");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    // Regular strokes for body text, plus coarser "-lg" versions for headings,
    // since displacement is in pixels and would look too smooth on big text.
    svg.innerHTML =
      "<defs>" +
      filterDef("brush-main", "fractalNoise", "0.02 0.12", 3, 7, 6) +
      filterDef("brush-wide", "turbulence", "0.008 0.05", 2, 19, 9) +
      filterDef("brush-dry", "fractalNoise", "0.07 0.3", 3, 43, 4) +
      filterDef("brush-main-lg", "fractalNoise", "0.012 0.06", 4, 7, 16) +
      filterDef("brush-wide-lg", "turbulence", "0.005 0.025", 3, 19, 22) +
      filterDef("brush-dry-lg", "fractalNoise", "0.04 0.14", 4, 43, 12) +
      "</defs>";
    document.body.appendChild(svg);
  }

  function filterDef(id, type, freq, octaves, seed, scale) {
    return (
      '<filter id="' +
      id +
      '" x="-6%" y="-90%" width="112%" height="280%" color-interpolation-filters="sRGB">' +
      '<feTurbulence type="' +
      type +
      '" baseFrequency="' +
      freq +
      '" numOctaves="' +
      octaves +
      '" seed="' +
      seed +
      '" result="noise"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="' +
      scale +
      '" xChannelSelector="R" yChannelSelector="G"/>' +
      "</filter>"
    );
  }

  // Small deterministic jitter so repaints don't flicker but strokes still vary.
  function jitter(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  }

  function isVisuallyHidden(node) {
    var parent = node.parentElement;
    return !parent || !!parent.closest(".sr-only, .visually-hidden, [aria-hidden='true']");
  }

  // One rect per visual line, merged across visible text fragments.
  function lineRects(el) {
    var rects = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (!node.textContent.trim() || isVisuallyHidden(node)) continue;
      range.selectNodeContents(node);
      Array.prototype.forEach.call(range.getClientRects(), function (r) {
        if (r.width > 1 && r.height > 1) rects.push(r);
      });
    }
    var lines = [];
    rects.forEach(function (r) {
      var line = lines.find(function (l) {
        return Math.abs(l.top - r.top) < r.height / 2;
      });
      if (line) {
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
      } else {
        lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
    });
    return lines;
  }

  // Where to attach strokes so they move with the element (including fixed navbars).
  function hostFor(el) {
    var host = el.offsetParent;
    if (!host || host === document.body || host === document.documentElement) {
      return { node: document.body, dx: window.scrollX, dy: window.scrollY };
    }
    var hr = host.getBoundingClientRect();
    return {
      node: host,
      dx: -hr.left - host.clientLeft + host.scrollLeft,
      dy: -hr.top - host.clientTop + host.scrollTop,
    };
  }

  function clear() {
    painted.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    painted = [];
  }

  function paint() {
    scheduled = false;
    clear();

    var seen = new Set();
    TARGETS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (seen.has(el) || el.closest(".brush-off")) return;
        seen.add(el);
        paintElement(el, seen.size);
      });
    });
  }

  function paintElement(el, index) {
    if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return; // hidden
    var host = hostFor(el);

    lineRects(el).forEach(function (line, li) {
      var h = line.bottom - line.top;
      var large = h > 36;
      STROKES.forEach(function (s, si) {
        var j = jitter(index * 31 + li * 7 + si);
        var stroke = document.createElement("span");
        stroke.className = "brush-stroke " + s.cls + (large ? " brush-stroke--lg" : "");
        stroke.setAttribute("aria-hidden", "true");
        var left = line.left - h * (s.left + j * 0.08);
        var right = line.right + h * (s.right + j * 0.1);
        var top = line.top + h * (s.top + j * 0.04);
        var bottom = line.bottom - h * s.bottom;
        stroke.style.left = left + host.dx + "px";
        stroke.style.top = top + host.dy + "px";
        stroke.style.width = Math.max(0, right - left) + "px";
        stroke.style.height = Math.max(0, bottom - top) + "px";
        stroke.style.filter = "url(#" + s.filter + (large ? "-lg" : "") + ")";
        stroke._base = "skewX(" + (s.skew + j * 1.5).toFixed(2) + "deg)";
        stroke._phase = (index * 3 + li * 5 + si) * 2.3; // desynchronize the wiggle
        stroke._layer = si; // position within its group of three, for depth swaps
        stroke._amp = large ? 1 : 0.45; // smaller text gets a gentler wiggle
        stroke.style.transform = stroke._base;
        host.node.appendChild(stroke);
        painted.push(stroke);
      });
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(paint);
  }

  // ---------------------------------------------------------------------------
  // Animation: a restless, hand-held wiggle. Each stroke drifts by about a
  // pixel and turns a fraction of a degree, driven by two sine waves at
  // unrelated speeds so the motion never visibly loops. Every couple of
  // seconds the three strokes in each group trade stacking order, which
  // shifts the blended color slightly. Runs at ~30fps, pauses in background
  // tabs, and is off entirely for visitors who prefer reduced motion.
  // ---------------------------------------------------------------------------

  var FRAME_MS = 33;
  var SWAP_MS = 2200;
  var DEPTH_ORDERS = [
    [1, 2, 3],
    [2, 3, 1],
    [3, 1, 2],
    [1, 3, 2],
    [2, 1, 3],
    [3, 2, 1],
  ];

  function animate() {
    var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var start = null;
    var last = 0;
    var lastOrder = -1;
    var rafId = null;

    function frame(now) {
      rafId = null;
      if (document.hidden || (motionQuery && motionQuery.matches)) return;
      rafId = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      if (start === null) start = now;
      var t = (now - start) / 1000;

      var order = Math.floor((now - start) / SWAP_MS) % DEPTH_ORDERS.length;
      var swap = order !== lastOrder;
      lastOrder = order;

      painted.forEach(function (stroke) {
        var ph = stroke._phase;
        var a = stroke._amp;
        var tx = (Math.sin(t * 3.1 + ph) * 0.9 + Math.sin(t * 7.3 + ph * 1.7) * 0.4) * a;
        var ty = (Math.cos(t * 2.7 + ph * 1.3) * 0.7 + Math.cos(t * 5.9 + ph) * 0.3) * a;
        var rot = Math.sin(t * 1.9 + ph) * 0.35 * a;
        stroke.style.transform = stroke._base + " translate(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px) rotate(" + rot.toFixed(2) + "deg)";
        if (swap) stroke.style.zIndex = String(DEPTH_ORDERS[order][stroke._layer]);
      });
    }

    function resume() {
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }

    document.addEventListener("visibilitychange", resume);
    if (motionQuery) {
      var onChange = function () {
        if (motionQuery.matches) {
          painted.forEach(function (stroke) {
            stroke.style.transform = stroke._base;
          });
        } else {
          resume();
        }
      };
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", onChange);
      else if (motionQuery.addListener) motionQuery.addListener(onChange);
    }
    resume();
  }

  function init() {
    ensureFilters();
    paint();
    animate();

    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

    // Layout shifts: abstracts/bibtex toggles, publication filter, collapsing navbar.
    if ("ResizeObserver" in window) {
      var lastHeight = 0;
      new ResizeObserver(function (entries) {
        var hgt = entries[0].contentRect.height;
        if (Math.abs(hgt - lastHeight) > 0.5) {
          lastHeight = hgt;
          schedule();
        }
      }).observe(document.body);
    }
    document.addEventListener("transitionend", schedule);
    document.addEventListener("click", function () {
      setTimeout(schedule, 50);
    });
    document.addEventListener("input", schedule);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
