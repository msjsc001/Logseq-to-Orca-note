import type { Block, ContentFragment, Repr } from "./orca.d";
import type { LogseqBlock, LogseqGraph, LogseqPage } from "./parser";

// More specific regex to avoid capturing unintended parts.
const ATTACHMENT_REGEX = /(!?\[(.*?)\]\((.*?)\))\s*(\{:(.*?)\})?/;

/**
 * Pre-scans all pages to find local asset paths and uploads them to Orca.
 * Creates a mapping from old local paths to new Orca paths.
 */
async function preUploadAssetsAndGetPathMap(
  pagesToImport: LogseqPage[],
  logseqFolder: FileSystemDirectoryHandle,
): Promise<Map<string, string>> {
  const assetPathMap = new Map<string, string>();
  const allAssetPaths = new Set<string>();

  const collectPaths = (blocks: LogseqBlock[]) => {
    for(const block of blocks) {
        for (const match of block.content.matchAll(new RegExp(ATTACHMENT_REGEX, 'g'))) {
            const localPath = match[3];
            if (localPath.startsWith('../assets/')) {
                allAssetPaths.add(localPath);
            }
        }
        if(block.children.length > 0) {
            collectPaths(block.children);
        }
    }
  }

  for (const page of pagesToImport) {
    collectPaths(page.blocks);
  }

  if (allAssetPaths.size === 0) return assetPathMap;

  try {
    const assetsFolder = await logseqFolder.getDirectoryHandle('assets');
    const filesToUpload: File[] = [];
    const pathsToUpload: string[] = [];
    
    for (const originalPath of allAssetPaths) {
        const relativePath = originalPath.substring(10); // remove '../assets/'
        try {
            const fileHandle = await assetsFolder.getFileHandle(relativePath, { create: false });
            const file = await fileHandle.getFile();
            filesToUpload.push(file);
            pathsToUpload.push(originalPath);
        } catch (e) {
            console.warn(`[Assets] Asset file not found and skipped: ${relativePath}`, e);
        }
    }

    if (filesToUpload.length > 0) {
        orca.notify("info", `准备上传 ${filesToUpload.length} 个附件...`);
        const result = await orca.invokeBackend("upload-assets", filesToUpload);

        if (result && result.uploaded) {
            for (let i = 0; i < result.uploaded.length; i++) {
                assetPathMap.set(pathsToUpload[i], result.uploaded[i].path);
            }
        }
        if (result && result.failed && result.failed.length > 0) {
             orca.notify("warn", `${result.failed.length} 个附件上传失败。`);
             console.warn("[Assets] Failed to upload:", result.failed);
        }
    }
  } catch (e) {
      console.error("[Assets] Could not open 'assets' directory.", e);
      orca.notify("error", "无法打开 'assets' 文件夹，附件迁移失败。");
  }

  return assetPathMap;
}

/**
 * Parses a content string into an array of Orca ContentFragments.
 * This is the core transformation function.
 */
function parseContentToFragments(
  content: string,
  graph: LogseqGraph,
  assetPathMap: Map<string, string>
): ContentFragment[] {
  const fragments: ContentFragment[] = [];
  let buffer = "";
  let i = 0;

  const flushBuffer = () => {
    if (buffer) {
      fragments.push({ t: "t", v: buffer });
      buffer = "";
    }
  };

  while (i < content.length) {
    const remaining = content.substring(i);

    // 1. Block Embed: {{embed ((uuid))}}
    if (remaining.startsWith("{{embed ((")) {
      const endIdx = remaining.indexOf("))}}");
      if (endIdx !== -1) {
        flushBuffer();
        const uuid = remaining.substring(10, endIdx);
        const block = graph.blocks.get(uuid);
        fragments.push({ t: "r", v: block?.content || `未找到的块: ${uuid}`, q: uuid });
        i += endIdx + 4;
        continue;
      }
    }

    // 2. Block Reference: ((uuid))
    if (remaining.startsWith("((")) {
      const endIdx = remaining.indexOf("))");
      if (endIdx !== -1) {
        flushBuffer();
        const uuid = remaining.substring(2, endIdx);
        const block = graph.blocks.get(uuid);
        fragments.push({ t: "r", v: block?.content || `未找到的块: ${uuid}`, q: uuid });
        i += endIdx + 2;
        continue;
      }
    }

    // 3. Page Link or Tag: [[...]] or #[[...]]
    if (remaining.startsWith("[[") || remaining.startsWith("#[[")) {
      const isTag = remaining.startsWith("#");
      const startIdx = isTag ? 3 : 2;
      const endIdx = remaining.indexOf("]]");
      if (endIdx !== -1) {
        flushBuffer();
        const pageName = remaining.substring(startIdx, endIdx);
        fragments.push({ t: "r", v: pageName });
        i += endIdx + 2;
        continue;
      }
    }

    // 4. Simple Tag: #tag
    const tagMatch = remaining.match(/^#([^\s#\[\]]+)/);
    if (tagMatch) {
      flushBuffer();
      fragments.push({ t: "r", v: tagMatch[1] });
      i += tagMatch[0].length;
      continue;
    }

    // 5. Attachments
    const attachmentMatch = remaining.match(ATTACHMENT_REGEX);
    if (attachmentMatch) {
      flushBuffer();
      const [fullMatch, , altText, localPath, , attrs] = attachmentMatch;
      const newPath = assetPathMap.get(localPath);

      if (newPath) {
        const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(localPath);
        if (isImage) {
          const imageFragment: ContentFragment = { t: "i", v: newPath, a: altText };
          if(attrs) {
            const width = attrs.match(/:width\s+(\d+)/)?.[1];
            const height = attrs.match(/:height\s+(\d+)/)?.[1];
            if(width) imageFragment.w = parseInt(width);
            if(height) imageFragment.h = parseInt(height);
          }
          fragments.push(imageFragment);
        } else {
          fragments.push({ t: "t", v: altText || localPath.split('/').pop()!, f: "l", fa: { l: newPath, t: "_blank" } });
        }
      } else {
        fragments.push({ t: "t", v: `[附件未找到: ${localPath}]` });
      }
      i += fullMatch.length;
      continue;
    }

    buffer += content[i];
    i++;
  }

  flushBuffer();
  return fragments;
}

/**
 * Converts Logseq blocks to Orca Repr objects recursively, preserving hierarchy.
 */
function convertLogseqBlocksToReprs(
  logseqBlocks: LogseqBlock[],
  graph: LogseqGraph,
  assetPathMap: Map<string, string>,
  currentIndent = 0
): Repr[] {
  const reprs: Repr[] = [];
  for (const block of logseqBlocks) {
    const contentFragments = parseContentToFragments(block.content, graph, assetPathMap);

    const repr: Repr = {
      type: "text",
      content: contentFragments.length > 0 ? contentFragments : [{ t: 't', v: '' }],
      indent: currentIndent,
    };
    
    if (Object.keys(block.properties).length > 0) {
       repr.properties = Object.entries(block.properties).map(([name, value]) => ({ 
           name, 
           value: String(value), 
           type: 1 // PropType.Text
        }));
    }

    reprs.push(repr);

    if (block.children.length > 0) {
      reprs.push(...convertLogseqBlocksToReprs(block.children, graph, assetPathMap, currentIndent + 1));
    }
  }
  return reprs;
}

/**
 * Imports a batch of Logseq pages into Orca Note.
 */
export async function importPageBatch(
  pagesToImport: LogseqPage[],
  graph: LogseqGraph,
  logseqFolder: FileSystemDirectoryHandle,
) {
  orca.notify("info", "开始分析和上传附件...");
  const assetPathMap = await preUploadAssetsAndGetPathMap(pagesToImport, logseqFolder);
  orca.notify("success", "附件处理完成。");

  await orca.commands.invokeGroup(
    async () => {
      for (const page of pagesToImport) {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Shorter delay
        try {
          const pageProperties = Object.entries(page.properties).map(
            ([key, value]) => ({
              name: key,
              value: Array.isArray(value) ? value.join(", ") : String(value),
              type: 1, // PropType.Text
            })
          );
          
          const pageBlockId = await orca.commands.invokeEditorCommand(
            "core.editor.insertBlock", null, null, null,
            [{ t: "t", v: page.name }],
            { type: "heading", level: 1 }
          );

          if (!pageBlockId) throw new Error(`创建页面失败: "${page.name}"`);
          
          if(pageProperties.length > 0) {
              await orca.commands.invokeEditorCommand("core.editor.setProperties", null, [pageBlockId], pageProperties);
          }

          const pageBlock = await orca.invokeBackend("get-block", pageBlockId);
          if (!pageBlock) throw new Error(`获取页面块失败: "${page.name}"`);

          if (page.blocks.length > 0) {
            const blockReprs = convertLogseqBlocksToReprs(page.blocks, graph, assetPathMap);
            if (blockReprs.length > 0) {
              await orca.commands.invokeEditorCommand(
                "core.editor.batchInsertReprs", null, pageBlock, "lastChild", blockReprs
              );
            }
          }
        } catch (e: any) {
          console.error(`[Importer] 导入页面 "${page.name}" 失败:`, e);
          orca.notify("error", `导入页面 "${page.name}" 失败: ${e.message}`);
        }
      }
    },
    { undoable: true, topGroup: true }
  );
}