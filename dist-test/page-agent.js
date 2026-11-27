(() => {
  // src/screenshot/page-agent.js
  (() => {
    if (window.__fphdAgent) return;
    const STYLE_ID = "__fphd_capture_style__";
    const state = {
      target: null,
      // scrolling element (document.scrollingElement or an inner scroller)
      isDocument: true,
      origScroll: null,
      styleEl: null,
      modified: /* @__PURE__ */ new Map(),
      // element -> {visibility, position} original inline values
      fixedEls: [],
      stickyMode: "minimize",
      cancelled: false,
      escHandler: null
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    function docScroller() {
      return document.scrollingElement || document.documentElement;
    }
    function isScrollable(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return false;
      return el.scrollHeight > el.clientHeight + 40;
    }
    function findInnerScroller() {
      const vw = innerWidth;
      const vh = innerHeight;
      let best = null;
      let bestArea = 0;
      const probes = [[0.5, 0.5], [0.3, 0.6], [0.7, 0.4], [0.5, 0.8]];
      const seen = /* @__PURE__ */ new Set();
      for (const [px, py] of probes) {
        let el = document.elementFromPoint(vw * px, vh * py);
        while (el && !seen.has(el)) {
          seen.add(el);
          if (isScrollable(el)) {
            const r = el.getBoundingClientRect();
            const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
            if (area > bestArea) {
              best = el;
              bestArea = area;
            }
          }
          el = el.parentElement;
        }
      }
      if (best && bestArea >= vw * vh * 0.25) return best;
      return null;
    }
    function metrics() {
      const t = state.target;
      if (state.isDocument) {
        const de = document.documentElement;
        const b = document.body;
        const totalHeight = Math.max(t.scrollHeight, de.scrollHeight, b ? b.scrollHeight : 0, de.clientHeight);
        const totalWidth = Math.max(t.scrollWidth, de.scrollWidth, b ? b.scrollWidth : 0, de.clientWidth);
        return {
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          clientWidth: de.clientWidth,
          clientHeight: de.clientHeight,
          totalWidth,
          totalHeight,
          rect: { x: 0, y: 0, width: de.clientWidth, height: de.clientHeight },
          scrollX,
          scrollY,
          dpr: devicePixelRatio
        };
      }
      const r = t.getBoundingClientRect();
      const rect = {
        x: r.left + t.clientLeft,
        y: r.top + t.clientTop,
        width: t.clientWidth,
        height: t.clientHeight
      };
      const x0 = Math.max(0, rect.x);
      const y0 = Math.max(0, rect.y);
      const x1 = Math.min(innerWidth, rect.x + rect.width);
      const y1 = Math.min(innerHeight, rect.y + rect.height);
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        clientWidth: x1 - x0,
        clientHeight: y1 - y0,
        totalWidth: t.scrollWidth,
        totalHeight: t.scrollHeight,
        rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        scrollX: t.scrollLeft,
        scrollY: t.scrollTop,
        dpr: devicePixelRatio
      };
    }
    function scrollToRaw(x, y) {
      if (state.isDocument) window.scrollTo({ left: x, top: y, behavior: "instant" });
      else {
        state.target.scrollLeft = x;
        state.target.scrollTop = y;
      }
    }
    function remember(el) {
      if (!state.modified.has(el)) {
        state.modified.set(el, {
          visibility: el.style.getPropertyValue("visibility"),
          visibilityPrio: el.style.getPropertyPriority("visibility"),
          position: el.style.getPropertyValue("position"),
          positionPrio: el.style.getPropertyPriority("position"),
          transition: el.style.getPropertyValue("transition"),
          transitionPrio: el.style.getPropertyPriority("transition")
        });
      }
    }
    function scanFixed() {
      const vw = innerWidth;
      const vh = innerHeight;
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
      let el = walker.currentNode;
      let n = 0;
      while (el && n < 6e4) {
        n++;
        if (el.id !== "__fphd_root__") {
          const cs = getComputedStyle(el);
          const pos = cs.position;
          if (pos === "fixed" || pos === "sticky") {
            if (pos === "sticky" && state.stickyMode === "minimize") {
              remember(el);
              el.style.setProperty("position", "static", "important");
            } else if (pos === "fixed" && !state.fixedEls.some((f) => f.el === el)) {
              const r = el.getBoundingClientRect();
              const isBackground = r.width >= vw * 0.9 && r.height >= vh * 0.9;
              if (!isBackground && r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden") {
                state.fixedEls.push({ el, anchor: r.top + r.height / 2 > vh / 2 ? "bottom" : "top" });
              }
            }
          }
        }
        el = walker.nextNode();
      }
    }
    function setFixedVisibility(role) {
      if (state.stickyMode !== "minimize") return;
      for (const { el, anchor } of state.fixedEls) {
        const show = role === "only" || role === "first" && anchor === "top" || role === "last" && anchor === "bottom";
        remember(el);
        el.style.setProperty("transition", "none", "important");
        if (show) {
          const o = state.modified.get(el);
          if (o.visibility) el.style.setProperty("visibility", o.visibility, o.visibilityPrio);
          else el.style.removeProperty("visibility");
        } else {
          el.style.setProperty("visibility", "hidden", "important");
        }
      }
    }
    async function waitForImages(timeout) {
      const deadline = performance.now() + timeout;
      const imgs = [...document.images].filter((img) => {
        if (img.complete) return false;
        const r = img.getBoundingClientRect();
        return r.bottom > -innerHeight && r.top < innerHeight * 2;
      });
      for (const img of imgs) {
        const left = deadline - performance.now();
        if (left <= 0) break;
        await Promise.race([img.decode().catch(() => {
        }), sleep(left)]);
      }
    }
    const agent = {
      /** Prepare the page for capture. */
      prepare(opts = {}) {
        state.cancelled = false;
        state.stickyMode = opts.stickyMode || "minimize";
        const ds = docScroller();
        state.origScroll = { x: scrollX, y: scrollY };
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
        html, body { scroll-behavior: auto !important; scroll-snap-type: none !important; }
        * { scroll-snap-type: none !important; }
        ${opts.hideScrollbars ? "html, body { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }" : ""}
      `;
        (document.head || document.documentElement).appendChild(style);
        state.styleEl = style;
        state.isDocument = true;
        state.target = ds;
        const de = document.documentElement;
        const docScrollable = Math.max(ds.scrollHeight, de.scrollHeight) > innerHeight + 2;
        let innerInfo = null;
        if (!docScrollable) {
          const inner = findInnerScroller();
          if (inner) {
            state.isDocument = false;
            state.target = inner;
            state.origScroll = { x: inner.scrollLeft, y: inner.scrollTop, inner: true };
            innerInfo = { tag: inner.tagName.toLowerCase(), id: inner.id || "", cls: String(inner.className || "").slice(0, 60) };
          }
        }
        state.escHandler = (e) => {
          if (e.key === "Escape") state.cancelled = true;
        };
        addEventListener("keydown", state.escHandler, true);
        scrollToRaw(0, 0);
        scanFixed();
        const m = metrics();
        return {
          ...m,
          url: location.href,
          title: document.title,
          innerScroller: innerInfo,
          hasCrossOriginFrames: [...document.querySelectorAll("iframe")].some((f) => {
            try {
              return !f.contentDocument;
            } catch {
              return true;
            }
          })
        };
      },
      /** Scroll through the page to trigger lazy-loading. Returns the final metrics. */
      async preScroll({ delay = 200, maxHeight = 6e4 } = {}) {
        let m = metrics();
        const step = Math.max(200, Math.floor(m.clientHeight * 0.9));
        let y = 0;
        let guard = 0;
        while (y < Math.min(m.totalHeight, maxHeight) && guard++ < 2e3) {
          if (state.cancelled) return { cancelled: true };
          y += step;
          scrollToRaw(0, y);
          await sleep(delay);
          m = metrics();
        }
        await waitForImages(1500);
        scrollToRaw(0, 0);
        await sleep(Math.max(300, delay));
        await nextFrame();
        scanFixed();
        return metrics();
      },
      /** Scroll to an exact position, apply sticky rules for this frame and wait until painted. */
      async scrollTo({ x = 0, y = 0, role = "middle", delay = 300 } = {}) {
        if (state.cancelled) return { cancelled: true };
        scrollToRaw(x, y);
        scanFixed();
        setFixedVisibility(role);
        await sleep(delay);
        await waitForImages(Math.min(1200, delay * 3));
        scrollToRaw(x, y);
        await nextFrame();
        const m = metrics();
        return { ...m, cancelled: state.cancelled };
      },
      isCancelled() {
        return state.cancelled;
      },
      cancel() {
        state.cancelled = true;
        return true;
      },
      /** Restore every change made to the page. */
      restore() {
        for (const [el, o] of state.modified) {
          for (const prop of ["visibility", "position", "transition"]) {
            if (o[prop]) el.style.setProperty(prop, o[prop], o[`${prop}Prio`]);
            else el.style.removeProperty(prop);
          }
        }
        state.modified.clear();
        state.fixedEls = [];
        if (state.styleEl) state.styleEl.remove();
        state.styleEl = null;
        if (state.escHandler) removeEventListener("keydown", state.escHandler, true);
        if (state.origScroll) {
          if (state.origScroll.inner && state.target) {
            state.target.scrollLeft = state.origScroll.x;
            state.target.scrollTop = state.origScroll.y;
          } else window.scrollTo({ left: state.origScroll.x, top: state.origScroll.y, behavior: "instant" });
        }
        return true;
      },
      visibleInfo() {
        return { viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio, url: location.href, title: document.title, scrollX, scrollY };
      }
    };
    window.__fphdAgent = agent;
  })();
})();
//# sourceMappingURL=page-agent.js.map
