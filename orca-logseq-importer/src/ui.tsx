import type { LogseqFile } from "./parser";

// Directly use the globally exposed React and createRoot from Orca's environment
const { React, createRoot } = window;
const { useState, useRef } = React;

interface ImporterUIProps {
  onFilesSelected: (files: LogseqFile[]) => void;
  onClose: () => void;
}

export function ImporterUI({ onFilesSelected, onClose }: ImporterUIProps) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const htmlFiles = event.target.files;
    if (!htmlFiles || htmlFiles.length === 0) {
      return;
    }

    setIsLoading(true);
    orca.notify("info", `开始读取 ${htmlFiles.length} 个文件...`);

    const filePromises = Array.from(htmlFiles).map((file: File) => {
      return new Promise<LogseqFile>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          resolve({
            path: (file as any).webkitRelativePath || file.name,
            content,
          });
        };
        reader.onerror = (err) => reject(err);
        reader.readAsText(file);
      });
    });

    try {
      const logseqFiles = await Promise.all(filePromises);
      onFilesSelected(logseqFiles);
    } catch (error) {
      console.error("Error reading files:", error);
      orca.notify("error", "读取文件时发生错误。");
    } finally {
      setIsLoading(false);
      onClose();
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
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
      React.createElement("input", {
        type: "file",
        ref: fileInputRef,
        onChange: handleFileChange,
        style: { display: "none" },
        webkitdirectory: "true",
        directory: "true",
        multiple: true,
      }),
      React.createElement(
        // @ts-ignore
        orca.components.Button,
        {
          variant: "solid",
          onClick: isLoading ? undefined : handleButtonClick,
          style: { opacity: isLoading ? 0.5 : 1 }
        },
        isLoading ? "正在读取..." : "选择文件夹开始导入"
      )
    )
  );
}