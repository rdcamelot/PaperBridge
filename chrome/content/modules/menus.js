PaperBridge = PaperBridge || {};

PaperBridge.Menus = {
  addedElementIDs: new Map(),
  registeredMenuID: null,

  register() {
    if (this.registeredMenuID) {
      return true;
    }
    if (!Zotero.MenuManager?.registerMenu) {
      return false;
    }

    try {
      const registeredID = Zotero.MenuManager.registerMenu({
        menuID: "paperbridge-tools-menu",
        pluginID: PaperBridge.id,
        target: "main/menubar/tools",
        menus: [
          {
            menuType: "submenu",
            menuID: "paperbridge-tools-submenu",
            l10nID: "paperbridge-menu-root",
            menus: this.menuItems().map(item => ({
              menuType: "menuitem",
              menuID: item.id,
              l10nID: item.l10nID,
              onCommand: () => item.command()
            }))
          }
        ]
      });
      if (registeredID) {
        this.registeredMenuID = registeredID;
        return true;
      }
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
    }
    return false;
  },

  unregister() {
    if (!this.registeredMenuID) {
      return;
    }
    try {
      Zotero.MenuManager?.unregisterMenu?.(this.registeredMenuID);
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
    }
    this.registeredMenuID = null;
  },

  addToWindow(window) {
    if (this.register()) {
      return;
    }
    if (this.addedElementIDs.has(window)) {
      return;
    }

    const doc = window.document;
    const ids = [];
    const toolsPopup = doc.getElementById("menu_ToolsPopup") || doc.getElementById("menu_toolsPopup");
    if (!toolsPopup) {
      return;
    }

    doc.getElementById("paperbridge-tools-menu")?.remove();
    doc.getElementById("paperbridge-tools-menu-popup")?.remove();

    const paperBridgePopup = this.addSubmenu(doc, toolsPopup, ids, {
      id: "paperbridge-tools-menu",
      label: "PaperBridge"
    });

    for (const item of this.menuItems(window)) {
      this.addMenuItem(doc, paperBridgePopup, ids, item);
    }

    this.addedElementIDs.set(window, ids);
  },

  menuItems(window = null) {
    return [
      {
        id: "paperbridge-create-notes-selected",
        l10nID: "paperbridge-menu-create-notes-selected",
        label: "PaperBridge: 为选中条目创建笔记",
        command: () => this.runCommand(() => PaperBridge.Bulk.createNotesForSelected())
      },
      {
        id: "paperbridge-create-notes-collection",
        l10nID: "paperbridge-menu-create-notes-collection",
        label: "PaperBridge: 为当前分类创建笔记",
        command: () => this.runCommand(() => PaperBridge.Bulk.createNotesForCurrentCollection())
      },
      {
        id: "paperbridge-move-notes-collection",
        l10nID: "paperbridge-menu-move-notes-collection",
        label: "PaperBridge: 移动笔记到当前分类",
        command: () => this.runCommand(() => PaperBridge.Bulk.moveSelectedNotesToCurrentCollection())
      },
      {
        id: "paperbridge-relink-note-selected",
        l10nID: "paperbridge-menu-relink-note-selected",
        label: "PaperBridge: 重连 Markdown 笔记",
        command: () => this.runCommand(() => PaperBridge.Bulk.relinkNoteForSelected())
      },
      {
        id: "paperbridge-scan-markdown-root",
        l10nID: "paperbridge-menu-scan-markdown-root",
        label: "PaperBridge: 扫描 Markdown 并重连",
        command: () => this.runCommand(() => PaperBridge.Scanner.scanMarkdownRoot())
      },
      {
        id: "paperbridge-generate-reading-queue",
        l10nID: "paperbridge-menu-generate-reading-queue",
        label: "PaperBridge: 生成阅读队列",
        command: () => this.runCommand(() => PaperBridge.ReadingQueue.generateForCurrentScope())
      },
      {
        id: "paperbridge-generate-citation-list",
        l10nID: "paperbridge-menu-generate-citation-list",
        label: "PaperBridge: 生成当前分类引用清单",
        command: () => this.runCommand(() => PaperBridge.Citations.generateForCurrentCollection())
      },
      {
        id: "paperbridge-export-annotations",
        l10nID: "paperbridge-menu-export-annotations",
        label: "PaperBridge: 导出 PDF 注释到笔记",
        command: () => this.runCommand(() => PaperBridge.Annotations.exportForSelected())
      },
      {
        id: "paperbridge-hide-to-tray",
        l10nID: "paperbridge-menu-hide-to-tray",
        label: "PaperBridge: 隐藏到托盘",
        command: () => this.runCommand(() => PaperBridge.Tray.hideActiveWindow())
      },
      {
        id: "paperbridge-quit-zotero",
        l10nID: "paperbridge-menu-quit-zotero",
        label: "PaperBridge: 退出 Zotero",
        command: () => this.runCommand(() => PaperBridge.Tray.quitZotero(window || this.activeWindow()))
      },
      {
        id: "paperbridge-clean-x-items",
        l10nID: "paperbridge-menu-clean-x-items",
        label: "PaperBridge: 清理 x",
        command: () => this.runCommand(() => PaperBridge.DeleteQueue.cleanRankedItems())
      }
    ];
  },

  runCommand(callback) {
    Promise.resolve()
      .then(callback)
      .catch(error => {
        PaperBridge.Util.logError(error);
        PaperBridge.Util.alert(error.message);
      });
  },

  activeWindow() {
    return Zotero.getActiveZoteroPane?.()?.document?.defaultView
      || Zotero.getMainWindows?.()[0]
      || null;
  },

  addSubmenu(doc, parent, ids, { id, label }) {
    const menu = this.createElement(doc, "menu");
    menu.id = id;
    menu.setAttribute("label", label);
    const popup = this.createElement(doc, "menupopup");
    popup.id = `${id}-popup`;
    menu.appendChild(popup);
    parent.appendChild(menu);
    ids.push(popup.id, menu.id);
    return popup;
  },

  addMenuItem(doc, parent, ids, { id, label, command }) {
    const item = this.createElement(doc, "menuitem");
    item.id = id;
    item.setAttribute("label", label);
    item.addEventListener("command", command);
    parent.appendChild(item);
    ids.push(item.id);
    return item;
  },

  createElement(doc, tagName) {
    return typeof doc.createXULElement === "function"
      ? doc.createXULElement(tagName)
      : doc.createElement(tagName);
  },

  removeFromWindow(window) {
    const ids = this.addedElementIDs.get(window) || [];
    for (const id of ids) {
      window.document.getElementById(id)?.remove();
    }
    this.addedElementIDs.delete(window);
  },

  removeFromAllWindows() {
    for (const window of [...this.addedElementIDs.keys()]) {
      this.removeFromWindow(window);
    }
  }
};
