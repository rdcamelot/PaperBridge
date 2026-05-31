PaperBridge = PaperBridge || {};

PaperBridge.ItemPane = {
  registeredID: null,

  register() {
    if (this.registeredID || !Zotero.ItemPaneManager?.registerSection) {
      return false;
    }

    this.registeredID = Zotero.ItemPaneManager.registerSection({
      paneID: "paperbridge",
      pluginID: PaperBridge.id,
      header: {
        l10nID: "paperbridge-item-pane-header",
        icon: PaperBridge.rootURI + "icons/paperbridge-16.svg"
      },
      sidenav: {
        l10nID: "paperbridge-item-pane-header",
        icon: PaperBridge.rootURI + "icons/paperbridge-20.svg"
      },
      onItemChange: ({ doc, item, setEnabled, setSectionSummary }) => {
        this.ensureLocalization(doc);
        setEnabled?.(PaperBridge.Notes.isRegularItem(item));
        setSectionSummary?.(this.summaryForItem(item));
      },
      onRender: ({ doc, body, item, setEnabled, setSectionSummary }) => {
        this.ensureLocalization(doc);
        setEnabled?.(PaperBridge.Notes.isRegularItem(item));
        setSectionSummary?.(this.summaryForItem(item));
        this.renderSection(doc, body, item);
      }
    });
    return Boolean(this.registeredID);
  },

  unregister() {
    const registeredID = this.registeredID;
    this.registeredID = null;
    if (registeredID && Zotero.ItemPaneManager?.unregisterSection) {
      try {
        Zotero.ItemPaneManager.unregisterSection(registeredID);
      }
      catch (error) {
        PaperBridge.Util.safeLogError(error);
      }
    }
  },

  summaryForItem(item) {
    if (!PaperBridge.Notes.isRegularItem(item)) {
      return "";
    }
    const rank = PaperBridge.Ranks.getRank(item) || "-";
    const noteState = PaperBridge.Notes.getNoteState(item) || "-";
    return `Note ${noteState} / Rank ${rank}`;
  },

  ensureLocalization(doc) {
    doc?.defaultView?.MozXULElement?.insertFTLIfNeeded?.("paperbridge.ftl");
  },

  rowsForItem(item) {
    if (!PaperBridge.Notes.isRegularItem(item)) {
      return [];
    }
    const notePath = PaperBridge.Notes.getNotePath(item);
    const rank = PaperBridge.Ranks.getRank(item) || "-";
    const status = PaperBridge.Ranks.getStatus(item) || "-";
    return [
      {
        label: "Note",
        labelL10nID: "paperbridge-item-pane-row-note",
        value: this.noteStateLabel(PaperBridge.Notes.getNoteState(item)),
        valueL10nID: this.noteStateL10nID(PaperBridge.Notes.getNoteState(item))
      },
      {
        label: "Path",
        labelL10nID: "paperbridge-item-pane-row-path",
        value: notePath || "Not linked",
        valueL10nID: notePath ? "" : "paperbridge-item-pane-value-not-linked"
      },
      {
        label: "Rank",
        labelL10nID: "paperbridge-item-pane-row-rank",
        value: rank
      },
      {
        label: "Status",
        labelL10nID: "paperbridge-item-pane-row-status",
        value: status
      }
    ];
  },

  noteStateLabel(state) {
    switch (state) {
      case PaperBridge.Constants.noteStates.create:
        return "Not created";
      case PaperBridge.Constants.noteStates.ready:
        return "Ready";
      case PaperBridge.Constants.noteStates.missing:
        return "Needs repair";
      default:
        return "-";
    }
  },

  noteStateL10nID(state) {
    switch (state) {
      case PaperBridge.Constants.noteStates.create:
        return "paperbridge-item-pane-note-not-created";
      case PaperBridge.Constants.noteStates.ready:
        return "paperbridge-item-pane-note-ready";
      case PaperBridge.Constants.noteStates.missing:
        return "paperbridge-item-pane-note-needs-repair";
      default:
        return "";
    }
  },

  renderSection(doc, body, item) {
    body.textContent = "";
    const container = doc.createElement("div");
    container.className = "paperbridge-pane";
    body.appendChild(container);

    if (!PaperBridge.Notes.isRegularItem(item)) {
      this.setLocalizedText(doc, container, "paperbridge-item-pane-regular-only", "PaperBridge works with regular Zotero items.");
      return;
    }

    const rows = doc.createElement("div");
    rows.className = "paperbridge-pane-rows";
    for (const rowData of this.rowsForItem(item)) {
      const row = doc.createElement("div");
      row.className = "paperbridge-pane-row";
      const labelEl = doc.createElement("span");
      labelEl.className = "paperbridge-pane-label";
      this.setLocalizedText(doc, labelEl, rowData.labelL10nID, rowData.label);
      const valueEl = doc.createElement("span");
      valueEl.className = "paperbridge-pane-value";
      this.setLocalizedText(doc, valueEl, rowData.valueL10nID, rowData.value);
      valueEl.title = rowData.value;
      row.append(labelEl, valueEl);
      rows.appendChild(row);
    }
    container.appendChild(rows);

    const actions = doc.createElement("div");
    actions.className = "paperbridge-pane-actions";
    this.addActionButton(doc, actions, item, "Open/Create", "paperbridge-item-pane-action-open-create", async () => {
      await PaperBridge.Notes.handleNoteClick(item.id);
    });
    this.addActionButton(doc, actions, item, "Relink", "paperbridge-item-pane-action-relink", async () => {
      await PaperBridge.Notes.selectAndRelinkMarkdownNote(item);
    });
    this.addActionButton(doc, actions, item, "Move", "paperbridge-item-pane-action-move", async () => {
      const collection = PaperBridge.Util.getSelectedCollection();
      if (!collection) {
        throw new Error("Select a Zotero collection before moving the note.");
      }
      await PaperBridge.Notes.moveNoteToCollection(item, collection);
    });
    container.appendChild(actions);
  },

  addActionButton(doc, parent, item, label, l10nID, command) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "paperbridge-pane-button";
    this.setLocalizedText(doc, button, l10nID, label);
    button.addEventListener("click", event => {
      event.preventDefault();
      button.disabled = true;
      return command().then(() => {
        PaperBridge.Util.refreshItemTreeColumns();
        this.refreshRenderedSection(doc, parent, item);
      }).catch(error => {
        button.disabled = false;
        PaperBridge.Util.logError(error);
        PaperBridge.Util.alert(error.message);
      });
    });
    parent.appendChild(button);
  },

  refreshRenderedSection(doc, element, item) {
    const container = typeof element?.closest === "function"
      ? element.closest(".paperbridge-pane")
      : null;
    this.renderSection(doc, container?.parentElement || element, item);
  },

  setLocalizedText(doc, element, l10nID, fallback) {
    element.textContent = fallback || "";
    if (!l10nID) {
      return;
    }
    if (doc?.l10n?.setAttributes) {
      doc.l10n.setAttributes(element, l10nID);
      return;
    }
    element.setAttribute("data-l10n-id", l10nID);
  }
};
