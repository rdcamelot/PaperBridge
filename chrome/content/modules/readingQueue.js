PaperBridge = PaperBridge || {};

PaperBridge.ReadingQueue = {
  async generateForCurrentScope() {
    const collection = PaperBridge.Util.getSelectedCollection();
    const items = collection
      ? await PaperBridge.Bulk.regularItemsFromCollection(collection)
      : await this.rankedItemsForCurrentLibrary();

    if (!items.length) {
      PaperBridge.Util.alert("No ranked regular Zotero items were found.");
      return;
    }

    const title = collection ? `Reading Queue - ${collection.name}` : "Reading Queue";
    const content = this.renderQueue(items, title);
    const path = await this.queuePath(collection);
    await Zotero.File.putContentsAsync(path, content);
    PaperBridge.Util.alert(`Generated reading queue:\n${path}`);
    await PaperBridge.Notes.openPath(path).catch(error => PaperBridge.Util.logError(error));
  },

  async rankedItemsForCurrentLibrary() {
    const items = [];
    const seen = new Set();
    const libraryID = PaperBridge.Util.getSelectedLibraryID() || Zotero.Libraries.userLibraryID;
    for (const rank of PaperBridge.Constants.rankValues) {
      const search = new Zotero.Search();
      search.libraryID = libraryID;
      search.addCondition("tag", "is", PaperBridge.Ranks.rankTag(rank));
      const ids = await search.search();
      for (const id of ids) {
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const item = Zotero.Items.get(id);
        if (item && PaperBridge.Notes.isRegularItem(item) && !item.deleted) {
          items.push(item);
        }
      }
    }
    return items;
  },

  async queuePath(collection = null) {
    const root = PaperBridge.Settings.markdownRoot();
    if (!root) {
      throw new Error("Markdown root directory is not configured.");
    }
    await PaperBridge.Util.ensureDirectory(root);
    const stem = collection?.name
      ? `reading_queue - ${collection.name}`
      : "reading_queue";
    const filename = `${PaperBridge.Util.sanitizePathSegment(stem)}.md`;
    return this.managedOutputPath(root, filename, "paperbridge-reading-queue");
  },

  async managedOutputPath(root, filename, expectedType) {
    const safeFilename = PaperBridge.Util.truncateFilename(filename, PaperBridge.Settings.maxFilenameLength());
    const path = PaperBridge.Util.pathJoin(root, safeFilename);
    if (!(await IOUtils.exists(path))) {
      return path;
    }

    try {
      const fields = PaperBridge.Notes.parseFrontmatter(await Zotero.File.getContentsAsync(path));
      if (fields?.type === expectedType) {
        return path;
      }
    }
    catch (error) {
      PaperBridge.Util.logError(error);
    }
    return PaperBridge.Util.uniquePath(root, safeFilename);
  },

  renderQueue(items, title = "Reading Queue") {
    const ordered = this.sortedItems(items);
    const lines = [
      "---",
      `title: ${PaperBridge.Notes.yamlValue(title)}`,
      `generated: ${PaperBridge.Notes.yamlValue(PaperBridge.Util.todayISO())}`,
      "type: paperbridge-reading-queue",
      "---",
      "",
      `# ${title}`,
      ""
    ];

    for (const rank of ["1", "2", "3", "4", "x", ""]) {
      const group = ordered.filter(item => PaperBridge.Ranks.getRank(item) === rank);
      if (!group.length) {
        continue;
      }
      lines.push(`## ${this.rankHeading(rank)}`, "");
      for (const item of group) {
        lines.push(this.renderQueueItem(item));
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  },

  sortedItems(items) {
    const unique = [];
    const seen = new Set();
    for (const item of items || []) {
      if (!item || seen.has(item.id) || !PaperBridge.Notes.isRegularItem(item) || item.deleted) {
        continue;
      }
      seen.add(item.id);
      unique.push(item);
    }
    return unique.sort((left, right) => {
      const rankDiff = this.rankOrder(PaperBridge.Ranks.getRank(left)) - this.rankOrder(PaperBridge.Ranks.getRank(right));
      if (rankDiff) {
        return rankDiff;
      }
      return this.itemTitle(left).localeCompare(this.itemTitle(right));
    });
  },

  rankOrder(rank) {
    const order = { "1": 1, "2": 2, "3": 3, "4": 4, "x": 5, "": 6 };
    return order[rank] || 6;
  },

  rankHeading(rank) {
    return {
      "1": "1 - Core reference",
      "2": "2 - Important reference",
      "3": "3 - Useful",
      "4": "4 - Low priority",
      "x": "x - Marked for deletion",
      "": "Unranked"
    }[rank] || "Unranked";
  },

  renderQueueItem(item) {
    const title = this.itemTitle(item);
    const citekey = PaperBridge.Notes.citekeyForItem(item);
    const notePath = PaperBridge.Notes.getNotePath(item);
    const zoteroURI = PaperBridge.Util.zoteroSelectURI(item);
    const notePart = notePath ? ` | note: ${this.escapeMarkdown(notePath)}` : "";
    return `- [${this.escapeMarkdown(title)}](${zoteroURI}) (${this.escapeMarkdown(citekey)})${notePart}`;
  },

  itemTitle(item) {
    return item?.getField?.("title") || "Untitled";
  },

  escapeMarkdown(value) {
    return String(value || "").replace(/([\\[\]`*_{}()<>#+.!-])/g, "\\$1");
  }
};
