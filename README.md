# Zotero PaperBridge

建议文件夹名：`PaperBridge`

简短产品名：`PaperBridge`

## 项目背景

当前论文阅读流程是：

1. 看到一篇论文。
2. 下载 PDF。
3. 交给大模型辅助阅读。
4. 在 Typora 中新建 Markdown 文件做阅读记录。
5. 按主题分类保存到 `D:\学\论文` 下，例如 `D:\学\论文\幻觉神经元`。

这个流程适合阅读和记录，但和 Zotero 割裂：

- 有价值的论文不一定会及时加入 Zotero。
- 后续导出 BibTeX、管理论文元数据、保存网页来源不方便。
- 如果阅读后再手动加入 Zotero，容易重复下载 PDF。
- Markdown 笔记、Zotero 条目、PDF 三者之间没有稳定关联。

本项目的目标是把 Zotero 作为论文元数据和 PDF 的主数据库，把 Typora/Markdown 作为阅读笔记主场，并在二者之间建立自动化桥接。

## 核心定位

`Zotero PaperBridge` 是一个 Zotero 插件。

它不替代 Zotero，也不替代 Typora，而是提供：

- Zotero 条目和本地 Markdown 阅读笔记之间的绑定。
- 根据 Zotero collection 自动创建 Markdown 笔记。
- 在 Zotero 列表中直接显示和操作笔记状态、阅读等级。
- 快速打开 Typora 笔记。
- 软删除论文条目和对应笔记，降低误操作风险。
- Windows 上关闭 Zotero 时隐藏到系统托盘，让 Zotero Connector 仍可继续保存论文。

## 目标环境

本机当前 Zotero 实际版本：

```text
D:\Zotero\app\application.ini
Version=9.0.4
```

因此插件可以按 Zotero 7 之后的新插件架构设计，优先使用官方的 item tree custom column、item pane section、Zotero JavaScript API 和 notification system。

## 推荐工作流

### 1. 保存论文

用户在论文网页中通过 Zotero Connector 保存论文。

Zotero 负责：

- 创建论文条目。
- 保存标题、作者、DOI、URL、出版信息等元数据。
- 在可用时自动保存 PDF。
- 将条目放入用户选择的 collection。

例如用户选择 collection：

```text
幻觉神经元
```

### 2. 自动创建 Markdown 阅读笔记

插件监听到新论文条目加入 collection 后，根据 collection 名称映射到本地目录：

```text
Zotero collection: 幻觉神经元
Markdown directory: D:\学\论文\幻觉神经元
```

然后自动创建阅读笔记：

```text
D:\学\论文\幻觉神经元\ricco2024_geometric - A Geometric Analysis of Small-sized Language Model Hallucinations.md
```

文件名建议使用：

```text
citekey - short title.md
```

原因：

- 纯论文标题太长。
- 标题可能重名。
- Windows 文件名有非法字符限制。
- citekey 能和 BibTeX、Markdown 引用保持一致。

### 3. Markdown frontmatter

每篇笔记自动生成固定 frontmatter：

```yaml
---
title: "A Geometric Analysis of Small-sized Language Model Hallucinations"
citekey: "ricco2024_geometric"
zotero_key: "ABCD1234"
collection: "幻觉神经元"
primary_collection: "幻觉神经元"
rank:
status: unread
doi:
url: "https://example.com/paper"
pdf: "zotero://open-pdf/library/items/XXXXXXX"
zotero: "zotero://select/library/items/ABCD1234"
created: "2026-05-30"
updated: "2026-05-30"
---
```

### 4. 反向绑定 Zotero 条目

插件把 Markdown 文件作为 linked attachment 挂到 Zotero 条目下。

附件标题建议为：

```text
Markdown Reading Note
```

这样 Zotero 中的一个论文条目会绑定：

- Zotero 元数据。
- Zotero PDF 附件。
- 本地 Markdown 阅读笔记。

## Zotero 列表交互

主交互不依赖右键菜单，而是直接在 Zotero 条目列表中完成。

插件新增两列：

```text
笔记    等级
 M       1
 +       
 !       x
```

### 笔记列

显示值：

```text
+    没有 Markdown 笔记，点击后创建并绑定
M    已有 Markdown 笔记，点击后用 Typora 打开
!    已绑定但文件丢失或 frontmatter 异常，点击后进入修复/重连
```

交互：

- 单击 `+`：创建 Markdown 文件，并作为 linked attachment 绑定到 Zotero 条目。
- 单击 `M`：打开对应 Markdown 文件。
- 单击 `!`：frontmatter 异常时提示修复；文件丢失时可选择已有 Markdown 重新绑定，或重新生成 Markdown 文件。

### 等级列

显示值：

```text
空    未读 / 未判断
1     核心参考
2     重要参考
3     一般有用
4     低优先级
x     准备删除
```

交互：

- 单击等级单元格：弹出小浮层，选项为 `空 1 2 3 4 x`。
- 选中条目后按 `1`、`2`、`3`、`4`：设置等级。
- 选中条目后按 `0`：清空等级。
- 选中条目后按 `X`：标记为待删除。

`x` 只是删除标记，不会立刻删除；只有执行 `清理 x` 时才触发软删除。

## 删除策略

删除必须使用软删除。

当论文被标记为 `x` 时：

- Zotero 条目保留。
- Markdown 笔记保留。
- 条目增加待删除标记。
- 等级列显示 `x`。

用户执行 `清理 x` 后：

- Zotero 条目移入 Zotero Trash。
- Markdown 笔记直接删除，并进入 Windows 系统回收站。
- 不创建或使用 `D:\学\论文\.trash`。

## Windows 托盘驻留

在 Windows 上，插件可以把 Zotero 的关闭行为改为隐藏到系统托盘：

- 点击主窗口 `X`、`Alt+F4` 等常规关闭操作时，不退出 Zotero。
- Zotero 主窗口从桌面和任务栏隐藏，后台进程继续运行。
- 浏览器 Zotero Connector 仍可把论文保存到本机 Zotero。
- 点击托盘图标可以恢复 Zotero 主窗口。
- `Tools` 菜单中提供 `PaperBridge: 隐藏到托盘` 和 `PaperBridge: 退出 Zotero`。

实现上采用 Zotero bootstrap 插件和 Windows tray helper 的混合架构：

- Zotero 插件负责拦截关闭事件、启动 helper、发送隐藏/恢复命令。
- `chrome/content/tray-helper.ps1` 负责创建托盘图标，并调用 Win32 API 隐藏或恢复窗口。
- 插件和 helper 通过 `127.0.0.1:<trayPort>` 本地 HTTP 命令通信，默认端口为 `23128`。
- 本地命令带有 profile 内生成的 `trayToken`，并校验 `PaperBridge:OK` 响应，避免误连到占用同一端口的其他进程。
- helper 会监控 Zotero 进程；如果 Zotero 已退出，helper 会自动退出。
- 非 Windows 系统不会启用真实托盘；关闭拦截关闭时会退化为普通最小化。

## 数据存储策略

等级和状态优先存储为 Zotero tag，而不是只存在插件私有数据库中。

建议 tag：

```text
paperbridge/rank/1
paperbridge/rank/2
paperbridge/rank/3
paperbridge/rank/4
paperbridge/rank/x
paperbridge/status/unread
paperbridge/status/reading
paperbridge/status/read
```

这样即使插件停用，用户仍然可以在 Zotero 中搜索、筛选、批量处理这些状态。

插件内部可以维护一个轻量索引，用于快速定位 Markdown 路径：

```json
{
  "1:ABCD1234": {
    "note_path": "D:\\学\\论文\\幻觉神经元\\ricco2024_geometric - A Geometric Analysis.md",
    "primary_collection": "幻觉神经元",
    "zotero_key": "ABCD1234",
    "library_id": 1,
    "citekey": "ricco2024_geometric",
    "rank": "1"
  }
}
```

但索引只能作为缓存，不应成为唯一数据源。

## Collection 和文件夹映射

默认映射规则：

```text
D:\学\论文\<Zotero collection name>
```

例如：

```text
幻觉神经元 -> D:\学\论文\幻觉神经元
LLM 安全 -> D:\学\论文\LLM 安全
Mechanistic Interpretability -> D:\学\论文\Mechanistic Interpretability
```

注意：Zotero 一个条目可以属于多个 collection，但一个 Markdown 文件最好只有一个主路径。

因此插件需要 `primary_collection`：

- 第一次创建 Markdown 文件时所在的 collection 是主分类。
- 后续条目加入其他 collection，不自动移动 Markdown。
- 用户可以手动执行 `Move Note to Current Collection`。

## 配置项

插件需要提供偏好设置页：

```text
Markdown root directory: D:\学\论文
Markdown editor: Typora
Filename template: {{citekey}} - {{shortTitle}}.md
Use Better BibTeX citekey: true
Fallback citekey pattern: {{firstCreator}}{{year}}_{{firstTitleWord}}
Maximum filename length: 180
Create note automatically: true
Auto-create only collections: 
Ignore collections: 
Attach note as linked attachment: true
Close Zotero to Windows tray: true
Hide Zotero to tray on startup: false
Tray helper port: 23128
Rank tags prefix: paperbridge/rank/
Status tags prefix: paperbridge/status/
```

fallback citekey pattern 支持 `{{firstCreator}}`、`{{year}}`、`{{firstTitleWord}}`、`{{shortTitle}}`、`{{title}}`、`{{itemKey}}`。

## MVP 功能

第一版只做最小可用闭环：

1. 配置 Markdown 根目录：`D:\学\论文`。
2. 根据 Zotero collection 自动映射本地文件夹。
3. 新论文条目加入 collection 后自动创建 Markdown。
4. Markdown 文件作为 linked attachment 挂回 Zotero 条目。
5. Zotero 列表新增 `笔记` 列。
6. 点击 `笔记` 列打开或创建 Markdown。
7. Zotero 列表新增 `等级` 列。
8. 点击 `等级` 列设置 `空/1/2/3/4/x`。
9. 支持 `1/2/3/4/0/X` 快捷键。
10. `x` 只做软删除，统一清理时才移动 Zotero 条目和 Markdown 文件。

## 非目标

第一版不做：

- 替代 Zotero 的文献管理。
- 替代 Typora 的 Markdown 编辑体验。
- 在 Markdown 中实现复杂双向同步。
- 自动总结论文内容。
- 自动调用大模型阅读 PDF。
- 多设备同步策略。
- 完整的 BibTeX 管理，BibTeX 仍建议交给 Better BibTeX。

这些功能可以作为后续扩展，但不应进入 MVP。

## 后续扩展

可能的 V2 功能：

- 右侧 item pane 增加 PaperBridge 面板，显示笔记路径、等级、状态、打开按钮。
- 支持批量为已有 Zotero 条目生成 Markdown。
- 支持扫描 `D:\学\论文` 中已有 Markdown，并尝试和 Zotero 条目匹配。
- 支持从 Markdown frontmatter 回写 rank/status 到 Zotero tag。
- 支持把 Zotero PDF 注释导出到 Markdown。
- 支持按 rank 生成阅读队列。
- 支持生成某个 collection 的引用清单。

## 关键风险

### Better BibTeX 依赖

理想情况下文件名使用 Better BibTeX citekey。

如果用户未安装 Better BibTeX，插件需要 fallback：

```text
firstAuthorYearShortTitle
```

### 文件名安全

标题中可能包含 Windows 非法字符：

```text
< > : " / \ | ? *
```

插件必须清理文件名，并限制长度。

### 自动创建时机

Zotero Connector 保存论文时，元数据和 PDF 可能不是同一时间完成。

插件应避免太早创建不完整笔记。可以采用：

- 监听条目加入 collection。
- 延迟数秒生成。
- 如果标题/citekey 缺失，稍后重试。

### 多 collection 问题

不要让 collection 和文件夹完全双向强绑定。

必须使用 `primary_collection` 防止 Markdown 文件在多个分类之间被自动移动。

### 删除误操作

`x` 必须只是标记。

真正删除需要显式执行 `清理 x`，执行后 Zotero 条目移入 Zotero Trash，Markdown 文件直接进入 Windows 系统回收站，不额外维护 `.trash` 目录。

## 推荐实现顺序

1. 搭建 Zotero 插件骨架。
2. 添加偏好设置页，保存 Markdown 根目录和编辑器路径。
3. 实现当前选中条目的 `Create Markdown Note`。
4. 实现 linked attachment 绑定。
5. 实现 `笔记` 自定义列。
6. 实现点击 `笔记` 列打开 Typora。
7. 实现 rank tag 读写。
8. 实现 `等级` 自定义列。
9. 实现快捷键。
10. 实现监听新条目加入 collection 后自动创建 Markdown。
11. 实现 `x` 清理队列。
12. 做已有条目的批量迁移工具。

## 当前实现状态

当前版本已经落地为一个 Zotero 插件源码树：

```text
manifest.json
bootstrap.js
prefs.js
preferences.xhtml
preferences.js
style.css
chrome/content/paperbridge.js
chrome/content/modules/
tools/build-xpi.ps1
```

已实现：

1. Zotero 7+ / 9 插件骨架。
2. 默认配置：Markdown 根目录、编辑器路径、文件名模板、自动创建开关、linked attachment 开关、rank/status tag 前缀。
3. 偏好设置页。
4. Markdown 笔记创建。
5. Markdown frontmatter 和阅读模板生成。
6. Markdown linked attachment 绑定。
7. Better BibTeX citekey 优先读取可配置；缺失或关闭时按 fallback citekey pattern 生成。
8. Zotero 条目列表 `笔记` 列。
9. Zotero 条目列表 `等级` 列。
10. 点击 `笔记` 列创建/打开 Markdown。
11. 点击 `等级` 列弹出 `空/1/2/3/4/x`。
12. 快捷键 `1/2/3/4/0/X/M`。
13. 新条目加入 collection 后延迟自动创建 Markdown。
14. `PaperBridge: 清理 x` 菜单项。
15. `x` 清理时 Zotero 条目进入 Zotero Trash，Markdown 文件直接进入 Windows 回收站，不使用 `.trash` 目录。
16. 自动创建会保留触发它的 collection 作为 `primary_collection`，并在标题等元数据尚未就绪时短暂重试。
17. `PaperBridge: 为选中条目创建笔记` 菜单项，用于给已有条目批量补齐 Markdown。
18. `PaperBridge: 为当前分类创建笔记` 菜单项，用于给当前 collection 中的已有条目批量补齐 Markdown。
19. `清理 x` 按当前选中的 Zotero library 搜索，支持个人库和 group library。
20. `清理 x` 逐条处理删除队列；单个条目或 Markdown 删除失败时会记录失败并继续处理后续条目；如果 Markdown 回收失败，会尽量恢复 Zotero 条目的 `deleted` 状态，避免失败项半删除。
21. Windows 关闭到托盘：拦截关闭、启动托盘 helper、点击托盘图标恢复 Zotero。
22. 偏好设置页支持关闭到托盘、启动后隐藏到托盘和 helper 端口配置。
23. `PaperBridge: 移动笔记到当前分类` 菜单项，用于把已有 Markdown 移动到当前 collection 对应目录。
24. 移动笔记时会更新 linked attachment 路径、内部索引，以及 Markdown frontmatter 中的 `collection`、`primary_collection`、`updated`。
25. `!` 状态支持 frontmatter 异常修复：运行时可同步读取 Markdown 时，列状态会按文件修改时间缓存校验结果，识别缺失关键 frontmatter、`zotero_key` 不匹配、Zotero URI 指向错误 item 或错误 library；点击 `!` 可自动补齐/修复。
26. frontmatter 校验覆盖 `title`、`citekey`、`zotero_key`、`collection`、`primary_collection`、`status`、`zotero`、`created`、`updated`，并校验 `zotero_key` 以及 `zotero://select/...` 指向的 item key/library 是否匹配当前条目。
27. frontmatter 修复采用保守合并策略：已有 `collection`、`primary_collection`、`status`、`created` 会保留，缺失时才用当前 collection、索引或默认值补齐。
28. Zotero 中设置等级时会同步更新已有 Markdown frontmatter 的 `rank` 和 `updated`；如果 frontmatter 缺关键字段，会顺带按保守策略补齐。
29. 如果索引中已有 Markdown 路径但 Zotero linked attachment 缺失，创建/批量补笔记时会自动补回 linked attachment、修复 frontmatter 并刷新索引，避免索引成为唯一数据源。
30. 自动创建支持 collection 白名单和忽略列表；忽略列表优先于白名单，配置值可用英文/中文逗号、分号或换行分隔。
31. fallback citekey pattern 可配置，支持 `firstCreator/year/firstTitleWord/shortTitle/title/itemKey` token，并会统一清理为适合文件名和 BibTeX 的 citekey 片段。
32. `!` 状态支持选择已有 Markdown 文件重新绑定；`Tools` → `PaperBridge` 子菜单提供 `PaperBridge: 重连 Markdown 笔记`，用于给单个选中条目手动重连笔记。
33. `PaperBridge: 扫描 Markdown 并重连` 菜单项会递归扫描 Markdown root 下的 `.md` 文件；含 `zotero_key` frontmatter 的笔记会按 Zotero library/key 确定性重连，避免按标题猜测造成误绑定；如果多个 library 存在相同 `zotero_key` 且 frontmatter 没有 `zotero://select/...` 明确 library，会跳过并计为歧义项；如果有明确 Zotero URI，则只按该 URI 指向的 library 查找；没有 `zotero_key` 的旧笔记会按 DOI、citekey、精确标题做保守唯一匹配；没有稳定标识时会用高阈值 fuzzy title 做最后匹配，只有唯一且明显领先的候选才会自动重连；同一个 Zotero 条目对应多个 Markdown 或同一旧笔记匹配到多个 Zotero 条目时会跳过并计为歧义项，不自动覆盖绑定。
34. 扫描或重连已有 Markdown 时，会把 frontmatter 中合法的 `rank`、`status` 回写为 Zotero tag；非法值会忽略，空 `rank` 会清空 PaperBridge rank tag。
35. 右侧 item pane 增加 PaperBridge section，显示笔记状态、Markdown 路径、rank、status，并提供打开/创建、重连、移动到当前分类操作按钮。
36. `PaperBridge: 生成阅读队列` 菜单项会按 rank 分组生成 Markdown 阅读队列；选中 collection 时生成该 collection 队列，否则按当前 library 中带 PaperBridge rank tag 的条目生成。
37. `PaperBridge: 导出 PDF 注释到笔记` 菜单项会把选中条目 PDF 附件下的 Zotero annotation 导出到 Markdown 笔记中的固定标记区，包含类型、页码链接、颜色、正文、comment 和 tags；重复运行会替换标记区而不是重复追加。
38. `Tools` 菜单入口统一收纳到 `PaperBridge` 子菜单，减少顶层 Tools 菜单占用，并降低和其他插件菜单冲突。
39. `PaperBridge: 生成当前分类引用清单` 菜单项会为当前 collection 生成 Markdown 引用清单，包含 citekey、作者、年份、Zotero 链接、DOI、URL 和已绑定 note path。
40. 阅读队列和引用清单只会覆盖带有对应 PaperBridge `type` frontmatter 的生成文件；如果同名文件是用户手写内容，会自动使用唯一文件名，避免覆盖。
41. 文件名和目录名清理覆盖 Windows 保留设备名及其扩展名形式，例如 `CON.md`、`NUL.tar.gz`、`COM9.md`、`COM¹.md`，并确保 fallback 文件名也走同一套清理规则。
42. 托盘 helper 的本地 HTTP 命令请求带超时控制，避免端口被其他本机进程占用或无响应时阻塞关闭/隐藏操作。
43. 同名文件冲突时追加 ` (2)`、` (3)` 等后缀也会重新计算 stem 长度，避免长标题文件名在去重后超过最大文件名长度。
44. citekey 读取兼容 Zotero 8/9 原生 `citationKey` 字段，并兼容 Better BibTeX 返回字符串或对象的不同形态；当原生字段存在时优先使用原生字段。
45. Tools 菜单在 Zotero 8/9 上优先通过官方 `Zotero.MenuManager.registerMenu()` 注册，并使用 Fluent `l10nID` 文案；旧版或 API 不可用时回退到手动 DOM 注入。
46. 插件停用或启动失败清理时，item pane、notifier observer、item tree columns 的注销过程会尽量继续执行；单个 Zotero unregister API 抛错时会记录错误并清理内部状态，避免资源清理被中途打断。
47. 复用或改写已有 Markdown 时，如果目标文件已经带有不同的 `zotero_key`，或 `zotero://select/...` 明确指向另一个 item/library，会拒绝绑定/重连/修复/移动/同步 rank，避免把属于另一个 Zotero 条目的 PaperBridge 笔记静默改写到当前条目；该保护覆盖手动重连、内部索引复用和已有 attachment 路径复用。
48. 绑定或重连已有 Markdown 前会先完成 PaperBridge frontmatter 校验/修复；如果读取或写入 frontmatter 失败，不会继续创建 linked attachment 或写入内部索引，避免把未修复文件标记为已绑定。
49. `清理 x` 过程中如果 Markdown 送入回收站失败，会尝试把已经移入 Zotero Trash 的条目恢复到原 `deleted` 状态，并保留内部索引，便于用户修复原因后重试。
50. 新建 Markdown 文件写出成功后会先写入内部索引，再尝试创建 linked attachment；如果 attachment 创建失败，后续重试会复用同一个 Markdown 文件补绑定，而不是生成重复笔记文件。绑定已有 Markdown 时也会在 frontmatter 校验/修复成功后先保存索引，因此 attachment 创建失败后仍可从 `!` 状态继续补绑定。
51. 当配置要求 linked attachment 但只有内部索引路径、缺少真实 Zotero linked attachment 时，笔记列会显示 `!` 而不是 `M`，点击后会走修复/补绑定流程，避免索引缓存掩盖绑定缺失。
52. close-to-tray 同时监听窗口 `close` 和 Zotero/Mozilla 的 `quit-application-requested`；普通关闭会取消退出并隐藏到托盘，系统关机/重启和 PaperBridge 的显式退出命令会放行真正退出。
53. `1/2/3/4/0/X/M` 快捷键只会在 Zotero 条目列表上下文触发，并忽略输入框、菜单、弹窗、note editor 等可编辑/交互区域，避免在搜索、改标题、PDF reader 或右侧面板操作时误改 rank 或打开笔记。
54. 自动创建的 collection 归属判断会把 Notifier 和 Zotero API 返回的 collection ID 统一规范为正整数，避免字符串 ID 与数字 ID 混用时漏判触发 collection。
55. 自动创建在缺元数据或创建/补 linked attachment 失败时都会进入同一个有限重试队列；如果上一轮已经写出 Markdown 但 attachment 失败，下一轮会复用该 Markdown 补绑定，不会生成重复文件。
56. 右侧 PaperBridge item pane 的按钮操作成功后会刷新 item tree columns 并重渲染面板；执行中按钮会临时禁用，失败时恢复并显示错误，避免重复点击和列表状态滞后。
57. PDF annotation 导出会从 annotation item 的直接属性和 `getField()` 两种来源读取类型、正文、comment、颜色、页码、排序键、父附件 key/id 和 annotation key，并兼容字符串 tag 或 `{ tag }` 形式，降低 Zotero 版本差异导致的漏导出风险。
58. 偏好页 `data-search-strings-raw` 使用正常中文关键词，并通过离线测试防止 mojibake 回退，保证 Zotero 偏好搜索能搜到根目录、自动创建、托盘、标签等设置。
59. 内部索引新写入时使用 `library_id:zotero_key` 作为键，并记录 `library_id`；读取时优先精确匹配，旧版单 `zotero_key` 索引只对个人库做兼容回退，避免个人库和 group library 同 key 时串笔记路径。
60. `zotero://select/...` 到 libraryID 的解析集中在 `Util` 中复用；手动重连、已有 Markdown 复用和扫描重连都会识别 URI 指向的 library，避免同 key 跨 library 误绑定。
61. Zotero URI 生成会为 group library 优先生成 `zotero://select/groups/<groupID>/...` 或 `zotero://open-pdf/groups/<groupID>/...`，groupID 可从 library 对象、item.groupID 或 `Zotero.Groups.getByLibraryID()` 获取，避免 group 条目误生成个人库链接。
62. frontmatter 状态校验和缓存 key 也包含 library 语义：同 key 但 URI 指向另一 library 的 Markdown 会在笔记列显示 `!`，缓存不会在不同 library 的同 key 条目之间复用。
63. frontmatter 中的 `zotero` URI 也会解析 item key；如果 `zotero_key` 正确但 URI 指向同库另一个 item，笔记列显示 `!`，重连/复用会拒绝。
64. `清理 x` 回收 Markdown 前会先读取并校验 frontmatter 归属；如果索引或 linked attachment 指向另一个 Zotero item/library，或者 PaperBridge frontmatter 缺失/不完整，会拒绝回收该文件，并且不会把 Zotero 条目标记为 deleted、不会移除内部索引。
65. 插件停用、更新或启动失败时的清理步骤会逐项隔离执行；notifier、托盘监听、菜单、快捷键、item pane、item tree columns 中任一步清理失败都会记录错误并继续清理后续资源，避免单个 Zotero API 异常留下残留注册。
66. 更新已有 Markdown linked attachment 的 title/path/content type 时带有内存状态回滚；如果 Zotero `saveTx()` 失败，会恢复原 attachment 字段，避免移动笔记失败后文件已回滚但 Zotero 附件对象仍指向新路径。
67. 打开 Markdown 时如果配置了 Typora/编辑器路径，会优先用该编辑器非阻塞打开；如果编辑器进程启动失败，会记录错误并回退到系统默认应用打开 Markdown，避免单个编辑器配置问题让笔记无法打开。
68. 手动点击 `+` 创建笔记时，当前选中 collection 和条目所属 collection 的 ID 会统一规范为正整数再比较；即使 Zotero API 返回字符串 ID，也会优先落到当前选中分类对应的本地目录，而不是误回退到条目的第一个 collection。
69. `为当前分类创建笔记` 会异步解析 collection 子条目；兼容 Zotero 官方的 item 对象数组返回，也容忍 item ID 数组、字符串 ID 和 Promise 形态，并统一过滤已删除条目和非 regular item，避免分类内有条目却误提示为空。
70. `生成阅读队列` 和 `生成当前分类引用清单` 也会等待同一套 collection 子条目解析逻辑；当前分类返回异步 item ID 时仍能生成包含真实条目的 Markdown，而不会把 Promise 当空列表或不可迭代对象处理。
71. PDF annotation 导出中的附件子条目读取也会先解析 annotation item ID，再过滤 annotation 类型；如果 `getChildItems()` 返回字符串/数字 ID 或 Promise，不会因为解析前过滤而漏掉所有注释。
72. `清理 x` 的 library 搜索范围只接受正整数 libraryID；当前没有有效选中 library 时会回退到 `Zotero.Libraries.getAll()` 的有效库列表，避免 `null` 被 `Number(null)` 转成 `0` 后搜索无效 library。
73. 扫描/重连 Markdown 时，如果 frontmatter 里写了明确的 `zotero://select/...` URI 但 URI 中的 group library 解析不到，或 URI item key 与 `zotero_key` 冲突，会跳过该文件，不会回退到选中库或全库搜索，避免坏 URI 造成误绑定。
74. Markdown root 扫描构建旧笔记匹配索引时，也兼容 `Zotero.Items.getAll()` 返回 item 对象、数字 ID 或字符串 ID；无效 libraryID 会提前跳过，不调用 Zotero 查询 API。
75. 插件停用/启动失败清理时，窗口级样式、FTL 引用和 rank popup 也纳入 `PaperBridge.stop()` 的隔离清理步骤；即使 bootstrap 外层清理路径变化，窗口 UI 资源也不会只依赖额外的 `removeFromAllWindows()` 调用。
76. Windows 托盘 helper 的本地 HTTP 连接设置了 socket 读写超时，并限制单次请求头行数；未知命令返回 `404` 而不是静默成功，避免异常本机连接卡住托盘消息循环或让排查结果失真。
77. 设置 rank 时如果 Zotero `saveTx()` 失败，会回滚条目对象内存中的 PaperBridge rank tags，并且不写内部索引，避免保存失败后 UI 或后续逻辑误以为 rank 已经成功落盘。
78. 自动创建通知队列只接受正整数 itemID/collectionID；item add/modify 这类没有 collectionID 的事件不会把 collection-item 事件里已记录的有效 collection 覆盖成 `0`，避免自动创建笔记落到错误目录。
79. 内部索引偏好解析只接受普通对象；如果 index 被误写成数组或损坏 JSON，会安全回退为空对象并在下一次写入时恢复为对象，避免把字符串键写进数组后被 `JSON.stringify([])` 静默丢弃。
80. 阅读队列和引用清单这类生成文件的文件名也会按 `maxFilenameLength` 截断；即使 collection 名很长，首次生成路径也不会绕过普通笔记使用的 Windows 文件名长度保护。
81. PDF annotation section 更新会处理缺失结束标记或孤立结束标记的残缺区块，避免重复导出块；导出的 open-pdf URI 会编码 PDF attachment key，多行 comment 会保持在 Markdown 列表结构内。
82. Windows 托盘 helper 隐藏 Zotero 时只记录当前可见窗口，恢复时优先恢复这批窗口，避免把 Zotero/Mozilla 的隐藏内部窗口误显示；如果 helper 找不到可隐藏窗口，会向插件返回失败，由插件提示错误并保持窗口可见。
83. Tools 菜单 DOM fallback 在 `menu_ToolsPopup` 尚未就绪时不会把窗口标记为已处理，后续可以重试；创建菜单前会清掉残留的 PaperBridge 菜单，并兼容缺少 `createXULElement()` 的文档对象。
84. manifest 的 Zotero 兼容范围改为 `strict_min_version: "6.999"` 和 `strict_max_version: "11.*"`，避免当前 Zotero 9.0.4 把过窄的上限判为不兼容而拒绝安装；最小版本写法与 Zotero 官方插件示例一致，最大版本写法与本机已安装且可登记的 Zotero 插件保持一致。
85. 从 Markdown frontmatter 回写 rank/status tag 或补 unread 状态时，如果 Zotero `saveTx()` 失败，会恢复原 PaperBridge rank/status tags，并且 rank 索引只在保存成功后写入，避免保存失败造成内存 tag 和索引污染。
86. `清理 x` 搜索返回的 item ID 会规范为正整数并去重，library 清理范围也会去重；Markdown 送入回收站后会再次确认原路径不存在，如果文件仍在原处，会恢复 Zotero `deleted` 状态并保留索引。
87. 插件 ID 改为更标准的邮箱式 `paperbridge@example.com`，避免非标准本地域名式 ID 在 Zotero/Mozilla Add-on Manager 安装阶段被泛化报为“不兼容”；manifest 同时补充 author/icons 元数据，并把版本提升到 `0.1.1` 生成新文件名，排除同路径同版本失败安装缓存干扰。
88. 启动阶段改为核心脚本加载失败才中断安装，偏好页、条目列、item pane、通知、Tools 菜单和托盘 hook 的注册失败都会被记录但不会让 Add-on Manager 回滚安装；这样可以避免 Zotero 把启动期 API 差异或单个功能异常泛化显示为“不兼容”，并把版本提升到 `0.1.2` 生成新的安装包。
89. 安装兼容、UI/列、托盘等排查过程移至 `docs/troubleshooting.md`，README 保留项目目标、功能设计和使用说明。
90. 托盘右键菜单精简为 `Open Zotero` 和 `Quit Zotero`；`Quit Zotero` 会通过一次性退出请求让插件放行正常退出，而不是只退出 tray helper。
91. 新建 Markdown 默认只写 PaperBridge frontmatter，不再插入固定阅读提纲标题。
92. 外部删除或修改 Markdown 后，插件会定期刷新条目列状态，避免已删除文件长期显示为 `M`。
93. 自动创建笔记时，如果 collection-item 通知没有给出可靠 collection ID，会优先使用当前选中的 collection，只要该条目确实属于该 collection，避免误落到同级的旧目录。
94. Windows 托盘 helper 不再只按启动时传入的单个 PID 查找窗口，而会扫描所有 `zotero.exe` 进程并优先匹配 Zotero 可执行文件路径；helper 失败时也不会把 Zotero 自动最小化到任务栏，避免关闭拦截失败造成“偶尔自己最小化”。
95. 启动和 item 删除/进 Trash 通知会清理已经指向 deleted/missing Zotero item 的 PaperBridge 索引，避免旧索引让用户误以为论文仍在当前分类；手动 Zotero 删除不会自动删除 Markdown，真正同步回收 Markdown 仍通过显式的 `x` + `清理 x` 流程完成。
96. 右侧 PaperBridge item pane 使用 Zotero 7 官方 section API 的 `body.ownerDocument` fallback 渲染，避免 Zotero 未传 `doc` 时内容区空白；面板增加 note/rank/status 状态条、citekey、主分类、文件存在性、linked attachment、Zotero key，并提供导出注释和刷新按钮。
97. PaperBridge 图标改为居中的文档+桥形线稿，减少侧边栏 20px 图标看起来被截断或过于拥挤的问题。
98. `PaperBridge: 运行诊断` 会输出当前插件版本、Zotero 版本、Markdown 根目录、自动创建/linked attachment 设置、索引 stale 数、托盘 helper 连通性，以及选中条目的 key、deleted 状态、collection、note path、文件存在性、frontmatter、rank/status 和 citekey，便于在真实 Zotero UI 中定位“已删除但索引残留”“文件缺失”“helper 未启动”等问题；报告会同时复制到剪贴板，便于直接粘贴排查。
99. 启动阶段把 `constants/settings/util/index/paperbridge` 视为核心模块，其他功能模块单独隔离加载；单个功能模块脚本加载失败会记录错误但不阻断插件初始化、偏好页、窗口 hook 和其他可用功能，符合 Zotero 7 bootstrapped 插件需要在生命周期中尽量清理/降级的原则。
100. `tools\verify-zotero-install.ps1` 会同时读取 Zotero profile 的 `extensions.json`、profile 中实际安装的 XPI manifest 和 SHA256，并与当前 `dist\paperbridge-latest.xpi` 对比；如果 Zotero 仍在运行旧包或同版本旧构建，会直接提示需要重新安装哪个 XPI。
101. 运行期错误记录改为非阻塞；即使 Zotero 的日志接口或某个可选功能模块异常，右侧 PaperBridge 面板按钮也会恢复可点击状态并显示错误，`PaperBridge: 运行诊断` 也会尽量输出剩余模块状态，而不是因单个模块缺失整体失败。
102. 右侧 PaperBridge item pane 本身也支持降级渲染；如果 Notes、Ranks、Index 或 Annotations 模块加载失败，面板仍会打开并显示 `Unavailable`，相关按钮会禁用并提示重启/重装，而不是让 Zotero 的 item pane 回调抛错。
103. Tools 菜单命令会声明并检查所需模块；DOM fallback 菜单会把不可用功能置灰，MenuManager 路径下点击不可用功能也会显示明确的模块缺失提示，而不是内部 `TypeError`。
104. 基于 Zotero 官方 `MenuManager` 的 `onShowing` / `context.setEnabled()` 机制，官方菜单注册路径也会在菜单打开时动态禁用不可用功能；DOM fallback 和 MenuManager 两条路径的降级行为保持一致。
105. Tools 菜单可用性改为动态计算；如果模块在运行期恢复或缺失，MenuManager 的 `onShowing` 和 DOM fallback 的 `popupshowing` 都会重新检查，不依赖注册时快照。
106. 同一条目存在多个同名 Markdown linked attachment 时，优先使用内部索引记录的 note path 匹配附件，再退回附件标题匹配，避免历史重复附件导致打开或更新旧笔记。
107. 重连已有 Markdown 且文件缺少 PaperBridge frontmatter 时，修复写入后的 `rank/status` 会立刻回写到 Zotero tag；避免 Markdown 已补 `status: unread` 但 Zotero 条目仍没有对应状态标签。
108. 扫描 Markdown root 重连旧笔记时，会优先从 root 下第一层目录推断 collection，并且只在条目确实属于同名 collection 时使用；避免旧笔记位于 `Inbox` 目录却因为 Zotero 当前选中或条目第一个分类不同而被补成错误的 `primary_collection`。
109. `清理 x` 在回收 Markdown 失败并回滚 Zotero Trash 状态时，会恢复清理前的 PaperBridge 索引快照；避免真实 Zotero Notifier 已经因 item deleted 事件清掉索引，回滚后条目和 Markdown 都存在但绑定丢失。
110. `移动笔记到当前分类` 会先确认 Zotero 条目确实属于目标 collection，再移动 Markdown 文件；如果用户误选了无关分类，会拒绝移动并保持文件、frontmatter 和内部索引不变。
111. 手动/批量创建或重连笔记时，显式传入的 collection 也必须是条目所属 collection 才会用于目录和 frontmatter；否则回退到条目自己的主分类，避免当前 Zotero 左侧误选分类导致新建笔记落到无关目录。
112. Zotero rank 写入后同步 Markdown frontmatter 前会先清除该笔记的 frontmatter 校验缓存；如果 Markdown 已被外部改坏或指向其他 Zotero item，条目列会在刷新后立刻显示 `!`，不会继续沿用旧缓存显示 `M`。
113. PDF annotation 导出兼容更多注释字段形态：除 Zotero item 字段 `annotationText/annotationComment/annotationPageLabel` 外，也会读取 `annotatedText/comment/pageLabel/type/color`，并在只有 `annotationPosition.pageIndex` 时生成页码和 `zotero://open-pdf` 链接。
114. PDF annotation 搜索回退会识别更多父附件字段别名，包括 `attachmentItemID`、`attachmentID`、`attachmentItemKey`、`attachmentKey` 以及嵌套的 `annotation.attachment.key/itemKey`，避免真实 annotation 对象字段名不同导致漏导出。
115. PDF 附件识别改为复用统一 helper，除 `attachmentContentType` 和 `.pdf` 路径外，也会读取 `contentType` 属性和 `getField("contentType")`；注释导出和 frontmatter `pdf` URI 选择使用同一判定，避免只通过 getter 暴露 MIME 的 PDF 被漏掉。
116. 右侧 PaperBridge 入口改用只有 `.tooltiptext` 的 sidenav l10n，避免 Zotero 底部栏把 `PaperBridge` 文本渲染进 20px 图标按钮；图标改为 note-link 线稿，面板增加下一步、PDF 概况和更新时间；Windows tray helper 在启用 close-to-tray 时会延迟预热，减少第一次关闭时才启动 PowerShell helper 的等待和窗口闪烁。
117. 右侧 PaperBridge 面板增加“简短说明”编辑区，内容保存到对应 Markdown frontmatter 的可选 `summary` 字段；面板渲染改用 XHTML element fallback 和错误兜底，运行期异常会显示错误提示而不是空白。开发安装脚本在 `-CloseZotero` 时会写入一次性退出请求，避免 close-to-tray 把脚本的关闭请求误处理为隐藏到托盘。
118. Windows tray helper 的 `hide` 命令改为幂等操作：如果没有可见 Zotero 窗口但仍能找到 Zotero 窗口或进程，会视为已经隐藏成功，避免 close 事件时序导致误弹 `Could not hide Zotero through the PaperBridge tray helper`。
119. 保存右侧 PaperBridge 面板的“简短说明”时，会先校验 Markdown frontmatter 是否属于当前 Zotero 条目；如果 frontmatter 缺失或残缺，会补齐 PaperBridge 必需字段后再写入 `summary`，避免生成只有 `summary/updated` 的半残笔记，也避免 stale index 显示其他条目的说明。
120. close-to-tray 不再监听 `beforeunload`，并且只拦截目标为 Zotero 顶层窗口的 `close` 事件；PDF reader、tab、弹窗或内部控件的 close/unload 事件不会再触发隐藏到托盘，避免双击 PDF 或打开 reader 时误把 Zotero 隐藏。

尚未完成：

1. 在真实 Zotero UI 中完整试运行各业务功能。
2. PDF 注释导出的真实 Zotero reader 注释兼容性实机验证。

## 本地打包

运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-xpi.ps1
```

生成：

```text
dist\paperbridge-0.1.32.xpi
dist\paperbridge-latest.xpi
```

然后在 Zotero 中通过插件管理器安装该 `.xpi`。为了避免误选旧版本，建议优先安装固定文件名 `dist\paperbridge-latest.xpi`。

## 本地验证

运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\validate.ps1
```

验证内容：

1. `manifest.json` 可解析，且 Zotero 插件 ID 正确。
2. `preferences.xhtml` 可作为 XML 解析。
3. 所有 JavaScript 文件通过 `node --check`。
4. `tools/offline-tests.js` 用 stub 的 Zotero 环境验证关键纯逻辑和静态内容：关键中文 UI/模板文案 UTF-8 完整性、偏好页中文搜索关键词无 mojibake、manifest 的 Zotero 7+/9 兼容字段、根目录 `prefs.js` 默认偏好、偏好解析、collection 自动创建过滤、collection ID 类型规范化、自动创建通知 itemID/collectionID 正整数校验和 collectionID 保留、手动创建笔记时选中 collection 的字符串/数字 ID 兼容、当前分类批量创建对 item 对象/ID/Promise 子条目返回的兼容、阅读队列和引用清单对异步 collection item ID 的兼容、生成文件长 collection 名截断、library-aware 内部索引、旧索引兼容、坏 JSON/数组索引恢复、Zotero URI library/item key 解析、无法解析的 URI library 检测和 frontmatter mismatch 拒绝保护、错误 library/item URI 的笔记状态 `!` 检测、group library select/open-pdf URI 生成、自动创建 attachment 失败后的有限重试和文件复用、文件名清理、Windows 保留名规避和同名冲突后缀长度控制、Zotero 8/9 原生 citationKey、Better BibTeX citekey 开关和返回值形态、fallback citekey pattern、Markdown 附件匹配、已有 linked attachment 更新失败时字段回滚、编辑器启动失败时系统默认打开回退、frontmatter 更新、frontmatter 有效性判定、保守修复字段生成、Zotero rank 同步到 Markdown、rank 保存失败内存 tag 回滚、frontmatter rank/status 保存失败回滚、错误归属 Markdown 在修复/移动/rank 同步前拒绝改写、Markdown rank/status 回写到 Zotero tag、item pane 摘要/行数据、item pane 按钮执行后的列刷新/重渲染/防重复点击、Tools 菜单 `MenuManager` 注册与 DOM 回退、DOM fallback 菜单延迟重试/残留清理/元素创建兼容、bootstrap 和运行时 stop 清理韧性、窗口 UI 资源随 stop 清理、条目列表快捷键上下文过滤和交互区误触发保护、托盘本地命令超时、托盘 helper socket 读写超时、未知命令拒绝、只恢复已隐藏窗口、无窗口时返回失败兜底、托盘 close 事件拦截、`quit-application-requested` 兜底拦截和系统退出放行、阅读队列 Markdown 渲染和安全输出路径、collection 引用清单 Markdown 渲染和安全输出路径、PDF annotation section 渲染/替换、残缺 annotation 标记修复、attachment key 编码、多行 comment 渲染、annotation 属性/getField 字段读取和 tag 形态兼容、annotation child item ID 解析后过滤、新建或绑定已有 Markdown 后 attachment 失败的重试复用、缺 linked attachment 时显示 `!`、已有 Markdown 自动补 linked attachment、已有 Markdown 手动重连、已有 Markdown 不同 `zotero_key` 的拒绝保护、内部索引误指向其他条目笔记时的拒绝保护、已有 Markdown frontmatter 修复失败不 attach/index、Markdown root 扫描重连、含 `zotero_key` 的跨 library 同 key 歧义保护、Zotero URI 消歧、坏 URI 不回退搜索和 scanner 字符串 item ID 解析、无 `zotero_key` 旧笔记保守匹配和 fuzzy title 匹配、重复 Markdown/重复 Zotero 匹配跳过、`清理 x` libraryID 正整数校验和无选中库回退、`清理 x` 搜索 item ID/清理 library 去重、`清理 x` 单项失败计数、Markdown 回收失败或回收后仍存在时的 Zotero deleted 状态回滚，以及清理前 frontmatter 归属校验拒绝误回收其他条目的 Markdown。
5. `bootstrap.js` 引用的所有脚本都存在。
6. Windows tray helper 通过 `-SelfTest` 自检。
7. 能成功生成与 manifest version 对应的 `dist\paperbridge-<version>.xpi`。
8. XPI 中包含插件启动、偏好页、核心模块和 tray helper 文件。
9. `tools/diagnose-xpi.ps1` 会在安装前检查 XPI 根目录 manifest、manifest 字段、bootstrap、图标路径、当前 Zotero 版本兼容范围、默认 profile 注册状态，以及是否误选了旧版本安装包。
10. `tools/verify-zotero-install.ps1` 的 `-SelfTest` 会构造临时 profile 和 XPI，验证启用/禁用/缺失/旧包 hash 不一致等安装状态判断。

离线验证和 Zotero 插件登记验证已经通过。完整完成前还需要在真实 Zotero UI 中实际检查：

1. 偏好设置页能打开并保存配置。
2. Zotero 列表中出现 `笔记` 和 `等级` 两列。
3. 点击 `+` 能创建 Markdown，并挂成 linked attachment。
4. 点击 `M` 能打开 Markdown。
5. 点击 `等级` 能选择 `空/1/2/3/4/x`。
6. `1/2/3/4/0/X/M` 快捷键可用，并且只在条目列表上下文触发；搜索框、标题编辑、菜单、弹窗、PDF reader、note editor 或其他非条目列表区域不能误触发。
7. 新论文加入 collection 后能自动创建 Markdown。
8. `PaperBridge: 清理 x` 能把 Zotero 条目移入 Zotero Trash，并把 Markdown 文件直接送入 Windows 回收站，不创建 `.trash`。
   单个条目失败时，应继续处理后续条目并在结果中统计失败数。
9. 点击 Zotero 主窗口 `X` 后窗口进入托盘，点击托盘图标后恢复；通过 `PaperBridge: 退出 Zotero` 或系统退出时应真正退出，不应被 close-to-tray 拦截。
10. `PaperBridge: 移动笔记到当前分类` 能移动文件、更新 attachment 路径，并正确改写 frontmatter。
11. `!` 状态能识别文件丢失和 frontmatter 异常；frontmatter 异常能修复，文件丢失时能选择已有 Markdown 重新绑定或重新生成。
12. 设置等级后 Markdown frontmatter 中的 `rank` 能同步更新。
13. `PaperBridge: 扫描 Markdown 并重连` 能递归扫描 Markdown root，并把含 `zotero_key` 的已有笔记重连到对应 Zotero 条目；如果不同 library 中存在同 key 条目，缺少明确 Zotero URI 的笔记必须计为歧义，带 `zotero://select/...` 的笔记只应绑定到 URI 指向的 library；如果 URI 指向无法解析的 group library 或 URI item key 与 `zotero_key` 冲突，应跳过而不是回退搜索；没有 `zotero_key` 的旧笔记可按 DOI、citekey、精确标题或高置信 fuzzy title 唯一匹配；重复匹配同一条目或同一笔记匹配多个 Zotero 条目时必须跳过而不是覆盖绑定。
14. 扫描或重连已有 Markdown 后，合法 `rank/status` frontmatter 能回写为 Zotero tag，非法值不能破坏已有 tag。
15. 右侧 PaperBridge item pane section 能显示当前条目的笔记状态、路径、rank、status，并能触发打开/创建、重连、移动操作；操作成功后面板和条目列表列状态应刷新，执行中不能重复触发同一按钮。
16. `PaperBridge: 生成阅读队列` 能按 rank 顺序生成 Markdown，条目链接到 Zotero URI，并带 citekey 和已有 note path。
17. `PaperBridge: 导出 PDF 注释到笔记` 能读取 PDF annotation item，生成包含 Zotero PDF annotation 链接的 Markdown section，并且重复运行只替换旧 section。
18. `PaperBridge: 生成当前分类引用清单` 能按作者/年份/标题排序生成 Markdown 引用清单，包含 citekey、Zotero URI、DOI、URL 和已绑定 note path。

安装后可用下面的脚本核验 Zotero profile 中的插件登记状态：

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify-zotero-install.ps1
```

脚本会检查 `extensions.json` 中是否存在 `paperbridge@example.com`、版本是否匹配、插件是否启用、登记的 XPI 路径是否存在，并读取 profile 中实际安装的 XPI manifest 和 SHA256，与当前 `dist\paperbridge-latest.xpi` 对比。它只读取 profile，不会改写 Zotero 配置。
如果只是想确认 Zotero 已经登记该插件、但允许它暂时处于禁用或待重启状态，可以加 `-AllowDisabled`。

当前最新运行期修复包为 `0.1.32`；如果 profile 中仍显示 `0.1.31` 或更早版本，或者脚本提示 profile XPI 的 SHA256 与当前 `dist\paperbridge-latest.xpi` 不一致，需要重新安装 `dist\paperbridge-latest.xpi` 并重启 Zotero。
开发调试时，如果 PaperBridge 已经通过 Zotero UI 登记过，但拖拽更新后 profile 仍停在旧 XPI，可以在关闭 Zotero 后运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev-install-to-zotero-profile.ps1
```

该脚本会先备份 profile 中的 PaperBridge XPI、`extensions.json` 和扩展启动缓存，再复制当前 `dist\paperbridge-latest.xpi` 并同步登记信息；如果要让脚本请求 Zotero 正常退出，可加 `-CloseZotero`。它只适合本地开发期修复“已登记但仍运行旧包”的情况，首次安装仍建议走 Zotero UI。

安装前也可以运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\diagnose-xpi.ps1
```

它不会修改 Zotero，只用于确认当前 `dist\paperbridge-0.1.32.xpi` / `dist\paperbridge-latest.xpi` 是否是可被 Zotero 9.0.4 接受的结构和兼容范围，并提示 profile 中是否已有登记记录。
验证脚本本身也纳入本地验证的 `-SelfTest`，避免 profile 解析和状态判断逻辑退化。

安装失败、列不可见、托盘关闭等问题的排查和修复记录见 `docs/troubleshooting.md`。

插件安装建议使用 Zotero UI：

1. 打开 Zotero。
2. 进入 `Tools` → `Plugins` 或旧版界面的 `Tools` → `Add-ons`。
3. 把 `dist\paperbridge-latest.xpi` 拖到 Plugins 窗口；如果当前界面提供齿轮菜单，也可以选择 `Install Add-on From File...` 后选中该 `.xpi`。
4. 确认安装并按提示重启 Zotero。

直接把 `.xpi` 复制到 profile 的 `extensions` 目录不一定会被 Zotero 登记为已安装插件；本机验证时该方式未触发 `extensions.json` 注册，因此不作为首次安装路径。开发期需要修复旧登记时，应使用 `tools\dev-install-to-zotero-profile.ps1` 让 XPI 和 `extensions.json` 一起更新。

如果 Zotero 仍然对主插件显示“不兼容”，可以先安装 `dist\paperbridge-diagnostic-0.0.1.xpi`。该包只包含最小 manifest 和空 bootstrap：如果它能安装，说明 Zotero 接受本地 XPI，问题应继续定位 PaperBridge 启动阶段；如果它也不能安装，优先检查 Zotero 版本、安装入口、profile 或 Add-on Manager 设置。

## 项目一句话

`Zotero PaperBridge` 把 Zotero 的论文管理能力和本地 Markdown 阅读习惯连接起来，让论文条目、PDF、Typora 笔记、BibTeX 引用形成一个稳定闭环。

