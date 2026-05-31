PaperBridge = PaperBridge || {};

PaperBridge.Citations = {
  async generateForCurrentCollection() {
    const collection = PaperBridge.Util.getSelectedCollection();
    if (!collection) {
      PaperBridge.Util.alert("Select a Zotero collection first.");
      return;
    }

    const items = await PaperBridge.Bulk.regularItemsFromCollection(collection);
    if (!items.length) {
      PaperBridge.Util.alert("The selected collection has no regular Zotero items.");
      return;
    }

    const title = `References - ${collection.name}`;
    const content = this.renderCitationList(items, title);
    const path = await this.citationListPath(collection);
    await Zotero.File.putContentsAsync(path, content);
    PaperBridge.Util.alert(`Generated citation list:\n${path}`);
    await PaperBridge.Notes.openPath(path).catch(error => PaperBridge.Util.logError(error));
  },

  async citationListPath(collection) {
    const root = PaperBridge.Settings.markdownRoot();
    if (!root) {
      throw new Error("Markdown root directory is not configured.");
    }
    await PaperBridge.Util.ensureDirectory(root);
    const filename = `${PaperBridge.Util.sanitizePathSegment(`references - ${collection.name}`)}.md`;
    return PaperBridge.ReadingQueue.managedOutputPath(root, filename, "paperbridge-citation-list");
  },

  renderCitationList(items, title = "References") {
    const sorted = this.sortedItems(items);
    const lines = [
      "---",
      `title: ${PaperBridge.Notes.yamlValue(title)}`,
      `generated: ${PaperBridge.Notes.yamlValue(PaperBridge.Util.todayISO())}`,
      "type: paperbridge-citation-list",
      "---",
      "",
      `# ${title}`,
      ""
    ];

    for (const item of sorted) {
      lines.push(this.renderCitationItem(item));
    }

    return lines.join("\n").trimEnd() + "\n";
  },

  sortedItems(items) {
    const seen = new Set();
    return (items || [])
      .filter(item => {
        if (!item || seen.has(item.id) || !PaperBridge.Notes.isRegularItem(item) || item.deleted) {
          return false;
        }
        seen.add(item.id);
        return true;
      })
      .sort((left, right) => this.sortKey(left).localeCompare(this.sortKey(right)));
  },

  sortKey(item) {
    return [
      this.creatorSummary(item),
      PaperBridge.Notes.yearForItem(item),
      this.itemTitle(item)
    ].join(" ").toLowerCase();
  },

  renderCitationItem(item) {
    const citekey = PaperBridge.Notes.citekeyForItem(item);
    const title = this.itemTitle(item);
    const creators = this.creatorSummary(item);
    const year = PaperBridge.Notes.yearForItem(item) || "n.d.";
    const doi = item.getField?.("DOI") || "";
    const url = item.getField?.("url") || "";
    const notePath = PaperBridge.Notes.getNotePath(item);

    const parts = [
      `- \`@${citekey}\` ${creators ? `${this.escapeMarkdown(creators)} ` : ""}(${year}). [${this.escapeMarkdown(title)}](${PaperBridge.Util.zoteroSelectURI(item)}).`
    ];
    if (doi) {
      parts.push(`DOI: ${this.escapeMarkdown(doi)}.`);
    }
    if (url) {
      parts.push(`URL: ${this.escapeMarkdown(url)}.`);
    }
    if (notePath) {
      parts.push(`Note: ${this.escapeMarkdown(notePath)}.`);
    }
    return parts.join(" ");
  },

  creatorSummary(item) {
    const creators = typeof item.getCreators === "function" ? item.getCreators() : [];
    if (creators.length) {
      const names = creators
        .map(creator => creator.lastName || creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" "))
        .filter(Boolean);
      if (names.length > 2) {
        return `${names[0]} et al.`;
      }
      if (names.length) {
        return names.join(" & ");
      }
    }
    return item.firstCreator || "";
  },

  itemTitle(item) {
    return item.getField?.("title") || "Untitled";
  },

  escapeMarkdown(value) {
    return String(value || "").replace(/([\\[\]`*_{}()<>#+.!-])/g, "\\$1");
  }
};
