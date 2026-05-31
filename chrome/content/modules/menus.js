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
            menus: this.menuItems().map(item => this.toMenuManagerItem(item))
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
    paperBridgePopup.addEventListener("popupshowing", () => this.refreshFallbackMenu(paperBridgePopup, window));

    this.addedElementIDs.set(window, ids);
  },

  menuItems(window = null) {
    return [
      this.moduleMenuItem({
        id: "paperbridge-create-notes-selected",
        l10nID: "paperbridge-menu-create-notes-selected",
        label: "PaperBridge: 为选中条目创建笔记",
        moduleName: "Bulk",
        methodName: "createNotesForSelected"
      }),
      this.moduleMenuItem({
        id: "paperbridge-create-notes-collection",
        l10nID: "paperbridge-menu-create-notes-collection",
        label: "PaperBridge: 为当前分类创建笔记",
        moduleName: "Bulk",
        methodName: "createNotesForCurrentCollection"
      }),
      this.moduleMenuItem({
        id: "paperbridge-move-notes-collection",
        l10nID: "paperbridge-menu-move-notes-collection",
        label: "PaperBridge: 移动笔记到当前分类",
        moduleName: "Bulk",
        methodName: "moveSelectedNotesToCurrentCollection"
      }),
      this.moduleMenuItem({
        id: "paperbridge-relink-note-selected",
        l10nID: "paperbridge-menu-relink-note-selected",
        label: "PaperBridge: 重连 Markdown 笔记",
        moduleName: "Bulk",
        methodName: "relinkNoteForSelected"
      }),
      this.moduleMenuItem({
        id: "paperbridge-scan-markdown-root",
        l10nID: "paperbridge-menu-scan-markdown-root",
        label: "PaperBridge: 扫描 Markdown 并重连",
        moduleName: "Scanner",
        methodName: "scanMarkdownRoot"
      }),
      this.moduleMenuItem({
        id: "paperbridge-generate-reading-queue",
        l10nID: "paperbridge-menu-generate-reading-queue",
        label: "PaperBridge: 生成阅读队列",
        moduleName: "ReadingQueue",
        methodName: "generateForCurrentScope"
      }),
      this.moduleMenuItem({
        id: "paperbridge-generate-citation-list",
        l10nID: "paperbridge-menu-generate-citation-list",
        label: "PaperBridge: 生成当前分类引用清单",
        moduleName: "Citations",
        methodName: "generateForCurrentCollection"
      }),
      this.moduleMenuItem({
        id: "paperbridge-export-annotations",
        l10nID: "paperbridge-menu-export-annotations",
        label: "PaperBridge: 导出 PDF 注释到笔记",
        moduleName: "Annotations",
        methodName: "exportForSelected"
      }),
      this.moduleMenuItem({
        id: "paperbridge-diagnostics",
        l10nID: "paperbridge-menu-diagnostics",
        label: "PaperBridge: 运行诊断",
        moduleName: "Diagnostics",
        methodName: "showReport"
      }),
      this.moduleMenuItem({
        id: "paperbridge-hide-to-tray",
        l10nID: "paperbridge-menu-hide-to-tray",
        label: "PaperBridge: 隐藏到托盘",
        moduleName: "Tray",
        methodName: "hideActiveWindow"
      }),
      this.moduleMenuItem({
        id: "paperbridge-quit-zotero",
        l10nID: "paperbridge-menu-quit-zotero",
        label: "PaperBridge: 退出 Zotero",
        moduleName: "Tray",
        methodName: "quitZotero",
        args: () => [window || this.activeWindow()]
      }),
      this.moduleMenuItem({
        id: "paperbridge-clean-x-items",
        l10nID: "paperbridge-menu-clean-x-items",
        label: "PaperBridge: 清理 x",
        moduleName: "DeleteQueue",
        methodName: "cleanRankedItems"
      })
    ];
  },

  toMenuManagerItem(item) {
    return {
      menuType: "menuitem",
      menuID: item.id,
      l10nID: item.l10nID,
      onShowing: (_event, context) => {
        context?.setEnabled?.(this.isMenuItemAvailable(item));
      },
      onCommand: () => item.command()
    };
  },

  moduleMenuItem({ id, l10nID, label, moduleName, methodName, args = () => [] }) {
    const isAvailable = () => this.moduleHas(moduleName, methodName);
    return {
      id,
      l10nID,
      label,
      moduleName,
      methodName,
      isAvailable,
      get available() {
        return isAvailable();
      },
      unavailableMessage: this.featureUnavailableMessage(moduleName, methodName),
      command: () => this.runModuleCommand(moduleName, methodName, args)
    };
  },

  isMenuItemAvailable(item) {
    try {
      return typeof item.isAvailable === "function" ? item.isAvailable() : item.available !== false;
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
      return false;
    }
  },

  moduleHas(moduleName, methodName) {
    return typeof PaperBridge[moduleName]?.[methodName] === "function";
  },

  runModuleCommand(moduleName, methodName, args = () => []) {
    return this.runCommand(() => {
      if (!this.moduleHas(moduleName, methodName)) {
        throw new Error(this.featureUnavailableMessage(moduleName, methodName));
      }
      const values = typeof args === "function" ? args() : args;
      return PaperBridge[moduleName][methodName](...(Array.isArray(values) ? values : [values]));
    });
  },

  featureUnavailableMessage(moduleName, methodName) {
    return `PaperBridge feature unavailable: ${moduleName}.${methodName} is not loaded. Restart Zotero or reinstall the plugin.`;
  },

  runCommand(callback) {
    return Promise.resolve()
      .then(callback)
      .catch(error => {
        PaperBridge.Util.safeLogError(error);
        PaperBridge.Util.alert(error.message || String(error));
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

  addMenuItem(doc, parent, ids, itemData) {
    const { id, label, command } = itemData;
    const item = this.createElement(doc, "menuitem");
    item.id = id;
    item.setAttribute("label", label);
    this.updateFallbackMenuItem(item, itemData);
    item.addEventListener("command", command);
    parent.appendChild(item);
    ids.push(item.id);
    return item;
  },

  refreshFallbackMenu(popup, window) {
    const itemsByID = new Map(this.menuItems(window).map(item => [item.id, item]));
    for (const [id, itemData] of itemsByID.entries()) {
      const menuItem = popup.ownerDocument?.getElementById?.(id) || popup.children?.find?.(child => child.id === id);
      if (menuItem) {
        this.updateFallbackMenuItem(menuItem, itemData);
      }
    }
  },

  updateFallbackMenuItem(menuItem, itemData) {
    if (!this.isMenuItemAvailable(itemData)) {
      menuItem.setAttribute("disabled", "true");
      menuItem.setAttribute("tooltiptext", itemData.unavailableMessage || "");
      return;
    }
    menuItem.removeAttribute?.("disabled");
    menuItem.removeAttribute?.("tooltiptext");
    if (menuItem.attributes) {
      delete menuItem.attributes.disabled;
      delete menuItem.attributes.tooltiptext;
    }
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
