(() => {
  // src/overlay/recording-overlay.js
  (() => {
    if (window.__fphdOverlay) return;
    const COLORS = ["#ef4444", "#f59e0b", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#111827"];
    const TOOLS = [
      ["pen", "Pen", "M3 21l3.8-1 11-11-2.8-2.8-11 11L3 21zM14.5 5.5l2.8 2.8"],
      ["highlighter", "Highlighter", "M4 20h7M14 4l6 6-8 8H6v-6l8-8z"],
      ["arrow", "Arrow", "M5 19L19 5M19 5h-8M19 5v8"],
      ["rect", "Rectangle", "M4 6h16v12H4z"],
      ["ellipse", "Circle", "M12 5a8 7 0 1 0 0.01 0z"],
      ["text", "Text", "M5 6V4h14v2M12 4v16M9 20h6"],
      ["eraser", "Eraser", "M16 3l5 5-11 11H5l-2-2L16 3zM9 19h12"]
    ];
    const st = {
      settings: {},
      mode: "tab",
      status: {},
      annotating: false,
      tool: "pen",
      color: "#ef4444",
      width: 4,
      shapes: [],
      history: [],
      future: [],
      drawing: null,
      cursor: { x: -100, y: -100, visible: false },
      ripples: [],
      raf: 0,
      collapsed: false
    };
    const host = document.createElement("div");
    host.id = "__fphd_root__";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
    canvas.draw { pointer-events: auto; cursor: crosshair; }
    .bar { position: fixed; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 4px; padding: 6px;
      background: rgba(17,24,39,.92); color: #fff; border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.35);
      pointer-events: auto; user-select: none; font-size: 13px; }
    .bar.hidden { display: none; }
    .grip { cursor: grab; padding: 0 4px; opacity: .6; }
    .time { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-variant-numeric: tabular-nums; font-weight: 600; min-width: 70px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; animation: blink 1s infinite; }
    .paused .dot { background: #f59e0b; animation: none; }
    @keyframes blink { 50% { opacity: .35; } }
    button { all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; color: #fff; }
    button:hover { background: rgba(255,255,255,.15); }
    button.on { background: #2563eb; }
    button.stop { background: #dc2626; }
    button.stop:hover { background: #b91c1c; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .tools { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); display: none; align-items: center; gap: 4px;
      padding: 6px 8px; background: rgba(17,24,39,.94); border-radius: 14px; pointer-events: auto; box-shadow: 0 6px 24px rgba(0,0,0,.35); color: #fff; }
    .tools.show { display: flex; }
    .sw { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); cursor: pointer; }
    .sw.sel { border-color: #fff; transform: scale(1.15); }
    .sep { width: 1px; height: 22px; background: rgba(255,255,255,.2); margin: 0 4px; }
    input[type=range] { width: 70px; }
    .countdown { position: fixed; inset: 0; display: none; place-items: center; background: rgba(0,0,0,.35); }
    .countdown.show { display: grid; }
    .countdown span { font-size: 160px; font-weight: 800; color: #fff; text-shadow: 0 8px 40px rgba(0,0,0,.5); }
    .toast { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); background: rgba(17,24,39,.94); color: #fff;
      padding: 8px 14px; border-radius: 10px; font-size: 13px; opacity: 0; transition: opacity .2s; }
    .toast.show { opacity: 1; }
    textarea.ti { position: fixed; pointer-events: auto; background: rgba(255,255,255,.08); border: 1px dashed currentColor;
      outline: none; resize: none; font-weight: 700; padding: 0; margin: 0; overflow: hidden; line-height: 1.25; }
  </style>
  <canvas class="ann"></canvas>
  <canvas class="fx"></canvas>
  <div class="countdown"><span></span></div>
  <div class="tools"></div>
  <div class="bar hidden">
    <span class="grip" title="Drag">\u22EE\u22EE</span>
    <span class="time"><i class="dot"></i><b>0:00</b></span>
    <button data-a="pause" title="Pause / resume"><svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg></button>
    <button data-a="stop" class="stop" title="Stop and save"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></svg></button>
    <button data-a="annotate" title="Draw on screen (Esc to exit)"><svg viewBox="0 0 24 24"><path d="M3 21l3.8-1 11-11-2.8-2.8-11 11L3 21z"/></svg></button>
    <button data-a="mute" title="Mute microphone"><svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
    <button data-a="webcam" title="Show / hide webcam"><svg viewBox="0 0 24 24"><path d="M3 7h12v10H3zM15 10l6-3v10l-6-3"/></svg></button>
    <button data-a="shot" title="Screenshot of the current frame"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
    <button data-a="cancel" title="Discard recording"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <button data-a="collapse" title="Minimise toolbar"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>
  </div>
  <div class="toast"></div>`;
    const $ = (s) => root.querySelector(s);
    const ann = $("canvas.ann");
    const fx = $("canvas.fx");
    const actx = ann.getContext("2d");
    const fctx = fx.getContext("2d");
    const bar = $(".bar");
    const tools = $(".tools");
    function resize() {
      const dpr = devicePixelRatio || 1;
      for (const c of [ann, fx]) {
        c.width = Math.round(innerWidth * dpr);
        c.height = Math.round(innerHeight * dpr);
      }
      actx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderShapes();
    }
    const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra }).catch(() => {
    });
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const a = b.dataset.a;
      if (a === "pause") send(st.status.state === "paused" ? "rec:resume" : "rec:pause");
      else if (a === "stop") send("rec:stop");
      else if (a === "cancel") {
        if (confirm("Discard this recording?")) send("rec:cancel");
      } else if (a === "annotate") setAnnotating(!st.annotating);
      else if (a === "mute") send("rec:mute", { muted: !st.status.muted });
      else if (a === "webcam") send("rec:webcam", { enabled: !st.status.webcamVisible });
      else if (a === "shot") send("rec:screenshot");
      else if (a === "collapse") {
        st.collapsed = !st.collapsed;
        updateBar();
      }
    });
    $(".grip").addEventListener("pointerdown", (e) => {
      const r = bar.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const mv = (ev) => {
        bar.style.left = `${Math.max(0, ev.clientX - ox)}px`;
        bar.style.top = `${Math.max(0, ev.clientY - oy)}px`;
        bar.style.bottom = "auto";
      };
      const up = () => {
        removeEventListener("pointermove", mv, true);
        removeEventListener("pointerup", up, true);
      };
      addEventListener("pointermove", mv, true);
      addEventListener("pointerup", up, true);
    });
    function fmt(sec) {
      sec = Math.floor(sec || 0);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${String(s).padStart(2, "0")}`;
    }
    function updateBar() {
      const s = st.status;
      const show = st.settings.showToolbar !== false && ["recording", "paused"].includes(s.state);
      bar.classList.toggle("hidden", !show);
      bar.classList.toggle("paused", s.state === "paused");
      $(".time b").textContent = s.state === "paused" ? `${fmt(s.elapsed)} \u275A\u275A` : fmt(s.elapsed);
      for (const b of bar.querySelectorAll("button")) {
        const a = b.dataset.a;
        if (st.collapsed && !["stop", "collapse", "pause"].includes(a)) b.style.display = "none";
        else b.style.display = "";
        if (a === "mute") {
          b.classList.toggle("on", !!s.muted);
          b.style.display = s.hasMic && !st.collapsed ? "" : "none";
        }
        if (a === "webcam") {
          b.classList.toggle("on", !!s.webcamVisible);
          b.style.display = s.webcam && !st.collapsed ? "" : "none";
        }
        if (a === "annotate") b.classList.toggle("on", st.annotating);
      }
      const cd = $(".countdown");
      cd.classList.toggle("show", s.state === "countdown");
      if (s.state === "countdown") cd.querySelector("span").textContent = s.countdown;
    }
    let toastTimer = 0;
    function toast(text) {
      const t = $(".toast");
      t.textContent = text;
      t.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
    }
    function buildTools() {
      tools.innerHTML = "";
      for (const [id, label, d] of TOOLS) {
        const b = document.createElement("button");
        b.title = label;
        b.dataset.tool = id;
        b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
        b.classList.toggle("on", st.tool === id);
        tools.append(b);
      }
      tools.append(Object.assign(document.createElement("span"), { className: "sep" }));
      for (const c of COLORS) {
        const s = document.createElement("span");
        s.className = `sw${c === st.color ? " sel" : ""}`;
        s.style.background = c;
        s.dataset.color = c;
        tools.append(s);
      }
      tools.append(Object.assign(document.createElement("span"), { className: "sep" }));
      const range = Object.assign(document.createElement("input"), { type: "range", min: 1, max: 24, value: st.width, title: "Thickness" });
      range.addEventListener("input", () => {
        st.width = Number(range.value);
      });
      tools.append(range);
      tools.append(Object.assign(document.createElement("span"), { className: "sep" }));
      for (const [a, label, d] of [["undo", "Undo", "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"], ["redo", "Redo", "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"], ["clear", "Clear all", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"], ["done", "Done (Esc)", "M5 12l5 5L20 7"]]) {
        const b = document.createElement("button");
        b.title = label;
        b.dataset.act = a;
        b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
        tools.append(b);
      }
    }
    tools.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tool]");
      const c = e.target.closest("[data-color]");
      const a = e.target.closest("[data-act]");
      if (t) {
        st.tool = t.dataset.tool;
        buildTools();
      } else if (c) {
        st.color = c.dataset.color;
        buildTools();
      } else if (a) {
        const act = a.dataset.act;
        if (act === "undo" && st.history.length) {
          st.future.push(st.shapes);
          st.shapes = st.history.pop();
          renderShapes();
        } else if (act === "redo" && st.future.length) {
          st.history.push(st.shapes);
          st.shapes = st.future.pop();
          renderShapes();
        } else if (act === "clear" && st.shapes.length) commit([]);
        else if (act === "done") setAnnotating(false);
      }
    });
    function setAnnotating(on) {
      st.annotating = on;
      ann.classList.toggle("draw", on);
      tools.classList.toggle("show", on);
      if (on) buildTools();
      updateBar();
    }
    function commit(next) {
      st.history.push(st.shapes);
      st.shapes = next;
      st.future = [];
      renderShapes();
    }
    function drawShape(ctx, s) {
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (s.type === "pen" || s.type === "highlighter") {
        if (s.type === "highlighter") {
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = s.width * 4;
        }
        ctx.beginPath();
        s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        ctx.stroke();
      } else if (s.type === "rect") ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
      else if (s.type === "ellipse") {
        ctx.beginPath();
        ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2 || 1, Math.abs(s.y2 - s.y1) / 2 || 1, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === "arrow") {
        const head = Math.max(12, s.width * 4);
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2 - Math.cos(ang) * head * 0.6, s.y2 - Math.sin(ang) * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2 - head * Math.cos(ang - 0.45), s.y2 - head * Math.sin(ang - 0.45));
        ctx.lineTo(s.x2 - head * Math.cos(ang + 0.45), s.y2 - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      } else if (s.type === "text") {
        ctx.font = `700 ${s.size}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(2, s.size / 8);
        ctx.strokeStyle = s.color === "#111827" ? "#fff" : "rgba(0,0,0,.55)";
        String(s.text).split("\n").forEach((l, i) => {
          ctx.strokeText(l, s.x1, s.y1 + i * s.size * 1.25);
          ctx.fillText(l, s.x1, s.y1 + i * s.size * 1.25);
        });
      }
      ctx.restore();
    }
    function renderShapes() {
      actx.clearRect(0, 0, innerWidth, innerHeight);
      for (const s of st.shapes) drawShape(actx, s);
      if (st.drawing) drawShape(actx, st.drawing);
    }
    function hit(s, x, y) {
      const tol = Math.max(10, (s.width || 4) * 2);
      if (s.pts) return s.pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < tol);
      if (s.type === "text") return x >= s.x1 - tol && y >= s.y1 - tol && x <= s.x1 + s.size * String(s.text).length * 0.6 && y <= s.y1 + s.size * 1.3 * String(s.text).split("\n").length;
      const x0 = Math.min(s.x1, s.x2) - tol;
      const x1 = Math.max(s.x1, s.x2) + tol;
      const y0 = Math.min(s.y1, s.y2) - tol;
      const y1 = Math.max(s.y1, s.y2) + tol;
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }
    function erase(x, y) {
      const i = st.shapes.findLastIndex((s) => hit(s, x, y));
      if (i >= 0) commit(st.shapes.filter((_, k) => k !== i));
    }
    function startText(x, y) {
      const size = Math.max(16, st.width * 6);
      const ta = document.createElement("textarea");
      ta.className = "ti";
      Object.assign(ta.style, { left: `${x}px`, top: `${y}px`, fontSize: `${size}px`, color: st.color, width: "320px", height: `${size * 1.4}px` });
      root.append(ta);
      setTimeout(() => ta.focus(), 0);
      const commit2 = () => {
        const text = ta.value.trimEnd();
        ta.remove();
        if (text) commit2([...st.shapes, { type: "text", x1: x, y1: y, text, color: st.color, size, width: st.width }]);
      };
      ta.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit2();
        }
        if (e.key === "Escape") {
          ta.value = "";
          commit2();
        }
        ta.style.height = `${Math.max(size * 1.4, ta.scrollHeight)}px`;
      });
      ta.addEventListener("blur", commit2, { once: true });
    }
    ann.addEventListener("pointerdown", (e) => {
      if (!st.annotating) return;
      e.preventDefault();
      const x = e.clientX;
      const y = e.clientY;
      if (st.tool === "text") {
        startText(x, y);
        return;
      }
      if (st.tool === "eraser") {
        erase(x, y);
        st.drawing = { type: "eraser" };
        ann.setPointerCapture(e.pointerId);
        return;
      }
      st.drawing = st.tool === "pen" || st.tool === "highlighter" ? { type: st.tool, pts: [[x, y]], color: st.color, width: st.width } : { type: st.tool, x1: x, y1: y, x2: x, y2: y, color: st.color, width: st.width };
      ann.setPointerCapture(e.pointerId);
    });
    ann.addEventListener("pointermove", (e) => {
      const d = st.drawing;
      if (!d) return;
      if (d.type === "eraser") {
        erase(e.clientX, e.clientY);
        return;
      }
      if (d.pts) d.pts.push([e.clientX, e.clientY]);
      else {
        d.x2 = e.clientX;
        d.y2 = e.clientY;
      }
      renderShapes();
    });
    const endDraw = () => {
      const d = st.drawing;
      st.drawing = null;
      if (!d || d.type === "eraser") return;
      if (d.pts ? d.pts.length > 1 : Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 3) commit([...st.shapes, d]);
      else renderShapes();
    };
    ann.addEventListener("pointerup", endDraw);
    ann.addEventListener("pointercancel", endDraw);
    function onMove(e) {
      st.cursor.x = e.clientX;
      st.cursor.y = e.clientY;
      st.cursor.visible = true;
      schedule();
    }
    function onDown(e) {
      if (!st.settings.clickEffects) return;
      st.ripples.push({ x: e.clientX, y: e.clientY, t: performance.now(), right: e.button === 2 });
      schedule();
    }
    function onLeave() {
      st.cursor.visible = false;
      schedule();
    }
    function schedule() {
      if (!st.raf) st.raf = requestAnimationFrame(drawFx);
    }
    function drawCursorArrow(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 17);
      ctx.lineTo(4.5, 13);
      ctx.lineTo(7.5, 20);
      ctx.lineTo(10.5, 18.7);
      ctx.lineTo(7.6, 12);
      ctx.lineTo(13, 12);
      ctx.closePath();
      ctx.fillStyle = "#111";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    function drawFx(now) {
      st.raf = 0;
      const s = st.settings;
      fctx.clearRect(0, 0, innerWidth, innerHeight);
      const c = st.cursor;
      if (c.visible && s.cursorHighlight) {
        const r = (s.cursorSize || 36) / 2;
        fctx.beginPath();
        fctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        fctx.fillStyle = hexA(s.cursorColor || "#facc15", 0.35);
        fctx.fill();
        fctx.lineWidth = 2;
        fctx.strokeStyle = hexA(s.cursorColor || "#facc15", 0.8);
        fctx.stroke();
      }
      const dur = 550;
      st.ripples = st.ripples.filter((r) => now - r.t < dur);
      for (const r of st.ripples) {
        const k = (now - r.t) / dur;
        const base = (s.cursorSize || 36) / 2;
        fctx.beginPath();
        fctx.arc(r.x, r.y, base * (0.6 + k * 1.4), 0, Math.PI * 2);
        const col = r.right ? s.clickColorRight || "#ef4444" : s.clickColorLeft || "#3b82f6";
        fctx.lineWidth = 3 * (1 - k) + 1;
        fctx.strokeStyle = hexA(col, 1 - k);
        fctx.stroke();
        fctx.fillStyle = hexA(col, 0.25 * (1 - k));
        fctx.fill();
      }
      if (c.visible && s.syntheticCursor && st.mode === "tab" && !st.annotating) drawCursorArrow(fctx, c.x, c.y);
      if (st.ripples.length) schedule();
    }
    function hexA(hex, a) {
      const h = hex.replace("#", "");
      const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
      return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
    }
    function onKey(e) {
      if (e.key === "Escape" && st.annotating) {
        setAnnotating(false);
        e.stopPropagation();
      }
    }
    function teardown() {
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerleave", onLeave);
      removeEventListener("keydown", onKey, true);
      removeEventListener("resize", resize);
      cancelAnimationFrame(st.raf);
      host.remove();
      chrome.runtime.onMessage.removeListener(onMessage);
      delete window.__fphdOverlay;
    }
    function onMessage(msg) {
      if (msg.type === "overlay:init") {
        st.settings = msg.settings || {};
        st.mode = msg.mode || "tab";
        updateBar();
        schedule();
      } else if (msg.type === "rec:status") {
        st.status = msg.status || {};
        updateBar();
        if (!st.status.active && ["done", "error", "cancelled"].includes(st.status.state)) teardown();
      } else if (msg.type === "overlay:annotate-toggle") setAnnotating(!st.annotating);
      else if (msg.type === "overlay:toast") toast(msg.text);
      else if (msg.type === "overlay:teardown") teardown();
    }
    chrome.runtime.onMessage.addListener(onMessage);
    addEventListener("pointermove", onMove, { capture: true, passive: true });
    addEventListener("pointerdown", onDown, { capture: true, passive: true });
    document.addEventListener("pointerleave", onLeave);
    addEventListener("keydown", onKey, true);
    addEventListener("resize", resize);
    (document.body || document.documentElement).appendChild(host);
    resize();
    window.__fphdOverlay = { teardown };
  })();
})();
//# sourceMappingURL=recording-overlay.js.map
