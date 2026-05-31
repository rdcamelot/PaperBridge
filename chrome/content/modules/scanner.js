PaperBridge = PaperBridge || {};

PaperBridge.Scanner = {
  async scanMarkdownRoot() {
    const root = PaperBridge.Settings.markdownRoot();
    if (!root) {
      PaperBridge.Util.alert("Markdown root directory is not configured.");
      return;
    }
    if (!(await IOUtils.exists(root))) {
      PaperBridge.Util.alert(`Markdown root directory does not exist:\n${root}`);
      return;
    }

    const ok = PaperBridge.Util.confirm(
      `Scan Markdown notes under:\n${root}\n\nPaperBridge will relink notes by zotero_key, DOI, citekey, or exact title when there is a unique match.`
    );
    if (!ok) {
      return;
    }

    const result = await this.scanDirectory(root);
    PaperBridge.Util.alert(
      `Scanned ${result.files} Markdown file(s).\n` +
      `Matched: ${result.matched}\n` +
      `Legacy matched: ${result.legacyMatched}\n` +
      `Relinked: ${result.relinked}\n` +
      `Ambiguous: ${result.ambiguous}\n` +
      `Skipped: ${result.skipped}\n` +
      `Failed: ${result.failed}`
    );
  },

  async scanDirectory(root) {
    const result = {
      files: 0,
      matched: 0,
      legacyMatched: 0,
      relinked: 0,
      ambiguous: 0,
      skipped: 0,
      failed: 0
    };

    const paths = await this.findMarkdownFiles(root);
    const itemIndex = await this.buildItemIndex();
    result.files = paths.length;
    for (const path of paths) {
      await this.collectMarkdownCandidate(path, result, itemIndex);
    }

    const candidatesByItem = new Map();
    for (const candidate of result.candidates || []) {
      const key = this.candidateItemKey(candidate.item);
      if (!key) {
        result.skipped++;
        continue;
      }
      const candidates = candidatesByItem.get(key) || [];
      candidates.push(candidate);
      candidatesByItem.set(key, candidates);
    }

    for (const candidates of candidatesByItem.values()) {
      if (candidates.length !== 1) {
        result.ambiguous += candidates.length;
        continue;
      }
      const [candidate] = candidates;
      await this.relinkCandidate(candidate, result);
    }
    delete result.candidates;
    PaperBridge.Util.refreshItemTreeColumns();
    return result;
  },

  async findMarkdownFiles(directory, found = []) {
    let children = [];
    try {
      children = await IOUtils.getChildren(directory, { ignoreAbsent: true });
    }
    catch (error) {
      PaperBridge.Util.logError(error);
      return found;
    }

    for (const child of children) {
      let info = null;
      try {
        info = await IOUtils.stat(child);
      }
      catch (error) {
        PaperBridge.Util.logError(error);
        continue;
      }

      if (info.type === "directory") {
        await this.findMarkdownFiles(child, found);
        continue;
      }
      if (info.type === "regular" && child.toLowerCase().endsWith(".md")) {
        found.push(child);
      }
    }
    return found;
  },

  async collectMarkdownCandidate(path, result, itemIndex = null) {
    try {
      const content = await Zotero.File.getContentsAsync(path);
      const fields = PaperBridge.Notes.parseFrontmatter(content);
      const match = fields?.zotero_key
        ? this.itemMatchForFrontmatter(fields)
        : this.itemForLegacyMarkdown(fields, path, itemIndex);

      if (match?.ambiguous) {
        result.ambiguous++;
        return;
      }
      if (!match?.item) {
        result.skipped++;
        return;
      }

      const item = match.item;
      if (!PaperBridge.Notes.isRegularItem(item) || item.deleted) {
        result.skipped++;
        return;
      }

      result.matched++;
      if (match.legacy) {
        result.legacyMatched++;
      }
      if (!result.candidates) {
        result.candidates = [];
      }
      result.candidates.push({ path, item });
    }
    catch (error) {
      result.failed++;
      PaperBridge.Util.logError(error);
    }
  },

  async relinkCandidate(candidate, result) {
    try {
      await PaperBridge.Notes.relinkMarkdownNote(candidate.item, candidate.path);
      result.relinked++;
    }
    catch (error) {
      result.failed++;
      PaperBridge.Util.logError(error);
    }
  },

  candidateItemKey(item) {
    if (!item) {
      return "";
    }
    const libraryID = PaperBridge.Util.libraryIDForItem(item);
    const itemKey = item.key || item.id || "";
    return libraryID && itemKey ? `${libraryID}:${itemKey}` : "";
  },

  itemMatchForFrontmatter(fields) {
    const matches = this.itemsForFrontmatter(fields);
    if (matches.length === 1) {
      return { item: matches[0], legacy: false };
    }
    return matches.length > 1 ? { ambiguous: true } : null;
  },

  itemForFrontmatter(fields) {
    return this.itemMatchForFrontmatter(fields)?.item || null;
  },

  itemsForFrontmatter(fields) {
    const key = String(fields?.zotero_key || "").trim();
    if (!key || typeof Zotero.Items?.getByLibraryAndKey !== "function") {
      return [];
    }

    const zoteroURI = String(fields?.zotero || "").trim();
    const uriItemKey = PaperBridge.Util.itemKeyFromZoteroURI(zoteroURI);
    if (zoteroURI && (!uriItemKey || uriItemKey !== key)) {
      return [];
    }

    const libraryIDs = this.libraryIDsForLookup(fields);
    const matches = [];
    const seen = new Set();

    for (const libraryID of libraryIDs) {
      try {
        const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
        if (item) {
          const itemKey = this.candidateItemKey(item);
          if (!seen.has(itemKey)) {
            seen.add(itemKey);
            matches.push(item);
          }
        }
      }
      catch (error) {
        PaperBridge.Util.logError(error);
      }
    }
    return matches;
  },

  itemForLegacyMarkdown(fields, path, itemIndex) {
    if (!itemIndex) {
      return null;
    }

    const keys = this.legacyMatchKeys(fields, path);
    let sawAmbiguous = false;
    const checks = [
      [itemIndex.byDOI, keys.doi],
      [itemIndex.byCitekey, keys.citekey],
      [itemIndex.byTitle, keys.title]
    ];

    for (const [index, key] of checks) {
      if (!key) {
        continue;
      }
      const items = index.get(key) || [];
      if (items.length === 1) {
        return { item: items[0], legacy: true };
      }
      if (items.length > 1) {
        sawAmbiguous = true;
      }
    }
    const fuzzy = this.fuzzyTitleMatch(keys.title, itemIndex);
    if (fuzzy?.item) {
      return fuzzy;
    }
    if (fuzzy?.ambiguous) {
      sawAmbiguous = true;
    }
    return sawAmbiguous ? { ambiguous: true } : null;
  },

  legacyMatchKeys(fields, path) {
    const stem = PaperBridge.Util.pathBasename(path).replace(/\.md$/i, "");
    const split = this.splitLegacyFilenameStem(stem);
    return {
      doi: this.normalizeDOI(fields?.doi),
      citekey: this.normalizeCitekey(fields?.citekey || split.citekey),
      title: this.normalizeTitle(fields?.title || split.title || stem)
    };
  },

  splitLegacyFilenameStem(stem) {
    const match = String(stem || "").match(/^(.+?)\s+-\s+(.+)$/);
    if (!match) {
      return { citekey: "", title: "" };
    }
    return {
      citekey: match[1],
      title: match[2]
    };
  },

  async buildItemIndex() {
    const index = {
      byDOI: new Map(),
      byCitekey: new Map(),
      byTitle: new Map(),
      titleItems: []
    };
    const seen = new Set();
    for (const libraryID of this.libraryIDsForLookup()) {
      for (const item of await this.regularItemsForLibrary(libraryID)) {
        const key = this.candidateItemKey(item);
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        this.addIndexEntry(index.byDOI, this.normalizeDOI(item.getField("DOI")), item);
        this.addIndexEntry(index.byCitekey, this.normalizeCitekey(PaperBridge.Notes.citekeyForItem(item)), item);
        const title = this.normalizeTitle(item.getField("title"));
        this.addIndexEntry(index.byTitle, title, item);
        if (title) {
          index.titleItems.push({ title, item });
        }
      }
    }
    return index;
  },

  async regularItemsForLibrary(libraryID) {
    if (!this.isValidLibraryID(libraryID)) {
      return [];
    }

    try {
      if (typeof Zotero.Items?.getAll === "function") {
        const itemsOrIDs = await Zotero.Items.getAll(libraryID);
        const items = this.filterRegularItems(await this.resolveItems(itemsOrIDs));
        if (items.length) {
          return items;
        }
      }

      if (typeof Zotero.Search === "function" && typeof Zotero.Items?.getAsync === "function") {
        const search = new Zotero.Search();
        search.libraryID = libraryID;
        search.addCondition("noChildren", "true");
        const ids = await search.search();
        return this.filterRegularItems(await Zotero.Items.getAsync(ids));
      }
    }
    catch (error) {
      PaperBridge.Util.logError(error);
    }
    return [];
  },

  filterRegularItems(items) {
    return (items || []).filter(item => item && PaperBridge.Notes.isRegularItem(item) && !item.deleted);
  },

  async resolveItems(itemsOrIDs) {
    const entries = Array.isArray(itemsOrIDs) ? itemsOrIDs : [];
    if (!entries.length) {
      return [];
    }
    const itemIDs = entries
      .filter(entry => Number.isInteger(Number(entry)) && Number(entry) > 0)
      .map(Number);
    const directItems = entries.filter(entry => entry && typeof entry === "object");
    if (!itemIDs.length) {
      return directItems;
    }

    if (typeof Zotero.Items?.getAsync === "function") {
      return [...directItems, ...await Zotero.Items.getAsync(itemIDs)];
    }
    return [...directItems, ...itemIDs.map(id => Zotero.Items.get(id)).filter(Boolean)];
  },

  addIndexEntry(index, key, item) {
    if (!key) {
      return;
    }
    const items = index.get(key) || [];
    items.push(item);
    index.set(key, items);
  },

  normalizeDOI(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
      .replace(/^doi:\s*/, "");
  },

  normalizeCitekey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_\-]/g, "");
  },

  normalizeTitle(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\.md$/i, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    return normalized.length >= 16 ? normalized : "";
  },

  fuzzyTitleMatch(title, itemIndex) {
    if (!title || !itemIndex?.titleItems?.length) {
      return null;
    }

    const scores = itemIndex.titleItems
      .map(entry => ({
        item: entry.item,
        score: this.titleSimilarity(title, entry.title)
      }))
      .filter(entry => entry.score >= 0.92)
      .sort((left, right) => right.score - left.score);

    if (!scores.length) {
      return null;
    }
    if (scores.length > 1 && scores[0].score - scores[1].score < 0.06) {
      return { ambiguous: true };
    }
    return { item: scores[0].item, legacy: true };
  },

  titleSimilarity(left, right) {
    const leftTokens = this.titleTokens(left);
    const rightTokens = this.titleTokens(right);
    if (!leftTokens.length || !rightTokens.length) {
      return 0;
    }
    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const intersection = [...leftSet].filter(token => rightSet.has(token)).length;
    const union = new Set([...leftSet, ...rightSet]).size;
    const jaccard = union ? intersection / union : 0;
    const overlap = intersection / Math.min(leftSet.size, rightSet.size);
    const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    const charSimilarity = 1 - (this.levenshteinDistance(left, right) / Math.max(left.length, right.length));
    if (overlap < 0.72) {
      return Math.min(jaccard, charSimilarity) * lengthRatio;
    }
    return (charSimilarity * 0.7) + (overlap * 0.2) + (lengthRatio * 0.1);
  },

  titleTokens(title) {
    return String(title || "").split(/\s+/).filter(token => token.length > 2);
  },

  levenshteinDistance(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    if (!a) {
      return b.length;
    }
    if (!b) {
      return a.length;
    }

    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (let j = 0; j <= b.length; j++) {
        previous[j] = current[j];
      }
    }
    return previous[b.length];
  },

  libraryIDsForLookup(fields = {}) {
    const ids = [];
    const fromURI = this.libraryIDFromZoteroURI(fields.zotero);
    if (this.isValidLibraryID(fromURI)) {
      return [Number(fromURI)];
    }
    if (PaperBridge.Util.zoteroURIHasLibraryTarget(fields.zotero)) {
      return [];
    }

    const selected = PaperBridge.Util.getSelectedLibraryID();
    if (this.isValidLibraryID(selected)) {
      ids.push(Number(selected));
    }

    if (typeof Zotero.Libraries?.getAll === "function") {
      for (const library of Zotero.Libraries.getAll()) {
        const libraryID = library.libraryID || library.id;
        if (this.isValidLibraryID(libraryID)) {
          ids.push(Number(libraryID));
        }
      }
    }
    if (this.isValidLibraryID(Zotero.Libraries.userLibraryID)) {
      ids.push(Zotero.Libraries.userLibraryID);
    }
    return [...new Set(ids.map(Number).filter(libraryID => this.isValidLibraryID(libraryID)))];
  },

  isValidLibraryID(libraryID) {
    return PaperBridge.Util.isValidLibraryID(libraryID);
  },

  libraryIDFromZoteroURI(uri) {
    return PaperBridge.Util.libraryIDFromZoteroURI(uri);
  }
};
