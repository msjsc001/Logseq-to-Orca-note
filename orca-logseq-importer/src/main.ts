import { setupL10N, t } from "./libs/l10n";
import { importPageBatch } from "./importer";
import { parseLogseqGraph } from "./parser";
import zhCN from "./translations/zhCN";
import { ImporterUI } from "./ui";
import type { LogseqFile } from "./parser";

let pluginName: string;

async function startImportProcess(files: LogseqFile[]) {
    try {
        const mdFiles = files.filter(f => f.path.endsWith('.md'));
        if (mdFiles.length === 0) {
            orca.notify("warn", "在所选文件夹中没有找到 Markdown (.md) 文件。");
            return;
        }

        orca.notify("info", `找到了 ${mdFiles.length} 个 Markdown 文件，开始解析...`);
        const graph = parseLogseqGraph(mdFiles);
        const allPages = Array.from(graph.pages.values());

        orca.notify("info", `解析完成: ${allPages.length} 个页面。开始分批导入...`);

        const BATCH_SIZE = 50;
        const uuidToDbIdMap = new Map<string, number>();
        for (let i = 0; i < allPages.length; i += BATCH_SIZE) {
            const batch = allPages.slice(i, i + BATCH_SIZE);
            await importPageBatch(batch, graph, uuidToDbIdMap);
            orca.notify("info", `导入进度: ${Math.min(i + BATCH_SIZE, allPages.length)} / ${allPages.length}`);
        }

        orca.notify("success", "所有批次导入完成！");

    } catch (error) {
        console.error("Logseq import failed:", error);
        if (error instanceof Error) {
            orca.notify("error", `导入失败: ${error.message}`);
        } else {
            orca.notify("error", "发生未知错误。请检查控制台以获取详细信息。");
        }
    }
}

function openImporterUI() {
    const existingRoot = document.getElementById("logseq-importer-root");
    if (existingRoot) {
        return;
    }

    const container = document.createElement("div");
    container.id = "logseq-importer-root";
    document.body.appendChild(container);

    const root = window.createRoot(container);

    const handleClose = () => {
        root.unmount();
        container.remove();
    };
    
    // @ts-ignore
    const ui = window.React.createElement(ImporterUI, {
        onFilesSelected: startImportProcess,
        onClose: handleClose,
    });
    root.render(ui);
}

export async function load(_name: string) {
  pluginName = _name;
  setupL10N(orca.state.locale, { "zh-CN": zhCN });

  orca.commands.registerCommand(
    `${pluginName}.import`,
    openImporterUI,
    t("Logseq: 开始导入")
  );
  console.log(`${pluginName} loaded.`);
}

export async function unload() {
  orca.commands.unregisterCommand(`${pluginName}.import`);
  const rootEl = document.getElementById("logseq-importer-root");
  if (rootEl) {
    rootEl.remove();
  }
  console.log(`${pluginName} unloaded.`);
}
