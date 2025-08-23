# 虎鲸笔记 Logseq 导入插件 (v1.0) - 开发全复盘与未来展望

## 1. 项目简介与当前状态

**目标**: 开发一个能将 Logseq 笔记库无损迁移至虎鲸笔记的插件。

**当前状态 (v1.0)**: **核心逻辑开发完成，但被一个最终的平台运行时错误阻塞。**

经过了漫长而曲折的调试，插件现已能够成功构建、加载并运行。然而，在执行导入逻辑时，我们遇到了一个与虎鲸笔记底层 API (`invokeEditorCommand`) 相关的、无法通过插件代码绕过的 `TypeError: (intermediate value) is not iterable` 错误。

本项目的所有核心代码，包括文件解析、数据结构转换和分批次导入的健壮性设计，均已完成。

## 2. 如何安装与使用

1.  **安装**: 将 `orca-logseq-importer` 文件夹完整地复制到虎鲸笔记的 `plugins` 目录 (可通过 `设置` > `关于` > `数据存储路径` 找到)。
2.  **重启**: **完全重启**虎鲸笔记应用。
3.  **运行**: 在 `设置` > `插件` 中确保 "Logseq Importer" 已启用。然后通过命令面板 (`Ctrl+P` 或 `Cmd+P`) 运行 **"Logseq: 开始导入"** 命令。
4.  **选择文件夹**: 在弹出的模态框中，点击 "选择文件夹开始导入" 按钮，然后选择您本地 Logseq 库的根文件夹。
5.  **监控进度**: 插件将通过屏幕右下角的通知，实时反馈文件读取、解析和导入的进度，直到遇到最终的运行时错误。

## 3. 开发历程与核心问题复盘 (重要经验)

本项目是探索虎鲸插件开发边界的一次宝贵实践。我们遇到的所有问题，都为未来的开发者提供了极具价值的参考。

### 3.1 核心挑战：构建与运行环境的“黑盒”

我们遇到的所有问题，从构建失败到运行时错误，最终都指向同一个根源：**虎鲸插件的运行环境是一个与标准 Web 开发环境有显著差异的“黑盒”**。

### 3.2 失败的探索与最终的解决方案

#### 场景一：文件/文件夹选择API

*   **错误的尝试**: 我们最初尝试调用 `orca.invokeBackend("upload-assets", ...)` 和一个假设的 `read-directory` API 来让用户选择文件夹。
*   **错误信息**: `TypeError: e.map is not a function`, `无法读取文件夹`。
*   **最终诊断与方案**: 开发者的回复点明了真相——**应该使用标准的 DOM API**。最终的、可靠的方案是在我们自己创建的 UI 中，使用 `<input type="file" webkitdirectory="true" />`。这个标准的 HTML5 元素能够可靠地触发系统级的文件夹选择对话框。

#### 场景二：自定义 React UI 渲染

*   **错误的尝试**: 我们在 `ui.tsx` 中使用 `import React from "react"` 和 `import { createRoot } from "react-dom/client"`，并尝试了**所有可能**的 Vite 构建配置。
*   **错误信息**: `Failed to resolve module specifier "react"` 和 `Cannot read properties of undefined (reading 'current')`。
*   **最终诊断与方案**: 开发者的回复和 `orca.d.ts` 的定义揭示了真相。
    1.  虎鲸的模块加载器**不支持裸模块说明符**（如 `"react"`）。
    2.  `orca.d.ts` 中明确定义了 `window.React` 和 `window.createRoot`，表明它们是全局可用的。
    3.  **最终的、正确的做法是**：在代码中**不使用 import**，而是直接从 `window` 对象上获取这两个核心依赖：`const { React, createRoot } = window;`。

**结论**: 虎鲸插件开发的最佳实践是，**尽可能依赖其在 `window` 对象上暴露的全局变量**，并谨慎处理 npm 依赖的打包策略，以避免与宿主环境的冲突。

## 4. 最终阻塞问题与给开发者的报告

在解决了所有加载和构建问题后，我们遇到了一个无法从插件层面解决的最终错误：

*   **问题现象**: 在执行导入，调用 `orca.commands.invokeEditorCommand("core.editor.insertBlock", ...)` 创建块时，控制台抛出 `TypeError: (intermediate value) is not iterable` 错误。
*   **问题分析**: 错误堆栈指向虎鲸笔记的内部函数。我们已确保所有传递给该 API 的参数（包括父块对象）都符合类型定义且不为空。这强烈表明，问题出在 `invokeGroup` 或 `invokeEditorCommand` 在处理连续、快速的块创建请求时，其内部状态管理出现了问题。
*   **给开发者的建议**: 为了支持类似的数据迁移功能，建议提供一个更上层、更稳定的**批量创建块**的 API。例如：
    ```typescript
    // 建议的 API
    orca.invokeBackend("io.createPageWithBlocks", {
        title: "页面标题",
        blocks: [/* 包含层级和内容的块对象数组 */]
    }): Promise<void>;
    ```
    由虎鲸后端来处理这个树状结构的创建，可以从根本上避免多次 API 调用带来的竞争状态和不稳定性。

## 5. 项目核心架构与未来展望

*   **核心架构**: 为实现大规模数据导入，插件已采用**分批处理**架构，保证了在 API 可用情况下的健壮性。
*   **未来优化**: 在核心 API 问题解决后，可在此代码基础上增加**断点续传**、**完整的附件物理迁移**和**更精细的错误处理**等功能。

## 6. 现有资源索引

*   `orca-logseq-importer/src/main.ts`: 插件主入口。
*   `orca-logseq-importer/src/ui.tsx`: 核心 UI 组件。
*   `orca-logseq-importer/src/parser.ts`: 核心解析器。
*   `orca-logseq-importer/src/importer.ts`: 核心导入器。
*   `orca-plugin-template-main/plugin-docs/API文档合并.md`: 合并后的完整 API 文档。