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
    const el = this.content.querySelector("img") || this.content.querySelector("svg")
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

// PlantUML text encoding for the public PlantUML server
// Algorithm: UTF-8 → deflate-raw → custom base64

function encode6bit(b: number): string {
  if (b < 10) return String.fromCharCode(48 + b)
  b -= 10
  if (b < 26) return String.fromCharCode(65 + b)
  b -= 26
  if (b < 26) return String.fromCharCode(97 + b)
  b -= 26
  if (b === 0) return "-"
  if (b === 1) return "_"
  return "?"
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6)
  const c4 = b3 & 0x3f
  return (
    encode6bit(c1 & 0x3f) +
    encode6bit(c2 & 0x3f) +
    encode6bit(c3 & 0x3f) +
    encode6bit(c4 & 0x3f)
  )
}

function encode64(data: Uint8Array): string {
  let r = ""
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      r += append3bytes(data[i], data[i + 1], 0)
    } else if (i + 1 === data.length) {
      r += append3bytes(data[i], 0, 0)
    } else {
      r += append3bytes(data[i], data[i + 1], data[i + 2])
    }
  }
  return r
}

async function encodePlantUML(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const cs = new CompressionStream("deflate-raw")
  const writer = cs.writable.getWriter()
  writer.write(data)
  writer.close()

  const reader = cs.readable.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const compressed = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    compressed.set(chunk, offset)
    offset += chunk.length
  }

  return encode64(compressed)
}

document.addEventListener("nav", async () => {
  const center = document.querySelector(".center") as HTMLElement
  if (!center) return

  const containers = center.querySelectorAll(
    "div.plantuml-container[data-plantuml]",
  ) as NodeListOf<HTMLElement>
  if (containers.length === 0) return

  // Hide <code> elements to prevent source code from showing
  const codeElements = center.querySelectorAll("code.plantuml") as NodeListOf<HTMLElement>
  for (const code of codeElements) {
    code.style.display = "none"
  }

  // Render all PlantUML diagrams
  for (const container of containers) {
    if (container.getAttribute("data-rendered") === "true") continue

    const diagramText = container.getAttribute("data-plantuml")
    if (!diagramText) continue

    try {
      const encoded = await encodePlantUML(diagramText)
      const img = document.createElement("img")
      img.src = `https://www.plantuml.com/plantuml/svg/${encoded}`
      img.alt = "PlantUML Diagram"
      container.innerHTML = ""
      container.appendChild(img)
      container.setAttribute("data-rendered", "true")
    } catch (e) {
      console.error("Failed to render PlantUML diagram:", e)
    }
  }

  // Setup expand buttons and popup with pan/zoom
  const allPres = center.querySelectorAll("pre") as NodeListOf<HTMLPreElement>
  for (const pre of allPres) {
    const pumlContainer = pre.querySelector(".plantuml-container[data-plantuml]") as HTMLElement
    if (!pumlContainer) continue

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

    const popupContainer = pre.querySelector(".diagram-popup.plantuml-popup") as HTMLElement
    if (!popupContainer) continue

    const space = popupContainer.querySelector(".diagram-popup-space") as HTMLElement
    let panZoom: DiagramPanZoom | null = null

    function showDiagram() {
      const content = popupContainer.querySelector(".diagram-popup-content") as HTMLElement
      if (!content || !space) return
      removeAllChildren(content)

      const img = pumlContainer.querySelector("img")
      if (!img) return

      const clonedImg = img.cloneNode(true) as HTMLImageElement
      // Capture original rendered pixel dimensions before cloning context changes,
      // same pattern markmap uses for its SVGs — ensures getBoundingClientRect()
      // returns correct values immediately inside the popup.
      const originalRect = img.getBoundingClientRect()
      clonedImg.style.width = `${originalRect.width}px`
      clonedImg.style.height = `${originalRect.height}px`
      clonedImg.style.maxWidth = "none"
      clonedImg.style.maxHeight = "none"
      content.appendChild(clonedImg)

      // Show popup then init pan-zoom synchronously (same order as mermaid)
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