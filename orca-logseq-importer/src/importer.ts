/**
 * @file importer.ts
 * @description
 * This file contains the core logic for importing a parsed Logseq graph
 * into Orca Note. It handles block creation, property mapping, and linking.
 */

import type { Block, DbId } from "./orca.d";
import type { LogseqBlock, LogseqGraph } from "./parser";

// A mapping from Logseq's UUID to Orca's block ID (DbId)
export type UuidToDbIdMap = Map<string, number>;

/**
 * Imports a batch of parsed pages into Orca Note.
 *
 * @param pagesToImport The array of page objects to import in this batch.
 * @param graph The full graph, used to resolve block references.
 * @param uuidToDbIdMap A map to store and retrieve UUID-to-DbId mappings.
 */
export async function importPageBatch(
  pagesToImport: ReturnType<typeof import("./parser").parseLogseqFile>[],
  graph: LogseqGraph,
  uuidToDbIdMap: UuidToDbIdMap
) {
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
        await createBlocksRecursively(page.blocks, pageBlockId, uuidToDbIdMap);
      }
    },
    { undoable: true, topGroup: true }
  );

  // --- PASS 2: Link all references within this batch ---
  await orca.commands.invokeGroup(
    async () => {
      for (const [uuid, dbId] of uuidToDbIdMap) {
        const logseqBlock = graph.blocks.get(uuid);
        if (!logseqBlock) continue;

        let content = logseqBlock.content;
        const LINK_REGEX = /\[\[([^\]]+)\]\]/g;
        const TAG_REGEX = /#([^\s#\[\]\(\)]+)/g;
        const BLOCK_REF_REGEX = /\(\(([^\)]+)\)\)/g;
        const BLOCK_EMBED_REGEX = /\{\{embed \(\(([^\)]+)\)\}\}/g;
        const ASSET_REGEX = /!\[([^\]]*)\]\(\.\.\/(assets\/[^\)]+)\)/g;
        
        content = content.replace(ASSET_REGEX, "![$1](assets/$2)");
        content = content.replace(LINK_REGEX, (match, pageName) => `#[[((${pageName}))]]`);
        content = content.replace(TAG_REGEX, (match, tagName) => `#[[((${tagName}))]]`);
        content = content.replace(BLOCK_REF_REGEX, (match, blockUuid) => {
          const referencedDbId = uuidToDbIdMap.get(blockUuid);
          return referencedDbId ? `((${referencedDbId}))` : match;
        });
        content = content.replace(BLOCK_EMBED_REGEX, (match, blockUuid) => {
          const referencedDbId = uuidToDbIdMap.get(blockUuid);
          return referencedDbId ? `{{embed ((${referencedDbId}))}}` : match;
        });

        if (content !== logseqBlock.content) {
          await orca.commands.invokeEditorCommand("core.editor.updateBlock", null, dbId, [{ t: "t", v: content }]);
        }
      }
    },
    { undoable: true, topGroup: true }
  );
}

async function createBlocksRecursively(
  logseqBlocks: LogseqBlock[],
  parentDbId: number,
  uuidToDbIdMap: UuidToDbIdMap
) {
  for (const block of logseqBlocks) {
    const blockId = await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null, { id: parentDbId }, "lastChild",
      [{ t: "t", v: block.content }],
      { type: "text" }
    );

    if (block.id) {
      uuidToDbIdMap.set(block.id, blockId);
    }

    if (Object.keys(block.properties).length > 0) {
      const propertiesToSet = Object.entries(block.properties).map(([name, value]) => ({ name, value }));
      await orca.commands.invokeEditorCommand("core.editor.setProperties", null, [blockId], propertiesToSet);
    }

    if (block.children.length > 0) {
      await createBlocksRecursively(block.children, blockId, uuidToDbIdMap);
    }
  }
}