import type { Block } from "./orca.d";
import type { LogseqBlock, LogseqGraph, LogseqPage } from "./parser";

type ContentFragment = {
  t: string;
  v: any;
  f?: string;
  [key: string]: any;
};

type Repr = {
  type: string;
  level?: number;
  content: ContentFragment[];
  indent?: number;
  properties?: { name: string; value: any; type: number }[];
  [key: string]: any;
};

/**
 * Parses a single line of Logseq content into an array of Orca ContentFragments.
 * @param content The string content of a single Logseq block.
 * @param graph The entire Logseq graph, used to resolve block references.
 * @returns An array of ContentFragment objects.
 */
function parseContentToFragments(content: string, graph: LogseqGraph): ContentFragment[] {
  const fragments: ContentFragment[] = [];
  const regex = /(!\[[^\]]*\]\([^)]+\))|(\[\[[^\]]+\]\])|(#\S+)|(\(\(([^)]+)\)\))|\{\{embed \(\(([^)]+)\)\)\}\}/g;
  
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      fragments.push({ t: "t", v: content.substring(lastIndex, match.index) });
    }

    const [fullMatch, asset, link, tag, refUuid, embedUuid] = match;

    if (asset) {
      // Keep asset syntax as is, for potential future handling by Orca.
      fragments.push({ t: "t", v: asset });
    } else if (link) {
      const pageName = link.substring(2, link.length - 2);
      fragments.push({ t: "r", v: pageName });
    } else if (tag) {
      const tagName = tag.substring(1).replace(/\[\[/g, "").replace(/\]\]/g, ""); // Clean up tags like #[[tag]]
      fragments.push({ t: "r", v: tagName });
    } else if (refUuid) {
        const foundBlock = graph.blocks.get(refUuid);
        const refText = foundBlock ? `"${foundBlock.content.substring(0, 50)}..."` : refUuid;
        fragments.push({ t: "t", v: `[块引用: ${refText}]` });
    } else if (embedUuid) {
        const foundBlock = graph.blocks.get(embedUuid);
        const embedText = foundBlock ? `"${foundBlock.content.substring(0, 50)}..."` : embedUuid;
        fragments.push({ t: "t", v: `[块嵌入: ${embedText}]` });
    }
    
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    fragments.push({ t: "t", v: content.substring(lastIndex) });
  }

  return fragments;
}


/**
 * Converts Logseq blocks to Orca Repr objects recursively.
 * @param logseqBlocks The blocks to convert.
 * @param graph The full Logseq graph for context.
 * @param currentIndent The current indentation level.
 * @returns A flat array of Repr objects.
 */
function convertLogseqBlocksToReprs(logseqBlocks: LogseqBlock[], graph: LogseqGraph, currentIndent = 0): Repr[] {
  const reprs: Repr[] = [];
  for (const block of logseqBlocks) {
    const contentFragments = parseContentToFragments(block.content, graph);

    const repr: Repr = {
      type: "text",
      content: contentFragments,
      indent: currentIndent,
    };
    
    if (Object.keys(block.properties).length > 0) {
       repr.properties = Object.entries(block.properties).map(([name, value]) => ({ name, value: String(value), type: 1 }));
    }

    reprs.push(repr);

    if (block.children.length > 0) {
      reprs.push(...convertLogseqBlocksToReprs(block.children, graph, currentIndent + 1));
    }
  }
  return reprs;
}

/**
 * Imports a batch of Logseq pages into Orca Note.
 * @param pagesToImport An array of LogseqPage objects to import.
 * @param graph The entire Logseq graph.
 */
export async function importPageBatch(
  pagesToImport: LogseqPage[],
  graph: LogseqGraph
) {
  await orca.commands.invokeGroup(
    async () => {
      for (const page of pagesToImport) {
        await new Promise(resolve => setTimeout(resolve, 50)); 
        
        try {
          const pageProperties = page.properties.alias
            ? Object.entries(page.properties).map(([key, value]) => ({ name: key, value: Array.isArray(value) ? value.join(", ") : String(value), type: 1 }))
            : [];
          
          const pageBlockId = await orca.commands.invokeEditorCommand(
            "core.editor.insertBlock",
            null, null, null,
            [{ t: "t", v: page.name }],
            { type: "heading", level: 1, properties: pageProperties }
          );

          if (!pageBlockId) throw new Error(`Failed to create page block for "${page.name}"`);

          const pageBlock = await orca.invokeBackend("get-block", pageBlockId);
          if (!pageBlock) throw new Error(`Could not retrieve created page block for "${page.name}"`);
          
          if (page.blocks.length > 0) {
            const blockReprs = convertLogseqBlocksToReprs(page.blocks, graph);
            if (blockReprs.length > 0) {
              await orca.commands.invokeEditorCommand(
                "core.editor.batchInsertReprs",
                null, pageBlock, "lastChild", blockReprs
              );
            }
          }
          console.log(`[Importer] Successfully imported page: ${page.name}`);
        } catch (e: any) {
          console.error(`[Importer] Failed to import page "${page.name}":`, e);
          orca.notify("error", `导入页面 "${page.name}" 失败: ${e.message}`);
        }
      }
    },
    { undoable: true, topGroup: true }
  );
}