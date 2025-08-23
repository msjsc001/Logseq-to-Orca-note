import { setupL10N, t } from "./libs/l10n";
import { importPageBatch } from "./importer";
import { parseLogseqGraph } from "./parser";
import zhCN from "./translations/zhCN";

let pluginName: string;

async function startImportProcess() {
  try {
    const settings = orca.state.plugins[pluginName]?.settings;
    if (!settings?.logseqPath || settings.logseqPath.trim() === "") {
      orca.notify("warn", "请先在插件设置中，正确输入您 Logseq 库的绝对路径。");
      return;
    }

    const logseqPath = settings.logseqPath;
    orca.notify("info", `准备从路径读取文件: ${logseqPath}`);

    // This is the dependency on the host environment.
    // We need Orca to provide an API to read files from a given directory path.
    const files = (await orca.invokeBackend("read-directory", logseqPath)) as {
      name: string; // This should be the relative path
      data: ArrayBuffer;
    }[];

    if (!files || files.length === 0) {
      orca.notify("warn", "无法读取文件夹，或文件夹为空。请检查路径和权限，或确认虎鲸笔记是否支持此操作。");
      return;
    }

    const mdFiles = files
      .filter((file) => file.name.endsWith(".md"))
      .map((file) => ({
        path: file.name,
        content: new TextDecoder().decode(file.data),
      }));

    if (mdFiles.length === 0) {
      orca.notify("warn", "在指定路径中没有找到 Markdown (.md) 文件。");
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
      orca.notify("error", `导入失败: ${error.message}. ` + '请确认虎鲸笔记是否有读取本地文件的API和权限。');
    } else {
      orca.notify("error", "发生未知错误。请检查控制台以获取详细信息。");
    }
  }
}

export async function load(_name: string) {
  pluginName = _name;
  setupL10N(orca.state.locale, { "zh-CN": zhCN });

  await orca.plugins.setSettingsSchema(pluginName, {
    logseqPath: {
      label: "Logseq 库路径",
      description: "请输入您 Logseq 笔记库的绝对路径。",
      type: "string",
      defaultValue: "",
    },
  });

  orca.commands.registerCommand(
    `${pluginName}.import`,
    startImportProcess,
    t("Logseq: 开始导入")
  );
  console.log(`${pluginName} loaded.`);
}

export async function unload() {
  orca.commands.unregisterCommand(`${pluginName}.import`);
  console.log(`${pluginName} unloaded.`);
}
