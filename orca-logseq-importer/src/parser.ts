/**
 * @file parser.ts
 * @description
 * This file contains the logic for parsing Logseq graph data.
 * It is responsible for reading files, parsing blocks, and extracting metadata.
 */

// Note: In Orca's plugin environment, we cannot directly access the file system.
// We will need to use a method provided by the Orca API to get file handles
// or content, which we'll implement in a later stage (UI interaction).
// For now, we define the function signatures and data structures.

export interface LogseqFile {
  path: string; // Relative path, e.g., "pages/My Note.md"
  content: string;
}

export interface LogseqBlock {
  id: string | null; // The UUID if it exists
  content: string; // The raw text content of the block
  properties: Record<string, any>; // Block properties like key:: value
  children: LogseqBlock[];
  level: number; // Indentation level
}

export interface LogseqPage {
  name: string; // The note's title, derived from the file name
  properties: Record<string, any>; // Page-level properties from the top of the file
  blocks: LogseqBlock[];
}

export interface LogseqGraph {
  pages: Map<string, LogseqPage>;
  blocks: Map<string, LogseqBlock>; // UUID -> Block
}

const PROPERTY_REGEX = /^(\w+):: (.+)$/;
const ID_REGEX = /^id:: (.+)$/;
const BLOCK_CONTENT_REGEX = /^- (.+)/;

/**
 * Parses a single Logseq file into a structured LogseqPage object.
 *
 * @param file The LogseqFile object to parse.
 * @returns A LogseqPage object.
 */
export function parseLogseqFile(file: LogseqFile): LogseqPage {
  const page: LogseqPage = {
    name: file.path.replace(/\.md$/, "").split("/").pop() || "Untitled",
    properties: {},
    blocks: [],
  };

  const lines = file.content.split('\n');
    let currentBlock: LogseqBlock | null = null;
    const blockStack: LogseqBlock[] = []; // To manage hierarchy based on indentation

    let isFirstBlock = true;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const isBlockLine = trimmedLine.startsWith('- ');

        if (isFirstBlock && !isBlockLine) {
            // It's a page property
            const match = trimmedLine.match(PROPERTY_REGEX);
            if (match) {
                page.properties[match[1]] = match[2];
            }
            continue;
        }


        if (isBlockLine) {
            isFirstBlock = false;
            const indentation = line.match(/^\s*/)?.[0].length || 0;
            const level = indentation / 2; // Assuming 2 spaces per indent level

            const newBlock: LogseqBlock = {
                id: null,
                content: trimmedLine.substring(2),
                properties: {},
                children: [],
                level: level,
            };

            // Adjust hierarchy based on indentation
            while (blockStack.length > 0 && blockStack[blockStack.length - 1].level >= level) {
                blockStack.pop();
            }

            const parent = blockStack.length > 0 ? blockStack[blockStack.length - 1] : null;

            if (parent) {
                parent.children.push(newBlock);
            } else {
                page.blocks.push(newBlock);
            }

            blockStack.push(newBlock);
            currentBlock = newBlock;

        } else if (currentBlock) {
            // This line is a property or ID of the current block
            const idMatch = trimmedLine.match(ID_REGEX);
            if (idMatch) {
                currentBlock.id = idMatch[1];
                continue;
            }

            const propMatch = trimmedLine.match(PROPERTY_REGEX);
            if (propMatch) {
                currentBlock.properties[propMatch[1]] = propMatch[2];
            }
        }
    }

  return page;
}

/**
 * Parses all files in a Logseq graph and builds a structured data model.
 *
 * @param files An array of LogseqFile objects.
 * @returns A LogseqGraph object containing all pages and blocks.
 */
export function parseLogseqGraph(files: LogseqFile[]): LogseqGraph {
    const graph: LogseqGraph = {
        pages: new Map(),
        blocks: new Map(),
    };

    for (const file of files) {
        const page = parseLogseqFile(file);
        graph.pages.set(page.name, page);

        const recursivelyFindBlocks = (blocks: LogseqBlock[]) => {
            for (const block of blocks) {
                if (block.id) {
                    graph.blocks.set(block.id, block);
                }
                if (block.children.length > 0) {
                    recursivelyFindBlocks(block.children);
                }
            }
        };
        recursivelyFindBlocks(page.blocks);
    }

    return graph;
}
