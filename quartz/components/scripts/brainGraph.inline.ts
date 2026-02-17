import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import {
  SimulationNodeDatum,
  SimulationLinkDatum,
  Simulation,
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  zoomIdentity,
  select,
  drag,
  zoom,
} from "d3"
import { Text, Graphics, Application, Container, Circle } from "pixi.js"
import { Group as TweenGroup, Tween as Tweened } from "@tweenjs/tween.js"
import { registerEscapeHandler, removeAllChildren } from "./util"
import { FullSlug, SimpleSlug, getFullSlug, resolveRelative, simplifySlug } from "../../util/path"
import { BrainD3Config } from "../BrainGraph"

type BrainRegion = {
  x: number
  y: number
  hemisphere: "left" | "right" | "center"
}

// Region anchors are mapped inside a two-lobe brain silhouette.
// The force is intentionally soft so graph keeps its rhizomatic behavior.
const BRAIN_REGIONS: Record<string, BrainRegion> = {
  executive: { x: 0.44, y: 0.34, hemisphere: "left" },
  logical: { x: 0.34, y: 0.5, hemisphere: "left" },
  creative: { x: 0.66, y: 0.5, hemisphere: "right" },
  core: { x: 0.56, y: 0.66, hemisphere: "right" },
  default: { x: 0.5, y: 0.54, hemisphere: "center" },
}

type GraphicsInfo = {
  color: string
  gfx: Graphics
  alpha: number
  active: boolean
}

type NodeData = {
  id: SimpleSlug
  text: string
  tags: string[]
  brain?: string
} & SimulationNodeDatum

type SimpleLinkData = {
  source: SimpleSlug
  target: SimpleSlug
}

type LinkData = {
  source: NodeData
  target: NodeData
} & SimulationLinkDatum<NodeData>

type LinkRenderData = GraphicsInfo & {
  simulationData: LinkData
}

type NodeRenderData = GraphicsInfo & {
  simulationData: NodeData
  label: Text
}

const localStorageKey = "brain-graph-visited"
function getVisited(): Set<SimpleSlug> {
  return new Set(JSON.parse(localStorage.getItem(localStorageKey) ?? "[]"))
}

function addToVisited(slug: SimpleSlug) {
  const visited = getVisited()
  visited.add(slug)
  localStorage.setItem(localStorageKey, JSON.stringify([...visited]))
}

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

async function renderBrainGraph(graph: HTMLElement, fullSlug: FullSlug) {
  const slug = simplifySlug(fullSlug)
  const visited = getVisited()
  removeAllChildren(graph)

  let {
    drag: enableDrag,
    zoom: enableZoom,
    depth,
    scale,
    repelForce,
    linkDistance,
    fontSize,
    opacityScale,
    removeTags,
    showTags,
    focusOnHover,
    centerForce,
    enableRadial,
  } = JSON.parse(graph.dataset["cfg"]!) as BrainD3Config

  const data: Map<SimpleSlug, ContentDetails> = new Map(
    Object.entries<ContentDetails>(await fetchData).map(([k, v]) => [
      simplifySlug(k as FullSlug),
      v,
    ]),
  )
  const links: SimpleLinkData[] = []
  const tags: SimpleSlug[] = []
  const validLinks = new Set(data.keys())

  const tweens = new Map<string, TweenNode>()
  for (const [source, details] of data.entries()) {
    const outgoing = details.links ?? []

    for (const dest of outgoing) {
      if (validLinks.has(dest)) {
        links.push({ source: source, target: dest })
      }
    }

    if (showTags) {
      const localTags = details.tags
        .filter((tag) => !removeTags.includes(tag))
        .map((tag) => simplifySlug(("tags/" + tag) as FullSlug))

      tags.push(...localTags.filter((tag) => !tags.includes(tag)))

      for (const tag of localTags) {
        links.push({ source: source, target: tag })
      }
    }
  }

  const neighbourhood = new Set<SimpleSlug>()
  const wl: (SimpleSlug | "__SENTINEL")[] = [slug, "__SENTINEL"]
  if (depth >= 0) {
    while (depth >= 0 && wl.length > 0) {
      const cur = wl.shift()!
      if (cur === "__SENTINEL") {
        depth--
        wl.push("__SENTINEL")
      } else {
        neighbourhood.add(cur)
        const outgoing = links.filter((l) => l.source === cur)
        const incoming = links.filter((l) => l.target === cur)
        wl.push(...outgoing.map((l) => l.target), ...incoming.map((l) => l.source))
      }
    }
  } else {
    validLinks.forEach((id) => neighbourhood.add(id))
    if (showTags) tags.forEach((tag) => neighbourhood.add(tag))
  }

  // Pre-compute effective brain region for tag nodes:
  // Each tag inherits the region of its most-connected content notes
  const tagBrainMap = new Map<SimpleSlug, string>()
  if (showTags) {
    for (const tag of tags) {
      if (!neighbourhood.has(tag)) continue
      // Find all content nodes connected to this tag
      const connectedBrains: Record<string, number> = {}
      for (const link of links) {
        let contentSlug: SimpleSlug | null = null
        if (link.source === tag) contentSlug = link.target
        else if (link.target === tag) contentSlug = link.source
        if (contentSlug && data.has(contentSlug)) {
          const brain = data.get(contentSlug)?.brain
          if (brain && BRAIN_REGIONS[brain]) {
            connectedBrains[brain] = (connectedBrains[brain] ?? 0) + 1
          }
        }
      }
      // Pick the region with most connections, or leave undefined
      const entries = Object.entries(connectedBrains)
      if (entries.length > 0) {
        entries.sort((a, b) => b[1] - a[1])
        tagBrainMap.set(tag, entries[0][0])
      }
    }
  }

  const nodes: NodeData[] = [...neighbourhood].map((url) => {
    const text = url.startsWith("tags/") ? "#" + url.substring(5) : (data.get(url)?.title ?? url)
    // Tags use inherited brain region; content notes use their own
    const brain = url.startsWith("tags/")
      ? tagBrainMap.get(url as SimpleSlug)
      : data.get(url)?.brain
    return {
      id: url,
      text,
      tags: data.get(url)?.tags ?? [],
      brain,
    }
  })
  const graphData: { nodes: NodeData[]; links: LinkData[] } = {
    nodes,
    links: links
      .filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target))
      .map((l) => ({
        source: nodes.find((n) => n.id === l.source)!,
        target: nodes.find((n) => n.id === l.target)!,
      })),
  }

  const width = graph.offsetWidth
  const height = Math.max(graph.offsetHeight, 250)

  const brainLayout = {
    centerX: width / 2,
    centerY: height / 2,
    lobeOffset: Math.min(width, height) * 0.14,
    lobeRadiusX: Math.min(width * 0.24, 180),
    lobeRadiusY: Math.min(height * 0.34, 200),
  }

  function regionTarget(region?: string): { x: number; y: number } {
    const anchor = region ? (BRAIN_REGIONS[region] ?? BRAIN_REGIONS.default) : BRAIN_REGIONS.default
    const hemisphereShift =
      anchor.hemisphere === "left"
        ? -brainLayout.lobeOffset
        : anchor.hemisphere === "right"
          ? brainLayout.lobeOffset
          : 0

    return {
      x: (anchor.x - 0.5) * (brainLayout.lobeRadiusX * 2.1) + hemisphereShift,
      y: (anchor.y - 0.5) * (brainLayout.lobeRadiusY * 2.2),
    }
  }

  function insideBrainShape(x: number, y: number): boolean {
    const rx = brainLayout.lobeRadiusX * 0.97
    const ry = brainLayout.lobeRadiusY * 0.9
    const leftCx = -brainLayout.lobeOffset * 0.92
    const rightCx = brainLayout.lobeOffset * 0.92

    const inLeft = (x - leftCx) ** 2 / rx ** 2 + y ** 2 / ry ** 2 <= 1
    const inRight = (x - rightCx) ** 2 / rx ** 2 + y ** 2 / ry ** 2 <= 1

    const cleft = Math.abs(x) < brainLayout.lobeOffset * 0.18 && y < -brainLayout.lobeRadiusY * 0.18
    const stem =
      x > brainLayout.lobeRadiusX * 0.12 &&
      x < brainLayout.lobeRadiusX * 0.56 &&
      y > brainLayout.lobeRadiusY * 0.34 &&
      y < brainLayout.lobeRadiusY * 1.08

    return ((inLeft || inRight) && !cleft) || stem
  }

  // Gives the layout a stable brain silhouette while preserving rhizomatic movement.
  function brainShapeForce(strength = 0.22) {
    const containStrength = strength
    let nodes: NodeData[] = []

    const force = (alpha: number) => {
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue
        if (insideBrainShape(node.x, node.y)) continue

        const region = regionTarget(node.brain)
        const pullX = (region.x - node.x) * alpha * containStrength
        const pullY = (region.y - node.y) * alpha * containStrength

        node.vx = (node.vx ?? 0) + pullX
        node.vy = (node.vy ?? 0) + pullY
      }
    }

    force.initialize = (newNodes: NodeData[]) => {
      nodes = newNodes
      for (const node of nodes) {
        if (node.x != null && node.y != null) continue
        const target = regionTarget(node.brain)
        node.x = target.x + (Math.random() - 0.5) * brainLayout.lobeRadiusX * 0.5
        node.y = target.y + (Math.random() - 0.5) * brainLayout.lobeRadiusY * 0.45
      }
    }

    return force
  }

  // Simulation — graph forces + forceX/forceY to prevent orphan nodes from drifting
  const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(graphData.nodes)
    .force("charge", forceManyBody().strength(-100 * repelForce))
    .force("center", forceCenter().strength(centerForce))
    .force("link", forceLink(graphData.links).distance(linkDistance))
    .force("collide", forceCollide<NodeData>((n) => nodeRadius(n)).iterations(3))
    .force("x", forceX<NodeData>((d) => regionTarget(d.brain).x).strength(0.12))
    .force("y", forceY<NodeData>((d) => regionTarget(d.brain).y).strength(0.14))
    .force("brain-shape", brainShapeForce(0.26))

  const radius = (Math.min(width, height) / 2) * 0.8
  if (enableRadial) simulation.force("radial", forceRadial(radius).strength(0.2))

  // precompute style prop strings as pixi doesn't support css variables
  const cssVars = [
    "--secondary",
    "--tertiary",
    "--gray",
    "--light",
    "--lightgray",
    "--dark",
    "--darkgray",
    "--bodyFont",
  ] as const
  const computedStyleMap = cssVars.reduce(
    (acc, key) => {
      acc[key] = getComputedStyle(document.documentElement).getPropertyValue(key)
      return acc
    },
    {} as Record<(typeof cssVars)[number], string>,
  )

  // brain region colors
  const brainColors: Record<string, string> = {
    executive: getComputedStyle(document.documentElement)
      .getPropertyValue("--brain-executive")
      .trim(),
    logical: getComputedStyle(document.documentElement).getPropertyValue("--brain-logical").trim(),
    creative: getComputedStyle(document.documentElement)
      .getPropertyValue("--brain-creative")
      .trim(),
    core: getComputedStyle(document.documentElement).getPropertyValue("--brain-core").trim(),
  }

  // Parse hex color to RGB components
  function hexToRgb(hex: string): [number, number, number] {
    hex = hex.replace(/^#/, "")
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    const n = parseInt(hex, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function rgbToHex(r: number, g: number, b: number): string {
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
  }

  // For unclassified nodes, compute a blended color based on proximity to brain region anchors
  function proximityColor(d: NodeData): string {
    const px = ((d.x ?? 0) + width / 2) / width
    const py = ((d.y ?? 0) + height / 2) / height
    const regionKeys = ["executive", "logical", "creative", "core"] as const
    let totalWeight = 0
    const weights: number[] = []
    for (const key of regionKeys) {
      const dx = px - BRAIN_REGIONS[key].x
      const dy = py - BRAIN_REGIONS[key].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const w = 1 / Math.max(dist, 0.01)
      weights.push(w)
      totalWeight += w
    }
    // Weighted average of region colors
    let r = 0,
      g = 0,
      b = 0
    for (let i = 0; i < regionKeys.length; i++) {
      const ratio = weights[i] / totalWeight
      const [cr, cg, cb] = hexToRgb(brainColors[regionKeys[i]])
      r += cr * ratio
      g += cg * ratio
      b += cb * ratio
    }
    // Desaturate toward gray (30% blend with gray) to keep them subtle
    const gray = hexToRgb(computedStyleMap["--gray"])
    return rgbToHex(
      Math.round(r * 0.45 + gray[0] * 0.55),
      Math.round(g * 0.45 + gray[1] * 0.55),
      Math.round(b * 0.45 + gray[2] * 0.55),
    )
  }

  const color = (d: NodeData) => {
    const isCurrent = d.id === slug
    if (isCurrent) {
      return computedStyleMap["--secondary"]
    } else if (d.brain && brainColors[d.brain]) {
      return brainColors[d.brain]
    } else if (visited.has(d.id) || d.id.startsWith("tags/")) {
      return computedStyleMap["--tertiary"]
    } else {
      return computedStyleMap["--gray"]
    }
  }

  function nodeRadius(d: NodeData) {
    const numLinks = graphData.links.filter(
      (l) => l.source.id === d.id || l.target.id === d.id,
    ).length
    return 2 + Math.sqrt(numLinks)
  }

  let hoveredNodeId: string | null = null
  let hoveredNeighbours: Set<string> = new Set()
  const linkRenderData: LinkRenderData[] = []
  const nodeRenderData: NodeRenderData[] = []
  function updateHoverInfo(newHoveredId: string | null) {
    hoveredNodeId = newHoveredId

    if (newHoveredId === null) {
      hoveredNeighbours = new Set()
      for (const n of nodeRenderData) {
        n.active = false
      }

      for (const l of linkRenderData) {
        l.active = false
      }
    } else {
      hoveredNeighbours = new Set()
      for (const l of linkRenderData) {
        const linkData = l.simulationData
        if (linkData.source.id === newHoveredId || linkData.target.id === newHoveredId) {
          hoveredNeighbours.add(linkData.source.id)
          hoveredNeighbours.add(linkData.target.id)
        }

        l.active = linkData.source.id === newHoveredId || linkData.target.id === newHoveredId
      }

      for (const n of nodeRenderData) {
        n.active = hoveredNeighbours.has(n.simulationData.id)
      }
    }
  }

  let dragStartTime = 0
  let dragging = false

  function renderLinks() {
    tweens.get("link")?.stop()
    const tweenGroup = new TweenGroup()

    for (const l of linkRenderData) {
      let alpha = 1

      if (hoveredNodeId) {
        alpha = l.active ? 1 : 0.2
      }

      l.color = l.active ? computedStyleMap["--gray"] : computedStyleMap["--lightgray"]
      tweenGroup.add(new Tweened<LinkRenderData>(l).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("link", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderLabels() {
    tweens.get("label")?.stop()
    const tweenGroup = new TweenGroup()

    const defaultScale = 1 / scale
    const activeScale = defaultScale * 1.1
    for (const n of nodeRenderData) {
      const nodeId = n.simulationData.id

      if (hoveredNodeId === nodeId) {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: 1,
              scale: { x: activeScale, y: activeScale },
            },
            100,
          ),
        )
      } else {
        tweenGroup.add(
          new Tweened<Text>(n.label).to(
            {
              alpha: n.label.alpha,
              scale: { x: defaultScale, y: defaultScale },
            },
            100,
          ),
        )
      }
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("label", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderNodes() {
    tweens.get("hover")?.stop()

    const tweenGroup = new TweenGroup()
    for (const n of nodeRenderData) {
      let alpha = 1

      if (hoveredNodeId !== null && focusOnHover) {
        alpha = n.active ? 1 : 0.2
      }

      tweenGroup.add(new Tweened<Graphics>(n.gfx, tweenGroup).to({ alpha }, 200))
    }

    tweenGroup.getAll().forEach((tw) => tw.start())
    tweens.set("hover", {
      update: tweenGroup.update.bind(tweenGroup),
      stop() {
        tweenGroup.getAll().forEach((tw) => tw.stop())
      },
    })
  }

  function renderPixiFromD3() {
    renderNodes()
    renderLinks()
    renderLabels()
  }

  tweens.forEach((tween) => tween.stop())
  tweens.clear()

  const app = new Application()
  await app.init({
    width,
    height,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    backgroundAlpha: 0,
    preference: "webgpu",
    resolution: window.devicePixelRatio,
    eventMode: "static",
  })
  graph.appendChild(app.canvas)

  const stage = app.stage
  stage.interactive = false

  const labelsContainer = new Container<Text>({ zIndex: 3, isRenderGroup: true })
  const nodesContainer = new Container<Graphics>({ zIndex: 2, isRenderGroup: true })
  const linkContainer = new Container<Graphics>({ zIndex: 1, isRenderGroup: true })
  const bgContainer = new Container<Graphics>({ zIndex: 0, isRenderGroup: true })
  stage.addChild(bgContainer, linkContainer, nodesContainer, labelsContainer)

  const brainOutline = new Graphics({ interactive: false, eventMode: "none" })
  const leftHemisphere = new Graphics({ interactive: false, eventMode: "none" })
  const rightHemisphere = new Graphics({ interactive: false, eventMode: "none" })
  const divider = new Graphics({ interactive: false, eventMode: "none" })
  const sulci = new Graphics({ interactive: false, eventMode: "none" })

  const top = brainLayout.centerY - brainLayout.lobeRadiusY * 0.92
  const bottom = brainLayout.centerY + brainLayout.lobeRadiusY * 0.9
  const leftEdge = brainLayout.centerX - brainLayout.lobeOffset - brainLayout.lobeRadiusX * 0.98
  const rightEdge = brainLayout.centerX + brainLayout.lobeOffset + brainLayout.lobeRadiusX * 0.98
  const crownY = brainLayout.centerY - brainLayout.lobeRadiusY * 1.06

  leftHemisphere
    .moveTo(brainLayout.centerX - 2, top + 8)
    .bezierCurveTo(
      brainLayout.centerX - brainLayout.lobeRadiusX * 0.62,
      crownY,
      leftEdge,
      brainLayout.centerY - brainLayout.lobeRadiusY * 0.45,
      leftEdge + 8,
      brainLayout.centerY + brainLayout.lobeRadiusY * 0.08,
    )
    .bezierCurveTo(
      leftEdge + 12,
      bottom - brainLayout.lobeRadiusY * 0.16,
      brainLayout.centerX - brainLayout.lobeRadiusX * 0.45,
      bottom,
      brainLayout.centerX - 6,
      bottom - 6,
    )
    .quadraticCurveTo(
      brainLayout.centerX - 12,
      brainLayout.centerY,
      brainLayout.centerX - 2,
      top + 8,
    )
    .fill({ color: brainColors.logical, alpha: 0.08 })

  rightHemisphere
    .moveTo(brainLayout.centerX + 2, top + 8)
    .bezierCurveTo(
      brainLayout.centerX + brainLayout.lobeRadiusX * 0.62,
      crownY,
      rightEdge,
      brainLayout.centerY - brainLayout.lobeRadiusY * 0.45,
      rightEdge - 8,
      brainLayout.centerY + brainLayout.lobeRadiusY * 0.08,
    )
    .bezierCurveTo(
      rightEdge - 12,
      bottom - brainLayout.lobeRadiusY * 0.16,
      brainLayout.centerX + brainLayout.lobeRadiusX * 0.45,
      bottom,
      brainLayout.centerX + 6,
      bottom - 6,
    )
    .quadraticCurveTo(
      brainLayout.centerX + 12,
      brainLayout.centerY,
      brainLayout.centerX + 2,
      top + 8,
    )
    .fill({ color: brainColors.creative, alpha: 0.08 })

  brainOutline
    .moveTo(brainLayout.centerX - 2, top + 6)
    .bezierCurveTo(
      brainLayout.centerX - brainLayout.lobeRadiusX * 0.58,
      crownY - 8,
      leftEdge,
      brainLayout.centerY - brainLayout.lobeRadiusY * 0.42,
      leftEdge + 8,
      brainLayout.centerY + brainLayout.lobeRadiusY * 0.08,
    )
    .bezierCurveTo(
      leftEdge + 12,
      bottom - brainLayout.lobeRadiusY * 0.14,
      brainLayout.centerX - brainLayout.lobeRadiusX * 0.42,
      bottom + 4,
      brainLayout.centerX,
      bottom - 8,
    )
    .bezierCurveTo(
      brainLayout.centerX + brainLayout.lobeRadiusX * 0.42,
      bottom + 4,
      rightEdge - 12,
      bottom - brainLayout.lobeRadiusY * 0.14,
      rightEdge - 8,
      brainLayout.centerY + brainLayout.lobeRadiusY * 0.08,
    )
    .bezierCurveTo(
      rightEdge,
      brainLayout.centerY - brainLayout.lobeRadiusY * 0.42,
      brainLayout.centerX + brainLayout.lobeRadiusX * 0.58,
      crownY - 8,
      brainLayout.centerX + 2,
      top + 6,
    )
    .stroke({ color: computedStyleMap["--lightgray"], alpha: 0.3, width: 2 })

  divider
    .moveTo(brainLayout.centerX, top + 8)
    .bezierCurveTo(
      brainLayout.centerX + 10,
      brainLayout.centerY - brainLayout.lobeRadiusY * 0.24,
      brainLayout.centerX - 8,
      brainLayout.centerY + brainLayout.lobeRadiusY * 0.26,
      brainLayout.centerX,
      bottom - 10,
    )
    .stroke({ color: computedStyleMap["--lightgray"], alpha: 0.38, width: 2 })

  const drawSulcus = (xFactor: number, bend: number) => {
    const x = brainLayout.centerX + brainLayout.lobeRadiusX * xFactor
    sulci
      .moveTo(x, brainLayout.centerY - brainLayout.lobeRadiusY * 0.65)
      .bezierCurveTo(
        x + bend,
        brainLayout.centerY - brainLayout.lobeRadiusY * 0.28,
        x - bend,
        brainLayout.centerY + brainLayout.lobeRadiusY * 0.15,
        x,
        brainLayout.centerY + brainLayout.lobeRadiusY * 0.52,
      )
  }

  drawSulcus(-0.52, 8)
  drawSulcus(-0.3, -10)
  drawSulcus(0.3, 10)
  drawSulcus(0.52, -8)
  sulci.stroke({ color: computedStyleMap["--lightgray"], alpha: 0.16, width: 1.5 })

  bgContainer.addChild(leftHemisphere, rightHemisphere, sulci, divider, brainOutline)

  for (const n of graphData.nodes) {
    const nodeId = n.id

    const label = new Text({
      interactive: false,
      eventMode: "none",
      text: n.text,
      alpha: 0,
      anchor: { x: 0.5, y: 1.2 },
      style: {
        fontSize: fontSize * 15,
        fill: computedStyleMap["--dark"],
        fontFamily: computedStyleMap["--bodyFont"],
      },
      resolution: window.devicePixelRatio * 4,
    })
    label.scale.set(1 / scale)

    let oldLabelOpacity = 0
    const isTagNode = nodeId.startsWith("tags/")
    const gfx = new Graphics({
      interactive: true,
      label: nodeId,
      eventMode: "static",
      hitArea: new Circle(0, 0, nodeRadius(n)),
      cursor: "pointer",
    })
      .circle(0, 0, nodeRadius(n))
      .fill({ color: isTagNode ? computedStyleMap["--light"] : color(n) })
      .on("pointerover", (e) => {
        updateHoverInfo(e.target.label)
        oldLabelOpacity = label.alpha
        if (!dragging) {
          renderPixiFromD3()
        }
      })
      .on("pointerleave", () => {
        updateHoverInfo(null)
        label.alpha = oldLabelOpacity
        if (!dragging) {
          renderPixiFromD3()
        }
      })

    if (isTagNode) {
      gfx.stroke({ width: 2, color: computedStyleMap["--tertiary"] })
    }

    nodesContainer.addChild(gfx)
    labelsContainer.addChild(label)

    const nodeRenderDatum: NodeRenderData = {
      simulationData: n,
      gfx,
      label,
      color: color(n),
      alpha: 1,
      active: false,
    }

    nodeRenderData.push(nodeRenderDatum)
  }

  for (const l of graphData.links) {
    const gfx = new Graphics({ interactive: false, eventMode: "none" })
    linkContainer.addChild(gfx)

    const linkRenderDatum: LinkRenderData = {
      simulationData: l,
      gfx,
      color: computedStyleMap["--lightgray"],
      alpha: 1,
      active: false,
    }

    linkRenderData.push(linkRenderDatum)
  }

  let currentTransform = zoomIdentity
  if (enableDrag) {
    select<HTMLCanvasElement, NodeData | undefined>(app.canvas).call(
      drag<HTMLCanvasElement, NodeData | undefined>()
        .container(() => app.canvas)
        .subject(() => graphData.nodes.find((n) => n.id === hoveredNodeId))
        .on("start", function dragstarted(event) {
          if (!event.active) simulation.alphaTarget(1).restart()
          event.subject.fx = event.subject.x
          event.subject.fy = event.subject.y
          event.subject.__initialDragPos = {
            x: event.subject.x,
            y: event.subject.y,
            fx: event.subject.fx,
            fy: event.subject.fy,
          }
          dragStartTime = Date.now()
          dragging = true
        })
        .on("drag", function dragged(event) {
          const initPos = event.subject.__initialDragPos
          event.subject.fx = initPos.x + (event.x - initPos.x) / currentTransform.k
          event.subject.fy = initPos.y + (event.y - initPos.y) / currentTransform.k
        })
        .on("end", function dragended(event) {
          if (!event.active) simulation.alphaTarget(0)
          event.subject.fx = null
          event.subject.fy = null
          dragging = false

          if (Date.now() - dragStartTime < 500) {
            const node = graphData.nodes.find((n) => n.id === event.subject.id) as NodeData
            const targ = resolveRelative(fullSlug, node.id)
            window.spaNavigate(new URL(targ, window.location.toString()))
          }
        }),
    )
  } else {
    for (const node of nodeRenderData) {
      node.gfx.on("click", () => {
        const targ = resolveRelative(fullSlug, node.simulationData.id)
        window.spaNavigate(new URL(targ, window.location.toString()))
      })
    }
  }

  if (enableZoom) {
    select<HTMLCanvasElement, NodeData>(app.canvas).call(
      zoom<HTMLCanvasElement, NodeData>()
        .extent([
          [0, 0],
          [width, height],
        ])
        .scaleExtent([0.25, 4])
        .on("zoom", ({ transform }) => {
          currentTransform = transform
          stage.scale.set(transform.k, transform.k)
          stage.position.set(transform.x, transform.y)

          const scale = transform.k * opacityScale
          let scaleOpacity = Math.max((scale - 1) / 3.75, 0)
          const activeNodes = nodeRenderData.filter((n) => n.active).flatMap((n) => n.label)

          for (const label of labelsContainer.children) {
            if (!activeNodes.includes(label)) {
              label.alpha = scaleOpacity
            }
          }
        }),
    )
  }

  let stopAnimation = false
  function animate(time: number) {
    if (stopAnimation) return
    for (const n of nodeRenderData) {
      const { x, y } = n.simulationData
      if (!x || !y) continue
      n.gfx.position.set(x + width / 2, y + height / 2)
      if (n.label) {
        n.label.position.set(x + width / 2, y + height / 2)
      }

      // Dynamic proximity-based color for unclassified nodes (gradient transitions)
      const d = n.simulationData
      const isTag = d.id.startsWith("tags/")
      if (!d.brain && !isTag && d.id !== slug && !visited.has(d.id)) {
        const newColor = proximityColor(d)
        n.gfx.clear()
        n.gfx.circle(0, 0, nodeRadius(d)).fill({ color: newColor })
      } else if (isTag) {
        // Tag nodes also get proximity tint (subtle)
        const newColor = proximityColor(d)
        n.gfx.clear()
        n.gfx
          .circle(0, 0, nodeRadius(d))
          .fill({ color: computedStyleMap["--light"] })
          .stroke({ width: 2, color: newColor })
      }
    }

    for (let li = 0; li < linkRenderData.length; li++) {
      const l = linkRenderData[li]
      const linkData = l.simulationData
      const sx = linkData.source.x! + width / 2
      const sy = linkData.source.y! + height / 2
      const tx = linkData.target.x! + width / 2
      const ty = linkData.target.y! + height / 2

      const dx = tx - sx
      const dy = ty - sy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 0.1) {
        l.gfx.clear()
        continue
      }

      // Rhizomatic cubic Bézier: two control points for S-curve dendrite-like paths
      // Alternate curvature direction based on link index for visual variety
      const sign = li % 2 === 0 ? 1 : -1
      const curveMag = Math.min(dist * 0.18, 25)
      // Perpendicular unit vector
      const px = -dy / dist
      const py = dx / dist
      // First control point at 1/3, offset perpendicular
      const cp1x = sx + dx * 0.33 + px * curveMag * sign
      const cp1y = sy + dy * 0.33 + py * curveMag * sign
      // Second control point at 2/3, offset in OPPOSITE direction (creates S-curve)
      const cp2x = sx + dx * 0.67 - px * curveMag * sign * 0.5
      const cp2y = sy + dy * 0.67 - py * curveMag * sign * 0.5

      l.gfx.clear()
      l.gfx.moveTo(sx, sy)
      l.gfx
        .bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty)
        .stroke({ alpha: l.alpha, width: 1, color: l.color })
    }

    tweens.forEach((t) => t.update(time))
    app.renderer.render(stage)
    requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
  return () => {
    stopAnimation = true
    app.destroy()
  }
}

let localBrainGraphCleanups: (() => void)[] = []
let globalBrainGraphCleanups: (() => void)[] = []

function cleanupLocalBrainGraphs() {
  for (const cleanup of localBrainGraphCleanups) {
    cleanup()
  }
  localBrainGraphCleanups = []
}

function cleanupGlobalBrainGraphs() {
  for (const cleanup of globalBrainGraphCleanups) {
    cleanup()
  }
  globalBrainGraphCleanups = []
}

document.addEventListener("nav", async (e: CustomEventMap["nav"]) => {
  const slug = e.detail.url
  addToVisited(simplifySlug(slug))

  async function renderLocalBrainGraph() {
    cleanupLocalBrainGraphs()
    const localGraphContainers = document.getElementsByClassName("brain-graph-container")
    for (const container of localGraphContainers) {
      localBrainGraphCleanups.push(await renderBrainGraph(container as HTMLElement, slug))
    }
  }

  await renderLocalBrainGraph()
  const handleThemeChange = () => {
    void renderLocalBrainGraph()
  }

  document.addEventListener("themechange", handleThemeChange)
  window.addCleanup(() => {
    document.removeEventListener("themechange", handleThemeChange)
  })

  const containers = [
    ...document.getElementsByClassName("global-brain-graph-outer"),
  ] as HTMLElement[]
  async function renderGlobalBrainGraph() {
    const slug = getFullSlug(window)
    for (const container of containers) {
      container.classList.add("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = "1"
      }

      const graphContainer = container.querySelector(".global-brain-graph-container") as HTMLElement
      registerEscapeHandler(container, hideGlobalBrainGraph)
      if (graphContainer) {
        globalBrainGraphCleanups.push(await renderBrainGraph(graphContainer, slug))
      }
    }
  }

  function hideGlobalBrainGraph() {
    cleanupGlobalBrainGraphs()
    for (const container of containers) {
      container.classList.remove("active")
      const sidebar = container.closest(".sidebar") as HTMLElement
      if (sidebar) {
        sidebar.style.zIndex = ""
      }
    }
  }

  async function shortcutHandler(e: HTMLElementEventMap["keydown"]) {
    if (e.key === "b" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      const anyGlobalGraphOpen = containers.some((container) =>
        container.classList.contains("active"),
      )
      anyGlobalGraphOpen ? hideGlobalBrainGraph() : renderGlobalBrainGraph()
    }
  }

  const containerIcons = document.getElementsByClassName("global-brain-graph-icon")
  Array.from(containerIcons).forEach((icon) => {
    icon.addEventListener("click", renderGlobalBrainGraph)
    window.addCleanup(() => icon.removeEventListener("click", renderGlobalBrainGraph))
  })

  document.addEventListener("keydown", shortcutHandler)
  window.addCleanup(() => {
    document.removeEventListener("keydown", shortcutHandler)
    cleanupLocalBrainGraphs()
    cleanupGlobalBrainGraphs()
  })
})
