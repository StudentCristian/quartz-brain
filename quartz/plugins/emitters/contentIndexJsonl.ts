import { FilePath, FullSlug, SimpleSlug, joinSegments } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"

interface JsonlEntry {
  slug: FullSlug
  filePath: FilePath
  title: string
  tags: string[]
  links: SimpleSlug[]
  aliases: string[]
  content: string
  wordCount: number
}

function buildJsonlEntry(
  slug: FullSlug,
  filePath: FilePath,
  title: string,
  tags: string[],
  links: SimpleSlug[],
  aliases: string[],
  text: string,
): JsonlEntry {
  const content = text
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length
  return { slug, filePath, title, tags, links, aliases, content, wordCount } 
}

function generateJsonlContent(entries: JsonlEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n")
}

export const ContentIndexJsonl: QuartzEmitterPlugin = () => ({
  name: "ContentIndexJsonl",
  async *emit(ctx, content) {
    const entries: JsonlEntry[] = []

    for (const [_tree, file] of content) {
      const slug = file.data.slug!
      const text = file.data.text ?? ""

      if (text === "") continue

      entries.push(
        buildJsonlEntry(
          slug,
          file.data.relativePath!,
          file.data.frontmatter?.title!,
          file.data.frontmatter?.tags ?? [],
          file.data.links ?? [],
          file.data.aliases ?? [], 
          text,
        ),
      )
    }

    const fp = joinSegments("static", "contentIndex") as FullSlug
    yield write({
      ctx,
      content: generateJsonlContent(entries),
      slug: fp,
      ext: ".jsonl",
    })
  },
  async *partialEmit(ctx, content, _resources, changeEvents) {
    // Rebuild the full JSONL from current content, filtering out deleted files
    const deletedPaths = new Set(
      changeEvents.filter((e) => e.type === "delete").map((e) => e.path),
    )

    // Only regenerate if markdown files were affected
    const hasMdChanges = changeEvents.some((e) => e.path.endsWith(".md"))
    if (!hasMdChanges) return

    const entries: JsonlEntry[] = []

    for (const [_tree, file] of content) {
      const slug = file.data.slug!
      const relativePath = file.data.relativePath!
      const text = file.data.text ?? ""

      if (text === "") continue
      if (deletedPaths.has(relativePath)) continue

      entries.push(
        buildJsonlEntry(
          slug,
          relativePath,
          file.data.frontmatter?.title!,
          file.data.frontmatter?.tags ?? [],
          file.data.links ?? [],
          file.data.aliases ?? [],
          text,
        ),
      )
    }

    const fp = joinSegments("static", "contentIndex") as FullSlug
    yield write({
      ctx,
      content: generateJsonlContent(entries),
      slug: fp,
      ext: ".jsonl",
    })
  },
})
