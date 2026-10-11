const corners = ["top-left", "top-right", "bottom-left", "bottom-right"];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function miniRect(width, corner, viewport) {
  const gap = Math.min(16, viewport.width / 20, viewport.height / 20);
  const max = Math.max(1, Math.min(viewport.width - gap * 2, (viewport.height - gap * 2) * 16 / 9));
  const w = clamp(width, Math.min(240, max), max), h = w * 9 / 16;
  return { width: w, height: h,
    x: corner.endsWith("left") ? gap : viewport.width - gap - w,
    y: corner.startsWith("top") ? gap : viewport.height - gap - h };
}
export function nearestCorner(rect, viewport) {
  return `${rect.y + rect.height / 2 < viewport.height / 2 ? "top" : "bottom"}-${rect.x + rect.width / 2 < viewport.width / 2 ? "left" : "right"}`;
}
export class PreviewWindow {
  constructor(preview, dock, move, resize) {
    this.el = preview;
    this.dock = dock;
    this.move = move;
    this.resize = resize;
    this.corner = "bottom-right";
    this.width = Math.min(480, innerWidth * .45);
    this.theatre = false;
    try {
      const saved = JSON.parse(localStorage.getItem("wip-preview") || "{}");
      if (corners.includes(saved.corner)) this.corner = saved.corner;
      if (Number.isFinite(saved.width)) this.width = saved.width;
    } catch {}
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(dock);
    addEventListener("resize", () => this.layout());
    move.addEventListener("pointerdown", (e) => this.start(e, false));
    resize.addEventListener("pointerdown", (e) => this.start(e, true));
    move.addEventListener("keydown", (e) => {
      if (!e.key.startsWith("Arrow") || this.theatre || document.fullscreenElement) return;
      e.preventDefault();
      const [y, x] = this.corner.split("-");
      this.corner = `${e.key === "ArrowUp" ? "top" : e.key === "ArrowDown" ? "bottom" : y}-${e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : x}`;
      this.layout(); this.save();
    });
    resize.addEventListener("keydown", (e) => {
      if (!e.key.startsWith("Arrow")) return;
      e.preventDefault();
      this.width = this.rect.width + (["ArrowRight", "ArrowUp"].includes(e.key) ? 32 : -32);
      this.layout(); this.width = this.rect.width; this.save();
    });
    this.layout();
  }
  viewport() {
    return { width: innerWidth, height: Math.max(1, innerHeight - this.dock.getBoundingClientRect().height) };
  }
  layout() {
    if (this.drag) return;
    this.rect = miniRect(this.width, this.corner, this.viewport());
    this.draw(this.rect);
    this.el.dataset.corner = this.corner;
    this.move.title = `Drag to move · ${this.corner.replace("-", " ")} · arrow keys to snap`;
    this.resize.title = "Drag to resize · arrow keys to adjust";
  }
  draw(rect) {
    this.el.style.setProperty("--preview-x", `${rect.x}px`);
    this.el.style.setProperty("--preview-y", `${rect.y}px`);
    this.el.style.setProperty("--preview-width", `${rect.width}px`);
  }
  start(e, resizing) {
    if (e.button !== 0 || this.theatre || document.fullscreenElement) return;
    e.preventDefault();
    const handle = e.currentTarget, initial = { ...this.rect };
    this.drag = true;
    this.el.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
    const move = (event) => {
      const dx = event.clientX - e.clientX, dy = event.clientY - e.clientY;
      const vp = this.viewport();
      if (resizing) {
        const horizontal = dx * (this.corner.endsWith("left") ? 1 : -1);
        const vertical = dy * (this.corner.startsWith("top") ? 1 : -1) * 16 / 9;
        this.rect = miniRect(initial.width + (Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical), this.corner, vp);
      } else this.rect = { ...initial,
        x: clamp(initial.x + dx, 0, vp.width - initial.width),
        y: clamp(initial.y + dy, 0, vp.height - initial.height) };
      this.draw(this.rect);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      this.drag = false;
      this.el.classList.remove("dragging");
      if (resizing) this.width = this.rect.width;
      else this.corner = nearestCorner(this.rect, this.viewport());
      this.layout(); this.save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
  }
  setTheatre(on) {
    this.theatre = !!on;
    this.el.classList.toggle("theatre", this.theatre);
    document.body.classList.toggle("theatre-open", this.theatre);
    this.layout();
  }
  save() {
    try { localStorage.setItem("wip-preview", JSON.stringify({ width: this.width, corner: this.corner })); } catch {}
  }
}
