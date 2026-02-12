import { registerEscapeHandler, removeAllChildren } from "./util"

interface Position {
  x: number
  y: number
}

class DiagramPanZoom {
  private isDragging = false
  private startPan: Position = { x: 0, y: 0 }
  private currentPan: Position = { x: 0, y: 0 }
  private scale = 1
  private readonly MIN_SCALE = 0.5
  private readonly MAX_SCALE = 3

  cleanups: (() => void)[] = []

  constructor(
    private container: HTMLElement,
    private content: HTMLElement,
  ) {
    this.setupEventListeners()
    this.setupNavigationControls()
    this.resetTransform()
  }

  private setupEventListeners() {
    const mouseDownHandler = this.onMouseDown.bind(this)
    const mouseMoveHandler = this.onMouseMove.bind(this)
    const mouseUpHandler = this.onMouseUp.bind(this)
    const touchStartHandler = this.onTouchStart.bind(this)
    const touchMoveHandler = this.onTouchMove.bind(this)
    const touchEndHandler = this.onTouchEnd.bind(this)
    const resizeHandler = this.resetTransform.bind(this)

    this.container.addEventListener("mousedown", mouseDownHandler)
    document.addEventListener("mousemove", mouseMoveHandler)
    document.addEventListener("mouseup", mouseUpHandler)
    this.container.addEventListener("touchstart", touchStartHandler, { passive: false })
    document.addEventListener("touchmove", touchMoveHandler, { passive: false })
    document.addEventListener("touchend", touchEndHandler)
    window.addEventListener("resize", resizeHandler)

    this.cleanups.push(
      () => this.container.removeEventListener("mousedown", mouseDownHandler),
      () => document.removeEventListener("mousemove", mouseMoveHandler),
      () => document.removeEventListener("mouseup", mouseUpHandler),
      () => this.container.removeEventListener("touchstart", touchStartHandler),
      () => document.removeEventListener("touchmove", touchMoveHandler),
      () => document.removeEventListener("touchend", touchEndHandler),
      () => window.removeEventListener("resize", resizeHandler),
    )
  }

  cleanup() {
    for (const cleanup of this.cleanups) {
      cleanup()
    }
  }

  private setupNavigationControls() {
    const controls = document.createElement("div")
    controls.className = "diagram-controls"

    const zoomOut = this.createButton("\u2212", () => this.zoom(-0.1))
    const resetBtn = this.createButton("Reset", () => this.resetTransform())
    const zoomIn = this.createButton("+", () => this.zoom(0.1))

    controls.appendChild(zoomOut)
    controls.appendChild(resetBtn)
    controls.appendChild(zoomIn)

    this.container.appendChild(controls)
  }

  private createButton(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button")
    button.textContent = text
    button.className = "diagram-control-button"
    button.addEventListener("click", onClick)
    this.cleanups.push(() => button.removeEventListener("click", onClick))
    return button
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    this.isDragging = true
    this.startPan = { x: e.clientX - this.currentPan.x, y: e.clientY - this.currentPan.y }
    this.container.style.cursor = "grabbing"
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isDragging) return
    e.preventDefault()
    this.currentPan = {
      x: e.clientX - this.startPan.x,
      y: e.clientY - this.startPan.y,
    }
    this.updateTransform()
  }

  private onMouseUp() {
    this.isDragging = false
    this.container.style.cursor = "grab"
  }

  private onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    this.isDragging = true
    const touch = e.touches[0]
    this.startPan = { x: touch.clientX - this.currentPan.x, y: touch.clientY - this.currentPan.y }
  }

  private onTouchMove(e: TouchEvent) {
    if (!this.isDragging || e.touches.length !== 1) return
    e.preventDefault()
    const touch = e.touches[0]
    this.currentPan = {
      x: touch.clientX - this.startPan.x,
      y: touch.clientY - this.startPan.y,
    }
    this.updateTransform()
  }

  private onTouchEnd() {
    this.isDragging = false
  }

  private zoom(delta: number) {
    const newScale = Math.min(Math.max(this.scale + delta, this.MIN_SCALE), this.MAX_SCALE)
    const rect = this.content.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const scaleDiff = newScale - this.scale
    this.currentPan.x -= centerX * scaleDiff
    this.currentPan.y -= centerY * scaleDiff
    this.scale = newScale
    this.updateTransform()
  }

  private updateTransform() {
    this.content.style.transform = `translate(${this.currentPan.x}px, ${this.currentPan.y}px) scale(${this.scale})`
  }

  resetTransform() {
    const el = this.content.querySelector("svg") || this.content.querySelector("img")
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = rect.width / this.scale
    const height = rect.height / this.scale
    this.scale = 1
    this.currentPan = {
      x: (this.container.clientWidth - width) / 2,
      y: (this.container.clientHeight - height) / 2,
    }
    this.updateTransform()
  }
}

let markmapReady = false

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement("script")
    s.src = src
    // Persist across SPA navigations — Quartz removes head elements without data-persist
    s.setAttribute("data-persist", "")
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

async function ensureMarkmapLoaded(): Promise<void> {
  if (markmapReady) return
  const win = window as any
  win.markmap = win.markmap || {}
  win.markmap.autoLoader = { manual: true }
  await loadScript("https://cdn.jsdelivr.net/npm/markmap-autoloader@latest")
  markmapReady = true
}

function applyDarkMode() {
  const isDark = document.documentElement.getAttribute("saved-theme") === "dark"
  if (isDark) {
    document.documentElement.classList.add("markmap-dark")
  } else {
    document.documentElement.classList.remove("markmap-dark")
  }
}

document.addEventListener("nav", async () => {
  const center = document.querySelector(".center") as HTMLElement
  if (!center) return

  const containers = center.querySelectorAll(
    "div.markmap-container[data-markmap]",
  ) as NodeListOf<HTMLElement>
  if (containers.length === 0) return

  await ensureMarkmapLoaded()
  applyDarkMode()

  // Hide <code> elements and remove "markmap" class to prevent autoloader duplication
  const codeElements = center.querySelectorAll("code.markmap") as NodeListOf<HTMLElement>
  for (const code of codeElements) {
    code.style.display = "none"
    code.classList.remove("markmap")
  }

  function renderMarkmap(container: HTMLElement) {
    const content = container.getAttribute("data-markmap") || ""
    // Clear any existing content (SVG from previous render, old templates)
    // This is critical for SPA: micromorph may morph old containers keeping stale SVGs
    container.innerHTML = ""
    container.classList.add("markmap")
    const tmpl = document.createElement("script")
    tmpl.type = "text/template"
    tmpl.textContent = content
    container.appendChild(tmpl)
  }

  for (const container of containers) {
    renderMarkmap(container)
  }

  await new Promise((r) => requestAnimationFrame(r))
  const al = (window as any).markmap?.autoLoader
  if (al?.renderAll) {
    // renderAll() is async — it awaits initialize() which loads markmap-view
    // from CDN and injects the global <style> into document.body.
    // We MUST await it so the global CSS is in the DOM before we preserve it.
    await al.renderAll()
  }

  // Preserve markmap global CSS across SPA navigations.
  // markmap-autoloader injects a <style> with .markmap-link { fill: none } and other
  // critical rules into document.body once during initialize().
  // Quartz uses micromorph(document.body, html.body) for SPA which removes it.
  // Move it to <head> with data-persist so it survives both body morph and head cleanup.
  if (!document.head.querySelector("style[data-markmap-global]")) {
    const bodyStyles = document.body.querySelectorAll("style")
    for (const style of bodyStyles) {
      if (
        style.textContent?.includes(".markmap") ||
        style.textContent?.includes("markmap-link")
      ) {
        style.setAttribute("data-persist", "")
        style.setAttribute("data-markmap-global", "")
        document.head.appendChild(style)
        break
      }
    }
  }

  // Theme change listener — only toggle CSS class, do NOT re-render SVG
  function onThemeChange() {
    applyDarkMode()
  }
  document.addEventListener("themechange", onThemeChange)
  window.addCleanup(() => document.removeEventListener("themechange", onThemeChange))

  // Setup expand buttons and popup with pan/zoom
  const allPres = center.querySelectorAll("pre") as NodeListOf<HTMLPreElement>
  for (const pre of allPres) {
    const markmapDiv = pre.querySelector(".markmap-container[data-markmap]") as HTMLElement
    if (!markmapDiv) continue

    const clipboardBtn = pre.querySelector(".clipboard-button") as HTMLButtonElement
    const expandBtn = pre.querySelector(".expand-button") as HTMLButtonElement
    if (!expandBtn || !clipboardBtn) continue

    const clipboardStyle = window.getComputedStyle(clipboardBtn)
    const clipboardWidth =
      clipboardBtn.offsetWidth +
      parseFloat(clipboardStyle.marginLeft || "0") +
      parseFloat(clipboardStyle.marginRight || "0")

    expandBtn.style.right = `calc(${clipboardWidth}px + 0.3rem)`
    pre.prepend(expandBtn)

    const popupContainer = pre.querySelector(".diagram-popup.markmap-popup") as HTMLElement
    if (!popupContainer) continue

    const space = popupContainer.querySelector(".diagram-popup-space") as HTMLElement
    let panZoom: DiagramPanZoom | null = null

    function showDiagram() {
      const content = popupContainer.querySelector(".diagram-popup-content") as HTMLElement
      if (!content || !space) return
      removeAllChildren(content)

      const svg = markmapDiv.querySelector("svg")
      if (svg) {
        const clonedSvg = svg.cloneNode(true) as SVGElement
        // Capture the original rendered pixel dimensions before cloning context changes
        const originalRect = svg.getBoundingClientRect()
        // Set explicit pixel dimensions (not percentages) so the SVG renders
        // at a known size inside the popup, matching how mermaid handles its SVGs
        clonedSvg.style.width = `${originalRect.width}px`
        clonedSvg.style.height = `${originalRect.height}px`
        content.appendChild(clonedSvg)
      }

      // Show popup first, then init pan-zoom (same order as mermaid)
      popupContainer.classList.add("active")
      space.style.cursor = "grab"
      panZoom = new DiagramPanZoom(space, content)
    }

    function hideDiagram() {
      popupContainer.classList.remove("active")
      panZoom?.cleanup()
      panZoom = null
    }

    expandBtn.addEventListener("click", showDiagram)
    registerEscapeHandler(popupContainer, hideDiagram)
    window.addCleanup(() => {
      panZoom?.cleanup()
      expandBtn.removeEventListener("click", showDiagram)
    })
  }
})
