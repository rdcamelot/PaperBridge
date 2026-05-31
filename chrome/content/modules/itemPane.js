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
        l10nID: "paperbridge-item-pane-sidenav",
        icon: PaperBridge.rootURI + "icons/paperbridge-20.svg"
      },
      onItemChange: ({ doc, body, item, setEnabled, setSectionSummary }) => {
        const paneDoc = this.documentForPane(doc, body);
        this.ensureLocalization(paneDoc);
        setEnabled?.(this.isRegularItem(item));
        setSectionSummary?.(this.summaryForItem(item));
      },
      onRender: ({ doc, body, item, setEnabled, setSectionSummary }) => {
        const paneDoc = this.documentForPane(doc, body);
        this.ensureLocalization(paneDoc);
        setEnabled?.(this.isRegularItem(item));
        setSectionSummary?.(this.summaryForItem(item));
        this.renderSection(paneDoc, body, item);
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
    if (!this.isRegularItem(item)) {
      return "";
    }
    const rank = this.safeValue("-", () => PaperBridge.Ranks.getRank(item) || "-");
    const noteState = this.safeValue(null, () => PaperBridge.Notes.getNoteState(item));
    const noteLabel = noteState ? this.noteStateLabel(noteState) : "Unavailable";
    const status = this.safeValue("-", () => PaperBridge.Ranks.getStatus(item) || "-");
    return `${noteLabel} / Rank ${rank} / ${status}`;
  },

  isRegularItem(item) {
    return Boolean(this.safeValue(false, () => {
      if (PaperBridge.Notes?.isRegularItem) {
        return PaperBridge.Notes.isRegularItem(item);
      }
      return item?.isRegularItem?.() === true && item?.isAttachment?.() !== true;
    }));
  },

  documentForPane(doc, body) {
    return doc || body?.ownerDocument || body?.document || null;
  },

  ensureLocalization(doc) {
    doc?.defaultView?.MozXULElement?.insertFTLIfNeeded?.("paperbridge.ftl");
  },

  rowsForItem(item) {
    if (!this.isRegularItem(item)) {
      return [];
    }
    const state = this.stateForItem(item);
    return [
      {
        label: "Next",
        labelL10nID: "paperbridge-item-pane-row-next",
        value: this.nextActionLabel(state),
        valueL10nID: this.nextActionL10nID(state)
      },
      {
        label: "Note",
        labelL10nID: "paperbridge-item-pane-row-note",
        value: state.noteState ? this.noteStateLabel(state.noteState) : "Unavailable",
        valueL10nID: state.noteState ? this.noteStateL10nID(state.noteState) : "paperbridge-item-pane-value-unavailable"
      },
      {
        label: "Rank",
        labelL10nID: "paperbridge-item-pane-row-rank",
        value: state.rank
      },
      {
        label: "Status",
        labelL10nID: "paperbridge-item-pane-row-status",
        value: state.status
      },
      {
        label: "PDF",
        labelL10nID: "paperbridge-item-pane-row-pdf",
        value: this.pdfSummary(state),
        valueL10nID: state.pdfCount ? "" : "paperbridge-item-pane-pdf-missing"
      },
      {
        label: "Citekey",
        labelL10nID: "paperbridge-item-pane-row-citekey",
        value: state.citekey
      },
      {
        label: "Primary",
        labelL10nID: "paperbridge-item-pane-row-primary-collection",
        value: state.primaryCollection
      },
      {
        label: "Markdown",
        labelL10nID: "paperbridge-item-pane-row-path",
        value: state.notePath || "Not linked",
        valueL10nID: state.notePath ? "" : "paperbridge-item-pane-value-not-linked",
        className: state.notePath ? "paperbridge-pane-path" : ""
      },
      {
        label: "File",
        labelL10nID: "paperbridge-item-pane-row-file",
        value: state.notePath ? (state.noteExists ? "Exists" : "Missing") : "-",
        valueL10nID: state.notePath
          ? (state.noteExists ? "paperbridge-item-pane-file-exists" : "paperbridge-item-pane-file-missing")
          : ""
      },
      {
        label: "Attachment",
        labelL10nID: "paperbridge-item-pane-row-attachment",
        value: state.noteAttachment ? "Linked" : "Missing",
        valueL10nID: state.noteAttachment ? "paperbridge-item-pane-attachment-linked" : "paperbridge-item-pane-attachment-missing"
      },
      {
        label: "Updated",
        labelL10nID: "paperbridge-item-pane-row-updated",
        value: state.updated
      },
      {
        label: "Zotero Key",
        labelL10nID: "paperbridge-item-pane-row-zotero-key",
        value: item.key || "-"
      }
    ];
  },

  stateForItem(item) {
    const notePath = this.safeValue("", () => PaperBridge.Notes.getNotePath(item));
    const index = this.safeValue({}, () => PaperBridge.Index.get(item) || {});
    const noteAttachment = this.safeValue(null, () => PaperBridge.Notes.getNoteAttachment(item));
    const noteExists = notePath ? this.safeValue(false, () => PaperBridge.Util.pathExistsSync(notePath)) : false;
    const rank = this.safeValue("-", () => PaperBridge.Ranks.getRank(item) || "-");
    const status = this.safeValue("-", () => PaperBridge.Ranks.getStatus(item) || "-");
    const citekey = this.safeValue("unavailable", () => PaperBridge.Notes.citekeyForItem(item) || "-");
    const noteState = this.safeValue(null, () => PaperBridge.Notes.getNoteState(item));
    const pdfAttachments = this.safeValue([], () => this.pdfAttachmentsForItem(item));
    const primaryPDF = pdfAttachments[0] || this.safeValue(null, () => PaperBridge.Notes.bestPDFAttachment(item));
    return {
      item,
      notePath,
      index,
      noteAttachment,
      noteExists,
      rank,
      status,
      citekey,
      noteState,
      pdfAttachments,
      pdfCount: pdfAttachments.length || (primaryPDF ? 1 : 0),
      primaryPDF,
      primaryCollection: index.primary_collection || index.collection || "-",
      updated: index.updated || "-"
    };
  },

  pdfAttachmentsForItem(item) {
    if (PaperBridge.Annotations?.pdfAttachments) {
      return PaperBridge.Annotations.pdfAttachments(item);
    }
    const best = PaperBridge.Notes?.bestPDFAttachment?.(item);
    return best ? [best] : [];
  },

  nextActionLabel(state) {
    if (state.noteState === PaperBridge.Constants.noteStates.ready) {
      return "Open Markdown note";
    }
    if (state.noteState === PaperBridge.Constants.noteStates.missing) {
      return "Repair Markdown link";
    }
    return "Create Markdown note";
  },

  nextActionL10nID(state) {
    if (state.noteState === PaperBridge.Constants.noteStates.ready) {
      return "paperbridge-item-pane-next-open";
    }
    if (state.noteState === PaperBridge.Constants.noteStates.missing) {
      return "paperbridge-item-pane-next-repair";
    }
    return "paperbridge-item-pane-next-create";
  },

  pdfSummary(state) {
    if (!state.pdfCount) {
      return "No PDF attached";
    }
    const title = this.safeValue("", () => state.primaryPDF?.getField?.("title") || "");
    const count = state.pdfCount === 1 ? "1 PDF" : `${state.pdfCount} PDFs`;
    return title ? `${count} / ${title}` : count;
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
    if (!doc || !body) {
      return;
    }
    body.textContent = "";
    const container = doc.createElement("div");
    container.className = "paperbridge-pane";
    body.appendChild(container);

    if (!this.isRegularItem(item)) {
      this.setLocalizedText(doc, container, "paperbridge-item-pane-regular-only", "PaperBridge works with regular Zotero items.");
      return;
    }

    container.appendChild(this.renderStatusStrip(doc, item));
    container.appendChild(this.renderOverview(doc, item));

    const rows = doc.createElement("div");
    rows.className = "paperbridge-pane-rows";
    for (const rowData of this.rowsForItem(item)) {
      const row = doc.createElement("div");
      row.className = "paperbridge-pane-row";
      const labelEl = doc.createElement("span");
      labelEl.className = "paperbridge-pane-label";
      this.setLocalizedText(doc, labelEl, rowData.labelL10nID, rowData.label);
      const valueEl = doc.createElement("span");
      valueEl.className = ["paperbridge-pane-value", rowData.className || ""].filter(Boolean).join(" ");
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
    }, { enabled: this.moduleHas("Notes", "handleNoteClick") });
    this.addActionButton(doc, actions, item, "Relink", "paperbridge-item-pane-action-relink", async () => {
      await PaperBridge.Notes.selectAndRelinkMarkdownNote(item);
    }, { enabled: this.moduleHas("Notes", "selectAndRelinkMarkdownNote") });
    this.addActionButton(doc, actions, item, "Move", "paperbridge-item-pane-action-move", async () => {
      const collection = PaperBridge.Util.getSelectedCollection();
      if (!collection) {
        throw new Error("Select a Zotero collection before moving the note.");
      }
      await PaperBridge.Notes.moveNoteToCollection(item, collection);
    }, { enabled: this.moduleHas("Notes", "moveNoteToCollection") });
    this.addActionButton(doc, actions, item, "Export Annotations", "paperbridge-item-pane-action-export-annotations", async () => {
      const count = await PaperBridge.Annotations.exportForItem(item);
      PaperBridge.Util.alert(`Exported ${count} annotation(s).`);
    }, { enabled: this.moduleHas("Annotations", "exportForItem") });
    this.addActionButton(doc, actions, item, "Refresh", "paperbridge-item-pane-action-refresh", async () => {
      PaperBridge.Notes.refreshExternalFileState();
    }, { enabled: this.moduleHas("Notes", "refreshExternalFileState") });
    container.appendChild(actions);
  },

  renderOverview(doc, item) {
    const state = this.stateForItem(item);
    const overview = doc.createElement("div");
    overview.className = "paperbridge-pane-overview";

    const title = doc.createElement("div");
    title.className = "paperbridge-pane-overview-title";
    this.setLocalizedText(doc, title, this.nextActionL10nID(state), this.nextActionLabel(state));

    const detail = doc.createElement("div");
    detail.className = "paperbridge-pane-overview-detail";
    const filename = this.safeValue("", () => PaperBridge.Util.pathBasename(state.notePath)) || state.citekey || "-";
    detail.textContent = [filename, state.primaryCollection].filter(value => value && value !== "-").join(" / ") || "-";

    overview.append(title, detail);
    return overview;
  },

  renderStatusStrip(doc, item) {
    const strip = doc.createElement("div");
    strip.className = "paperbridge-pane-status-strip";
    const noteState = this.safeValue(null, () => PaperBridge.Notes.getNoteState(item));
    if (noteState) {
      this.addBadge(doc, strip, this.noteStateLabel(noteState), this.noteStateL10nID(noteState), this.noteStateClassName(noteState));
    }
    else {
      this.addBadge(doc, strip, "Unavailable", "paperbridge-item-pane-value-unavailable", "paperbridge-pane-badge-missing");
    }
    this.addBadge(doc, strip, `Rank ${this.safeValue("-", () => PaperBridge.Ranks.getRank(item) || "-")}`, "", "paperbridge-pane-badge-rank");
    this.addBadge(doc, strip, this.safeValue("-", () => PaperBridge.Ranks.getStatus(item) || "-"), "", "paperbridge-pane-badge-status");
    return strip;
  },

  addBadge(doc, parent, label, l10nID, className) {
    const badge = doc.createElement("span");
    badge.className = ["paperbridge-pane-badge", className || ""].filter(Boolean).join(" ");
    this.setLocalizedText(doc, badge, l10nID, label);
    parent.appendChild(badge);
  },

  noteStateClassName(state) {
    switch (state) {
      case PaperBridge.Constants.noteStates.ready:
        return "paperbridge-pane-badge-ready";
      case PaperBridge.Constants.noteStates.missing:
        return "paperbridge-pane-badge-missing";
      case PaperBridge.Constants.noteStates.create:
        return "paperbridge-pane-badge-create";
      default:
        return "paperbridge-pane-badge-empty";
    }
  },

  addActionButton(doc, parent, item, label, l10nID, command, options = {}) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "paperbridge-pane-button";
    this.setLocalizedText(doc, button, l10nID, label);
    if (options.enabled === false) {
      button.disabled = true;
      button.title = "This PaperBridge feature is unavailable. Try restarting Zotero or reinstalling the plugin.";
      button.className = `${button.className} paperbridge-pane-button-disabled`;
      parent.appendChild(button);
      return button;
    }
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation?.();
      button.disabled = true;
      return Promise.resolve().then(command).then(() => {
        PaperBridge.Util.refreshItemTreeColumns();
        this.refreshRenderedSection(doc, parent, item);
      }).catch(error => {
        button.disabled = false;
        PaperBridge.Util.safeLogError(error);
        PaperBridge.Util.alert(error.message || String(error));
      });
    });
    parent.appendChild(button);
    return button;
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
  },

  moduleHas(moduleName, methodName) {
    return typeof PaperBridge[moduleName]?.[methodName] === "function";
  },

  safeValue(fallback, callback) {
    try {
      const value = callback();
      return value === undefined || value === null || value === "" ? fallback : value;
    }
    catch (error) {
      PaperBridge.Util?.safeLogError?.(error);
      return fallback;
    }
  }
};
