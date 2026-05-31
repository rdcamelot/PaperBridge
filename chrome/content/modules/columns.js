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
