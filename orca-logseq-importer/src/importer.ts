import type { Block, DbId } from "./orca.d";
import type { LogseqBlock, LogseqGraph, LogseqPage } from "./parser";

export type UuidToDbIdMap = Map<string, number>;

export async function importPageBatch(
  pagesToImport: LogseqPage[],
  graph: LogseqGraph,
  uuidToDbIdMap: UuidToDbIdMap
) {
  const currentBatchDbIds = new Set<DbId>();

  // --- PASS 1: Create all blocks and properties for this batch ---
  await orca.commands.invokeGroup(
    async () => {
      for (const page of pagesToImport) {
        const pageBlockId = await orca.commands.invokeEditorCommand(
          "core.editor.insertBlock",
          null, null, null,
          [{ t: "t", v: page.name }],
          { type: "heading", level: 1 }
        );
        currentBatchDbIds.add(pageBlockId);
        await createBlocksRecursively(page.blocks, pageBlockId, uuidToDbIdMap, currentBatchDbIds);
      }
    },
    { undoable: true, topGroup: true }
  );

  // --- PASS 2: Link all references for newly created blocks ---
  console.log(`[Importer] Starting Pass 2 for a batch of ${currentBatchDbIds.size} blocks.`);
  const blocksToUpdate = (await orca.invokeBackend("get-blocks", Array.from(currentBatchDbIds))) as Block[];
  console.log(`[Importer] Fetched ${blocksToUpdate?.length ?? 0} blocks from backend for Pass 2.`);

  if (!blocksToUpdate || !Array.isArray(blocksToUpdate)) {
    console.error("[Importer] ERROR: `get-blocks` did not return an iterable array.", blocksToUpdate);
    orca.notify("error", "无法从后端获取已创建的块，链接步骤中止。");
    return;
  }

  await orca.commands.invokeGroup(
    async () => {
      for (const block of blocksToUpdate) {
        if (!block || !block.content) continue;
        
        const originalContent = block.text ?? "";
        let newContent = originalContent;

        const LINK_REGEX = /\[\[([^\]]+)\]\]/g;
        const TAG_REGEX = /#([^\s#\[\]\(\)]+)/g;
        const BLOCK_REF_REGEX = /\(\(([^\)]+)\)\)/g;
        const BLOCK_EMBED_REGEX = /\{\{embed \(\(([^\)]+)\)\}\}/g;
        const ASSET_REGEX = /!\[([^\]]*)\]\(\.\.\/(assets\/[^\)]+)\)/g;

        newContent = newContent.replace(ASSET_REGEX, "![$1](assets/$2)");
        newContent = newContent.replace(LINK_REGEX, (match, pageName) => `#[[((${pageName}))]]`);
        newContent = newContent.replace(TAG_REGEX, (match, tagName) => `#[[((${tagName}))]]`);
        newContent = newContent.replace(BLOCK_REF_REGEX, (match, blockUuid) => {
          const referencedDbId = uuidToDbIdMap.get(blockUuid);
          return referencedDbId ? `((${referencedDbId}))` : match;
        });
        newContent = newContent.replace(BLOCK_EMBED_REGEX, (match, blockUuid) => {
          const referencedDbId = uuidToDbIdMap.get(blockUuid);
          return referencedDbId ? `{{embed ((${referencedDbId}))}}` : match;
        });

        if (newContent !== originalContent) {
          console.log(`[Importer] Updating block ${block.id} with new content.`);
          await orca.commands.invokeEditorCommand("core.editor.updateBlock", null, block.id, [{ t: "t", v: newContent }]);
        }
      }
    },
    { undoable: true, topGroup: true }
  );
  console.log("[Importer] Finished Pass 2 for the batch.");
}

async function createBlocksRecursively(
  logseqBlocks: LogseqBlock[],
  parentDbId: number,
  uuidToDbIdMap: UuidToDbIdMap,
  batchDbIdSet: Set<DbId>
) {
  for (const block of logseqBlocks) {
    const parentBlock = orca.state.blocks[parentDbId];
    if (!parentBlock) {
      console.error(`[Importer] Could not find parent block with ID: ${parentDbId}`);
      continue;
    }
    const blockId = await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null, parentBlock, "lastChild",
      [{ t: "t", v: block.content }],
      { type: "text" }
    );
    batchDbIdSet.add(blockId);

    if (block.id) {
      uuidToDbIdMap.set(block.id, blockId);
    }

    if (Object.keys(block.properties).length > 0) {
      const propertiesToSet = Object.entries(block.properties).map(([name, value]) => ({ name, value }));
      await orca.commands.invokeEditorCommand("core.editor.setProperties", null, [blockId], propertiesToSet);
    }

    if (block.children.length > 0) {
      await createBlocksRecursively(block.children, blockId, uuidToDbIdMap, batchDbIdSet);
    }
  }
}