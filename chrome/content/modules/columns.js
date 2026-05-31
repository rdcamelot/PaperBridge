PaperBridge = PaperBridge || {};

PaperBridge.Columns = {
  registeredKeys: [],

  async register() {
    if (this.registeredKeys.length) {
      return;
    }
    if (!Zotero.ItemTreeManager?.registerColumn) {
      PaperBridge.Util.log("Zotero.ItemTreeManager.registerColumn is unavailable.");
      return;
    }

    const keys = [];
    try {
      for (const definition of this.columnDefinitions()) {
        const key = await Zotero.ItemTreeManager.registerColumn(definition);
        if (!key) {
          throw new Error(`Could not register item tree column: ${definition.dataKey}`);
        }
        keys.push(key);
      }
      this.registeredKeys = keys;
      await this.ensureColumnsVisible();
    }
    catch (error) {
      this.registeredKeys = keys;
      await this.unregister().catch(unregisterError => PaperBridge.Util.safeLogError(unregisterError));
      throw error;
    }
  },

  columnDefinitions() {
    return [
      {
        dataKey: "paperbridge-note",
        label: "笔记",
        pluginID: PaperBridge.id,
        enabledTreeIDs: ["main"],
        hidden: false,
        showInColumnPicker: true,
        width: "48",
        fixedWidth: true,
        staticWidth: true,
        noPadding: true,
        minWidth: 36,
        dataProvider: item => PaperBridge.Notes.getNoteCellData(item),
        renderCell: (index, data, column, isFirstColumn, doc) => this.renderNoteCell(data, doc),
        zoteroPersist: ["width", "hidden"]
      },
      {
        dataKey: "paperbridge-rank",
        label: "等级",
        pluginID: PaperBridge.id,
        enabledTreeIDs: ["main"],
        hidden: false,
        showInColumnPicker: true,
        width: "48",
        fixedWidth: true,
        staticWidth: true,
        noPadding: true,
        minWidth: 36,
        dataProvider: item => PaperBridge.Notes.isRegularItem(item)
          ? `${item.id}|${PaperBridge.Ranks.getRank(item)}`
          : "",
        renderCell: (index, data, column, isFirstColumn, doc) => this.renderRankCell(data, doc),
        zoteroPersist: ["width", "hidden", "sortDirection"]
      }
    ];
  },

  async ensureColumnsVisible() {
    const keys = this.registeredKeys.filter(Boolean);
    if (!keys.length) {
      return;
    }

    try {
      await this.ensureTreePrefsVisible(keys);
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
    }

    try {
      this.ensureRuntimeColumnsVisible(keys);
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
    }

    PaperBridge.Util.refreshItemTreeColumns();
  },

  async ensureTreePrefsVisible(keys) {
    const prefsPath = this.treePrefsPath();
    if (!prefsPath || !Zotero.File?.getContentsAsync || !Zotero.File?.putContentsAsync) {
      return false;
    }
    if (IOUtils.exists && !(await IOUtils.exists(prefsPath))) {
      return false;
    }

    const raw = await Zotero.File.getContentsAsync(prefsPath);
    if (!String(raw || "").trim()) {
      return false;
    }

    const prefs = JSON.parse(raw);
    let changed = false;
    for (const treePrefs of Object.values(prefs || {})) {
      if (!treePrefs || typeof treePrefs !== "object") {
        continue;
      }
      for (const key of keys) {
        const entry = treePrefs[key];
        if (entry && typeof entry === "object" && entry.hidden !== false) {
          entry.hidden = false;
          changed = true;
        }
      }
    }
    if (changed) {
      await Zotero.File.putContentsAsync(prefsPath, JSON.stringify(prefs));
    }
    return changed;
  },

  treePrefsPath() {
    const profileDir = Zotero.Profile?.dir;
    return profileDir ? PaperBridge.Util.pathJoin(profileDir, "treePrefs.json") : "";
  },

  ensureRuntimeColumnsVisible(keys) {
    for (const window of Zotero.getMainWindows?.() || []) {
      this.ensureWindowColumnsVisible(window, keys);
    }
  },

  ensureWindowColumnsVisible(window, keys) {
    const itemTree = window?.ZoteroPane?.itemsView
      || window?.ZoteroPane?.itemTree
      || window?.ZoteroPane?.itemsTree;
    if (!itemTree) {
      return false;
    }
    const keySet = new Set(keys);
    let changed = false;

    for (const collection of [
      itemTree._columns,
      itemTree.columns,
      itemTree.state?.columns,
      itemTree.props?.columns
    ]) {
      changed = this.markColumnsVisible(collection, keySet) || changed;
    }

    for (const prefs of [
      itemTree._columnPrefs,
      itemTree.columnPrefs,
      itemTree.state?.columnPrefs
    ]) {
      changed = this.markColumnPrefsVisible(prefs, keySet) || changed;
    }

    if (changed) {
      itemTree._columnsId = null;
      itemTree.tree?.invalidate?.();
      itemTree.forceUpdate?.();
      itemTree.refreshAndMaintainSelection?.();
    }
    return changed;
  },

  markColumnsVisible(collection, keySet) {
    if (!collection) {
      return false;
    }
    const columns = Array.isArray(collection) ? collection : Object.values(collection);
    let changed = false;
    for (const column of columns) {
      if (column && keySet.has(column.dataKey) && column.hidden !== false) {
        column.hidden = false;
        changed = true;
      }
    }
    return changed;
  },

  markColumnPrefsVisible(prefs, keySet) {
    if (!prefs || typeof prefs !== "object") {
      return false;
    }
    let changed = false;
    for (const key of keySet) {
      const entry = prefs[key];
      if (entry && typeof entry === "object" && entry.hidden !== false) {
        entry.hidden = false;
        changed = true;
      }
    }
    return changed;
  },

  async unregister() {
    const keys = this.registeredKeys.filter(Boolean);
    this.registeredKeys = [];
    if (!Zotero.ItemTreeManager?.unregisterColumn) {
      return;
    }

    let firstError = null;
    for (const key of keys) {
      try {
        await Zotero.ItemTreeManager.unregisterColumn(key);
      }
      catch (error) {
        firstError = firstError || error;
        PaperBridge.Util.safeLogError(error);
      }
    }
    if (firstError) {
      throw firstError;
    }
  },

  renderNoteCell(data, doc) {
    const [itemID, state] = String(data || "").split("|");
    const cell = doc.createElement("span");
    cell.className = `paperbridge-cell ${itemID ? "paperbridge-cell-action" : ""} ${state === "!" ? "paperbridge-note-missing" : ""}`;
    cell.textContent = state || "";
    cell.title = this.noteTitle(state);
    if (!itemID) {
      return cell;
    }
    cell.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      PaperBridge.Notes.handleNoteClick(itemID).catch(error => {
        PaperBridge.Util.logError(error);
        PaperBridge.Util.alert(error.message);
      });
    });
    return cell;
  },

  renderRankCell(data, doc) {
    const [itemID, rank] = String(data || "").split("|");
    const cell = doc.createElement("span");
    cell.className = `paperbridge-cell ${itemID ? "paperbridge-cell-action" : ""} ${rank === "x" ? "paperbridge-rank-delete" : ""} ${rank === "1" ? "paperbridge-rank-core" : ""}`;
    cell.textContent = rank || "";
    cell.title = "Set PaperBridge rank";
    if (!itemID) {
      return cell;
    }
    cell.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.showRankPopup(itemID, doc, event);
    });
    return cell;
  },

  noteTitle(state) {
    switch (state) {
      case PaperBridge.Constants.noteStates.create:
        return "Create Markdown note";
      case PaperBridge.Constants.noteStates.ready:
        return "Open Markdown note";
      case PaperBridge.Constants.noteStates.missing:
        return "Markdown note missing or frontmatter invalid; click to repair";
      default:
        return "PaperBridge note";
    }
  },

  showRankPopup(itemID, doc, event) {
    const popupID = "paperbridge-rank-popup";
    doc.getElementById(popupID)?.remove();

    const popup = doc.createXULElement("menupopup");
    popup.id = popupID;
    const options = [
      ["", "Clear rank"],
      ["1", "1 - Core reference"],
      ["2", "2 - Important reference"],
      ["3", "3 - Useful"],
      ["4", "4 - Low priority"],
      ["x", "x - Mark for deletion"]
    ];

    for (const [rank, label] of options) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.addEventListener("command", () => {
        PaperBridge.Ranks.setRankForItemID(itemID, rank).catch(error => {
          PaperBridge.Util.logError(error);
          PaperBridge.Util.alert(error.message);
        });
      });
      popup.appendChild(item);
    }

    doc.documentElement.appendChild(popup);
    popup.openPopupAtScreen(event.screenX, event.screenY, true);
  }
};
