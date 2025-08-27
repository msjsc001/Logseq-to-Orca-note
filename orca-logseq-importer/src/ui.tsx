import type { LogseqFile } from "./parser";

const { React } = window;
const { useState } = React;

interface ImporterUIProps {
  onConfirm: (
    directoryHandle: FileSystemDirectoryHandle,
    files: LogseqFile[]
  ) => void;
  onClose: () => void;
}

async function getFilesInDirectory(
  directoryHandle: FileSystemDirectoryHandle
): Promise<LogseqFile[]> {
  const files: LogseqFile[] = [];

  async function recurse(
    currentHandle: FileSystemDirectoryHandle,
    currentPath: string
  ) {
    // @ts-ignore
    for await (const entry of currentHandle.values()) {
      const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.kind === "file" && entry.name.endsWith(".md")) {
        const file = await entry.getFile();
        const content = await file.text();
        files.push({ path: newPath, content });
      } else if (entry.kind === "directory") {
        await recurse(entry, newPath);
      }
    }
  }

  await recurse(directoryHandle, "");
  return files;
}

export function ImporterUI({ onConfirm, onClose }: ImporterUIProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectFolder = async () => {
    try {
      // @ts-ignore
      const directoryHandle = await window.showDirectoryPicker();
      if (!directoryHandle) return;

      setIsLoading(true);
      orca.notify("info", "开始读取文件夹内容...");

      const logseqFiles = await getFilesInDirectory(directoryHandle);

      if (logseqFiles.length === 0) {
        orca.notify("warn", "在所选文件夹中没有找到 Markdown (.md) 文件。");
        setIsLoading(false);
        return;
      }
      
      onConfirm(directoryHandle, logseqFiles);
      onClose(); // Close UI after selection is confirmed

    } catch (err: any) {
      // Handle user cancellation gracefully
      if (err.name === 'AbortError') {
        console.log("Folder picker was cancelled by the user.");
      } else {
        console.error("Error selecting directory:", err);
        orca.notify("error", "选择文件夹失败。");
      }
    } finally {
       if (isLoading) setIsLoading(false);
    }
  };
  
  return React.createElement(
    // @ts-ignore
    orca.components.ModalOverlay,
    { visible: true, canClose: true, onClose: onClose },
    React.createElement(
      "div",
      { style: { padding: "20px", background: "var(--orca-color-bg-base)", borderRadius: "8px", width: "400px", textAlign: "center" as const } },
      React.createElement("h2", null, "Logseq 笔记导入"),
      React.createElement("p", { style: { margin: "20px 0" } }, "请选择您 Logseq 笔记库的根文件夹。此操作将读取该文件夹下的所有文件。"),
      React.createElement(
        // @ts-ignore
        orca.components.Button,
        {
          variant: "solid",
          onClick: isLoading ? undefined : handleSelectFolder,
          style: { opacity: isLoading ? 0.5 : 1 }
        },
        isLoading ? "正在读取..." : "选择文件夹开始导入"
      )
    )
  );
}