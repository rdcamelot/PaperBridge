PaperBridge = PaperBridge || {};

PaperBridge.Diagnostics = {
  async showReport(items = PaperBridge.Util.getSelectedRegularItems()) {
    const report = await this.buildReport(items);
    const copied = PaperBridge.Util.copyTextToClipboard(report);
    const suffix = copied ? "\n\nThe diagnostic report was copied to the clipboard." : "";
    PaperBridge.Util.alert(`${report}${suffix}`, "PaperBridge Diagnostics");
  },

  async buildReport(items = PaperBridge.Util.getSelectedRegularItems()) {
    const selectedItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const lines = [
      "PaperBridge Diagnostics",
      "",
      "Runtime",
      ...this.runtimeReportLines(),
      "",
      "Index",
      ...this.safeLines("index", () => this.indexReportLines()),
      "",
      "Tray",
      ...await this.safeAsyncLines("tray", () => this.trayReportLines()),
      "",
      `Selected regular items: ${selectedItems.length}`
    ];

    if (!selectedItems.length) {
      lines.push("- none");
      return lines.join("\n");
    }

    for (const item of selectedItems.slice(0, 10)) {
      lines.push("", ...await this.itemReportLines(item));
    }
    if (selectedItems.length > 10) {
      lines.push("", `... ${selectedItems.length - 10} more selected item(s) omitted`);
    }
    return lines.join("\n");
  },

  runtimeReportLines() {
    return [
      `- PaperBridge: ${PaperBridge.version || "unknown"}`,
      `- Zotero: ${this.zoteroVersionLabel()}`,
      `- OS: ${Services.appinfo?.OS || "unknown"}`,
      `- Markdown root: ${this.safeValue("unavailable", () => PaperBridge.Settings.markdownRoot())}`,
      `- Auto-create: ${this.safeValue("unavailable", () => PaperBridge.Settings.getBool("autoCreate", true) ? "on" : "off")}`,
      `- Linked attachment: ${this.safeValue("unavailable", () => PaperBridge.Settings.getBool("attachLinkedNote", true) ? "on" : "off")}`
    ];
  },

  zoteroVersionLabel() {
    const name = Services.appinfo?.name || "Zotero";
    const version = Services.appinfo?.version || Zotero.version || "";
    return `${name}${version ? ` ${version}` : ""}`;
  },

  indexReportLines() {
    const stats = this.indexStats();
    return [
      `- entries: ${stats.entries}`,
      `- stale/deleted/missing item entries: ${stats.stale}`,
      `- unreadable entries: ${stats.invalid}`
    ];
  },

  indexStats() {
    if (!PaperBridge.Index?.all || !PaperBridge.Index?.shouldKeepEntry) {
      throw new Error("Index module is unavailable");
    }
    const entries = Object.entries(PaperBridge.Index.all());
    let stale = 0;
    let invalid = 0;
    for (const [key, entry] of entries) {
      try {
        if (!PaperBridge.Index.shouldKeepEntry(key, entry)) {
          stale++;
        }
      }
      catch (error) {
        invalid++;
      }
    }
    return { entries: entries.length, stale, invalid };
  },

  async trayReportLines() {
    if (!PaperBridge.Tray?.shouldUseTray || !PaperBridge.Tray?.sendCommand) {
      throw new Error("Tray module is unavailable");
    }
    if (!PaperBridge.Tray.shouldUseTray()) {
      return ["- disabled or not supported on this OS"];
    }
    const reachable = await PaperBridge.Tray.sendCommand("ping", 1).catch(() => false);
    return [
      `- close-to-tray: ${PaperBridge.Settings.closeToTray() ? "on" : "off"}`,
      `- helper port: ${PaperBridge.Settings.trayPort()}`,
      `- helper reachable: ${reachable ? "yes" : "no"}`
    ];
  },

  async itemReportLines(item) {
    const title = this.itemTitle(item);
    const notePath = this.safeValue("", () => PaperBridge.Notes.getNotePath(item));
    const noteExists = notePath ? this.safeValue(false, () => PaperBridge.Util.pathExistsSync(notePath)) : false;
    const attachment = this.safeValue(null, () => PaperBridge.Notes.getNoteAttachment(item));
    const index = this.safeValue({}, () => PaperBridge.Index.get(item) || {});
    const validation = await this.frontmatterSummary(item, notePath, noteExists);
    return [
      `Item ${item.id || "?"}: ${title}`,
      `- key: ${item.key || "-"}`,
      `- deleted: ${item.deleted ? "yes" : "no"}`,
      `- collections: ${this.collectionNamesForItem(item).join(", ") || "-"}`,
      `- note state: ${this.safeValue("unavailable", () => PaperBridge.Notes.getNoteState(item) || "-")}`,
      `- note path: ${notePath || "-"}`,
      `- note file: ${notePath ? (noteExists ? "exists" : "missing") : "-"}`,
      `- note attachment: ${attachment ? "linked" : "missing"}`,
      `- frontmatter: ${validation}`,
      `- rank/status: ${this.safeValue("unavailable", () => `${PaperBridge.Ranks.getRank(item) || "-"} / ${PaperBridge.Ranks.getStatus(item) || "-"}`)}`,
      `- citekey: ${this.safeValue("unavailable", () => PaperBridge.Notes.citekeyForItem(item) || "-")}`,
      `- index primary collection: ${index.primary_collection || index.collection || "-"}`
    ];
  },

  itemTitle(item) {
    const title = item?.getField?.("title") || "";
    return String(title || "(untitled)").replace(/\s+/g, " ").trim();
  },

  collectionNamesForItem(item) {
    return this.safeValue([], () => PaperBridge.Util.collectionIDsForItem(item)
      .map(collectionID => PaperBridge.Notes.resolveCollection(collectionID)?.name || "")
      .filter(Boolean));
  },

  async frontmatterSummary(item, path, exists) {
    if (!path) {
      return "not linked";
    }
    if (!exists) {
      return "file missing";
    }
    try {
      if (!PaperBridge.Notes?.validateFrontmatterContent) {
        throw new Error("Notes module is unavailable");
      }
      const content = await Zotero.File.getContentsAsync(path);
      const validation = PaperBridge.Notes.validateFrontmatterContent(content, item);
      if (validation.ok) {
        return "valid";
      }
      const parts = [];
      if (validation.missingKeys.length) {
        parts.push(`missing ${validation.missingKeys.join(", ")}`);
      }
      if (validation.mismatchedKeys.length) {
        parts.push(`mismatched ${validation.mismatchedKeys.join(", ")}`);
      }
      return parts.join("; ") || "invalid";
    }
    catch (error) {
      return `unreadable: ${error.message || error}`;
    }
  },

  safeValue(fallback, callback) {
    try {
      const value = callback();
      return value === undefined || value === null || value === "" ? fallback : value;
    }
    catch (error) {
      return typeof fallback === "string" && fallback
        ? `${fallback} (${error.message || error})`
        : fallback;
    }
  },

  safeLines(name, callback) {
    try {
      return callback();
    }
    catch (error) {
      return [`- ${name} unavailable: ${error.message || error}`];
    }
  },

  async safeAsyncLines(name, callback) {
    try {
      return await callback();
    }
    catch (error) {
      return [`- ${name} unavailable: ${error.message || error}`];
    }
  }
};
