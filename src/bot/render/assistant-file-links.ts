import path from "node:path";
import type { Root, RootContent, PhrasingContent } from "mdast";
import { toString } from "mdast-util-to-string";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const processor = unified().use(remarkParse).use(remarkGfm);

export interface AssistantFileLink {
  path: string;
  name: string;
  start: number;
  end: number;
  label: string;
}

/** Interpret destinations in the server's project, never in the bot's filesystem. */
export function normalizeAssistantFilePath(source: string): string | undefined {
  try {
    const destination = source.split(/[?#]/u, 1)[0] ?? "";
    const decoded = decodeURIComponent(destination).replace(/\\/g, "/");
    if (!decoded || /[\u0000-\u001f\u007f:]/u.test(decoded) || decoded.startsWith("/"))
      return undefined;
    if (decoded.endsWith("/")) return undefined;
    const relative = path.posix.normalize(decoded);
    if (relative === "." || relative === ".." || relative.startsWith("../")) return undefined;
    return relative;
  } catch {
    return undefined;
  }
}

export function collectAssistantFileLinks(
  markdown: string,
  definitionSource = markdown,
): AssistantFileLink[] {
  const definitionRoot = processor.parse(definitionSource) as Root;
  const suffix =
    definitionSource === markdown
      ? ""
      : "\n\n" +
        definitionRoot.children
          .filter((node) => node.type === "definition")
          .map((node) =>
            definitionSource.slice(node.position?.start.offset, node.position?.end.offset),
          )
          .join("\n");
  const tree = definitionSource === markdown ? definitionRoot : processor.parse(markdown + suffix) as Root;
  const definitions = new Map<string, string>();
  const definitionTree = definitionRoot;
  for (const node of definitionTree.children) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  }
  const links: AssistantFileLink[] = [];
  const visit = (node: Root | RootContent | PhrasingContent): void => {
    if (
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "code" ||
      node.type === "inlineCode"
    )
      return;
    if (node.type === "link" || node.type === "linkReference") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const source = node.type === "link" ? node.url : definitions.get(node.identifier);
      const relative = source === undefined ? undefined : normalizeAssistantFilePath(source);
      // Autolinks also parse as links; only bracketed Markdown is a request.
      if (
        relative &&
        start !== undefined &&
        end !== undefined &&
        end <= markdown.length &&
        markdown[start] === "["
      ) {
        const first = node.children[0]?.position?.start.offset;
        const last = node.children.at(-1)?.position?.end.offset;
        links.push({
          path: relative,
          name: toString(node),
          start,
          end,
          label: first !== undefined && last !== undefined ? markdown.slice(first, last) : "",
        });
      }
      return;
    }
    if ("children" in node)
      for (const child of node.children) visit(child as RootContent | PhrasingContent);
  };
  visit(tree);
  return links;
}

export function projectAssistantFileLabels(
  markdown: string,
  links = collectAssistantFileLinks(markdown),
): string {
  for (const link of [...links].reverse())
    markdown = markdown.slice(0, link.start) + link.label + markdown.slice(link.end);
  return markdown;
}
