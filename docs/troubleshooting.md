# PaperBridge 排查和修复记录

## XPI 安装失败

本机 Zotero 版本为 `9.0.4`。早期把 `paperbridge-0.1.0.xpi`、`paperbridge-0.1.1.xpi`、`paperbridge-0.1.2.xpi` 或当时的 `paperbridge-latest.xpi` 拖入插件管理器时，Zotero 只显示泛化错误：

```text
无法安装插件，它可能无法与该版本的 Zotero 兼容。
```

排查步骤：

1. 确认 XPI 结构：`manifest.json` 位于压缩包根目录，`bootstrap.js` 存在，插件 ID 为 `paperbridge@example.com`，`strict_min_version` / `strict_max_version` 覆盖 Zotero `9.0.4`。
2. 对照本机已安装并能登记的 Zotero 插件，确认它们的 manifest 都使用 `applications.zotero`，并声明了 `update_url`。
3. 检查 Zotero 9.0.4 内置 Add-on Manager / Extension 代码，确认安装阶段会先加载 manifest；Zotero extension 实际要求 `applications.zotero.id`、`applications.zotero.update_url`、`applications.zotero.strict_max_version`。
4. 发现旧包缺少 `applications.zotero.update_url`。Zotero 内部把 manifest 标为 invalid，但 UI 弹窗仍然复用“不兼容”的提示。
5. 在 `manifest.json` 中补充 HTTPS `update_url`，并让 `tools\diagnose-xpi.ps1` 把缺失 `update_url` 的包判为失败。

最终根因：

```json
"applications": {
  "zotero": {
    "id": "paperbridge@example.com",
    "update_url": "https://example.com/paperbridge/updates.json",
    "strict_min_version": "6.999",
    "strict_max_version": "11.*"
  }
}
```

缺少 `update_url` 时，插件包是在安装前 manifest 校验阶段被拒绝，不是运行期代码失败。

## UI 加载和列不可见

现象：

- `Tools` 菜单、设置页、item pane 能出现。
- `笔记`、`等级` 两列看不到，或列选择器里不明显。
- 右侧 PaperBridge section 只有标题，内容区域没有显示路径、按钮等信息。

排查结果：

- 插件已经安装并启用。
- 本机 profile 的 `treePrefs.json` 中，PaperBridge 自定义列已存在，但被 Zotero 保存为 `hidden: true`。

修复：

- 启动阶段等待 `Zotero.initializationPromise`、`Zotero.unlockPromise`、`Zotero.uiReadyPromise`，避免 UI 注册早于 Zotero 主界面。
- 注册列时显式设置 `hidden: false` 和 `showInColumnPicker: true`。
- 启动后只修复 PaperBridge 自己的列偏好，把 `paperbridge@example.com-paperbridge-note` 和 `paperbridge@example.com-paperbridge-rank` 恢复为可见。
- item pane 渲染使用 Zotero 7 官方 section API 的 `body.ownerDocument` fallback；如果 Zotero 的 `onRender` 回调没有传 `doc`，仍能创建 DOM 并显示内容。

## 托盘关闭和真正退出

现象：

- 右上角关闭按钮最初不能稳定隐藏到托盘。
- 托盘右键菜单只有 `Show Zotero`、`Hide Zotero`、`Exit tray helper`，其中 `Exit tray helper` 只退出 helper，不会真正关闭 Zotero。

修复：

- 插件侧同时处理 `close`、`beforeunload`、`window.close()`、`goQuitApplication()` 和 `quit-application-requested`。
- helper 右键菜单精简为 `Open Zotero` 和 `Quit Zotero`。
- `Quit Zotero` 写入一个带 token 的一次性退出请求，再向 Zotero 主窗口发送关闭消息；插件看到该请求后放行真正退出。
- helper 启动时设置 DPI aware 并启用 WinForms visual styles，降低右键菜单模糊问题。

后续发现的问题：

- Zotero 在 Windows 上可能同时存在多个 `zotero.exe` 进程。早期 helper 只使用插件传入的单个 `ZoteroPid` 查找窗口；如果这个 PID 不是主窗口所属进程，helper 会返回 `NOT_FOUND`。
- 插件收到 helper 失败后曾经会退化为 `window.minimize()`，于是用户看到 `Could not contact the PaperBridge tray helper. Zotero was minimized to the taskbar instead.`，并表现为偶尔自动最小化到任务栏。

修复：

- helper 改为扫描所有 `zotero.exe` 进程，并优先保留路径等于 `ZoteroExe` 的进程，再从这些进程查找可见窗口。
- helper 的进程存活检查也改为“仍有 Zotero 进程则继续运行”，不再因为启动时那个 PID 退出就直接关闭 helper。
- 插件侧取消失败时的最小化兜底；如果 helper 无法隐藏窗口，会提示错误并保持 Zotero 可见，避免误以为已经进托盘。

## Markdown 状态和目录选择

现象：

- 在 Typora 中删除 Markdown 后，Zotero 条目列可能暂时仍显示 `M`。
- 在同级 collection 中新增条目时，如果通知里没有可靠 collection ID，自动创建可能落到条目的第一个 collection 对应目录。

修复：

- 插件增加外部文件状态刷新定时器，定期清理 frontmatter 校验缓存并刷新 item tree columns。
- 自动创建笔记时，如果 collection-item 通知缺少可靠 collection ID，会优先使用当前选中的 collection，前提是该条目确实属于该 collection。

## arXiv 条目已存在或目录错位

案例：

- `https://arxiv.org/abs/2601.08665` 页面本身正常，arXiv 显示标题为 `VLingNav: Embodied Navigation with Adaptive Reasoning and Visual-Assisted Linguistic Memory`。
- 本机 Zotero profile 的 `extensions.paperbridge.index` 中已经存在该条目：`item_id=95`、`zotero_key=Y2TESK58`、`citekey=wang2026_vlingnav`。
- 对应 Markdown 路径为 `D:\学\论文\幻觉神经元\wang2026_vlingnav - VLingNav Embodied Navigation with Adaptive Reasoning and Visual-Assisted Linguistic Memory.md`，而不是当前期望的 `具身智能以及可持续性学习` 目录。
- 数据库中该 item 仍存在，但已经在 `deletedItems` 中，因此 Zotero 普通分类视图不再显示；数据库里的 collection 记录是 `具身智能以及可持续性学习`，linked attachment 和 PaperBridge index 仍指向旧的 `幻觉神经元` Markdown 路径。
- 文件系统中该 Markdown 已不存在，所以这是“已进 Trash 的 Zotero item + 缺失 Markdown 文件 + 旧索引/旧 attachment 路径”的历史遗留状态。

判断：

- 这不是 arXiv 页面无法被解析；更可能是 Zotero/Connector 已经保存过同一论文，重复添加时不会产生明显的新条目，或者 PaperBridge 索引仍指向旧 collection 目录。
- 若条目确实应该属于另一个 collection，先在 Zotero 中把该条目加入/移动到目标 collection，再选中目标 collection 和该条目，执行 `Tools` -> `PaperBridge` -> `PaperBridge: 移动笔记到当前分类`。
- 如果已有外部 Markdown 要绑定到该条目，选中条目后用 `PaperBridge: 重连 Markdown 笔记` 手动选择文件；批量旧笔记可用 `PaperBridge: 扫描 Markdown 并重连`。
- 从 `0.1.8` 开始，插件启动和 item 删除/进 Trash 通知会清理指向 deleted/missing Zotero item 的 PaperBridge index。这个清理只移除插件索引，不会自动删除 Markdown 文件。
- Markdown 的同步删除仍然只发生在显式的 `x` + `PaperBridge: 清理 x` 流程中：先把 Zotero 条目标记为 rank `x`，再执行清理，插件会把 Zotero item 移入 Trash，并把归属校验通过的 Markdown 送入 Windows 回收站。用户直接在 Zotero 里删除条目时，插件不会自动删除 Markdown，以避免误删手写笔记。
- 从 `0.1.9` 开始，可执行 `Tools` -> `PaperBridge` -> `PaperBridge: 运行诊断`。诊断会显示当前索引 stale 数、选中条目的 deleted 状态、collection、note path、文件/附件/frontmatter 状态和托盘 helper 连通性，用来快速确认 PaperBridge 看到的运行时状态是否和 Zotero UI 一致。`0.1.10` 起报告会同时复制到剪贴板，便于直接粘贴排查。
- 从 `0.1.11` 开始，启动阶段的功能模块加载被隔离：核心模块失败才中断启动，单个列、面板、菜单、托盘、注释等功能模块脚本加载失败只记录错误并继续加载后续模块，避免一个功能异常导致整个插件无法启动。
- 从 `0.1.13` 开始，诊断报告会容忍单个可选模块缺失，并把缺失模块写成 `unavailable` 行；右侧 PaperBridge 面板按钮的同步异常也会被捕获，按钮会恢复可点击并弹出错误，避免一次失败后卡在禁用状态。
- 从 `0.1.14` 开始，右侧 PaperBridge item pane 自身也做降级渲染：如果 Notes、Ranks、Index 或 Annotations 模块缺失，面板仍会显示 `Unavailable`，依赖缺失模块的按钮会禁用并提示重启/重装。
- 从 `0.1.15` 开始，Tools 菜单命令会先检查所需模块和方法是否存在；DOM fallback 菜单会置灰缺失功能，MenuManager 菜单点击缺失功能时会给出明确的模块缺失提示。
- 从 `0.1.16` 开始，官方 `Zotero.MenuManager` 注册路径也使用 `onShowing` + `context.setEnabled()` 在菜单打开时动态禁用不可用功能，与 DOM fallback 的置灰行为一致。
- 从 `0.1.17` 开始，菜单可用性不再依赖注册时快照；MenuManager 的 `onShowing` 和 DOM fallback 的 `popupshowing` 都会重新检查模块是否可用。
- 从 `0.1.18` 开始，查找 Markdown linked attachment 时优先按内部索引路径匹配，再按附件标题匹配，避免历史重复的 `Markdown Reading Note` 附件抢先命中。
- 从 `0.1.19` 开始，重连无 PaperBridge frontmatter 的已有 Markdown 时，修复后生成的 `rank/status` 会同步回 Zotero tag，避免 Markdown 已补 `status: unread` 但 Zotero 条目状态仍为空。
- 从 `0.1.20` 开始，扫描 Markdown root 重连旧笔记时会从 root 下第一层目录保守推断 collection，且只在条目实际属于同名 collection 时采用，避免批量重连把已有笔记补到错误的 `primary_collection`。
- 从 `0.1.21` 开始，`清理 x` 如果在 Markdown 回收阶段失败并恢复 Zotero 条目的 deleted 状态，会同时恢复清理前的 PaperBridge 索引，避免 Notifier 已经清索引后留下“条目恢复但绑定丢失”的半删除状态。
- 从 `0.1.22` 开始，`移动笔记到当前分类` 会拒绝目标 collection 不包含该 Zotero 条目的移动请求，避免左侧误选分类时把 Markdown 移到无关目录。
- 从 `0.1.23` 开始，创建或重连笔记时显式传入的 collection 也必须包含该 Zotero 条目；否则回退到条目自己的主分类，避免新建 Markdown 落到无关目录。
- 从 `0.1.24` 开始，设置 Zotero rank 后同步 Markdown 前会先清除该笔记的 frontmatter 校验缓存；如果同步时发现 Markdown 已经外部损坏或属于其他条目，笔记列会立即转为 `!`。
- 从 `0.1.25` 开始，PDF annotation 导出兼容 `annotatedText/comment/pageLabel/type/color` 等模板式字段名，并可从 `annotationPosition.pageIndex` 推导页码，减少 Zotero 版本或插件字段形态差异造成的漏导出。
- 从 `0.1.26` 开始，PDF annotation 搜索回退也识别 `attachmentItemID`、`attachmentID`、`attachmentItemKey`、`attachmentKey` 和嵌套 attachment key，减少父附件字段名差异造成的漏导出。
- 从 `0.1.27` 开始，PDF 附件识别统一使用 `attachmentContentType`、`contentType`、`getField("contentType")` 和 `.pdf` 路径兜底；frontmatter 的 `pdf` URI 与 annotation 导出会使用同一判断，避免只通过 getter 暴露 MIME 的 PDF 附件被漏掉。
- 从 `0.1.28` 开始，PaperBridge item pane 的 sidenav 文案改为 tooltip-only，避免底部按钮显示超出边界的 `PaperBridge` 文本；面板补充下一步、PDF 概况和更新时间；启用 close-to-tray 时会在启动后预热 tray helper，降低第一次关闭时的等待和 PowerShell 窗口闪烁。
- 从 `0.1.29` 开始，PaperBridge item pane 支持编辑“简短说明”，写入对应 Markdown frontmatter 的可选 `summary` 字段；面板渲染增加 XHTML element fallback 和错误兜底，避免回调异常时只剩空白内容。开发安装脚本在 `-CloseZotero` 时会先写入一次性退出请求，避免插件把脚本的关闭请求拦截成隐藏到托盘。

## Zotero 仍在运行旧包

现象：

- 已经重新构建了 `dist\paperbridge-latest.xpi`，但 Zotero 中的行为仍然像旧版本。
- `tools\verify-zotero-install.ps1 -AllowDisabled` 显示 profile 中登记的版本低于 `manifest.json`，或显示 profile XPI 的 SHA256 与当前 `dist\paperbridge-latest.xpi` 不一致。

排查结果：

- Zotero 安装插件时会把 XPI 复制到 profile 的 `extensions\paperbridge@example.com.xpi`。
- 拖入新的 `dist\paperbridge-latest.xpi` 后，如果用户没有完成确认、没有重启 Zotero，或者安装时仍选择了旧文件，profile 中的 XPI 不会自动等于工作区最新构建。
- `extensions.json` 的 `sourceURI` 可能仍指向 `D:/code/PaperBridge/dist/paperbridge-latest.xpi`，但真正运行的是 profile 中复制后的 XPI，因此只看 `sourceURI` 不足以证明已经更新。

修复：

1. 在 Zotero 插件管理器中卸载 PaperBridge。
2. 重启 Zotero。
3. 重新拖入 `D:\code\PaperBridge\dist\paperbridge-latest.xpi` 并确认安装。
4. 再次重启 Zotero。
5. 运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify-zotero-install.ps1 -AllowDisabled
```

如果验证通过，应同时看到登记版本、profile XPI manifest 版本和当前 `dist\paperbridge-latest.xpi` 的 SHA256 一致。

开发期如果 PaperBridge 已经登记，但 Zotero UI 拖拽更新后仍然停在旧 profile XPI，可在关闭 Zotero 后运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev-install-to-zotero-profile.ps1
```

该脚本会备份旧 XPI、`extensions.json`、`addonStartup.json.lz4` 和 `compatibility.ini`，再复制当前 `dist\paperbridge-latest.xpi` 并同步 `extensions.json` 中的版本、路径和 manifest 元数据。若 Zotero 仍在运行，可以加 `-CloseZotero` 让脚本先请求 Zotero 正常退出；脚本不会强制结束进程。

## 相关命令

```powershell
powershell -ExecutionPolicy Bypass -File tools\validate.ps1
powershell -ExecutionPolicy Bypass -File tools\diagnose-xpi.ps1 -XPIPath dist\paperbridge-latest.xpi
powershell -ExecutionPolicy Bypass -File tools\verify-zotero-install.ps1 -AllowDisabled
powershell -ExecutionPolicy Bypass -File tools\dev-install-to-zotero-profile.ps1
```
