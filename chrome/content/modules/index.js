PaperBridge = PaperBridge || {};

PaperBridge.Index = {
  all() {
    const raw = PaperBridge.Settings.getString("index", "{}");
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
      return {};
    }
  },

  save(all) {
    PaperBridge.Settings.set("index", JSON.stringify(all));
  },

  get(item) {
    if (!item?.key) {
      return null;
    }
    const all = this.all();
    const key = this.itemIndexKey(item);
    if (key && all[key]) {
      return all[key];
    }

    const legacy = all[this.legacyItemKey(item)];
    return this.canUseLegacyEntry(item, legacy) ? legacy : null;
  },

  set(item, data) {
    if (!item?.key) {
      return;
    }
    const all = this.all();
    const key = this.itemIndexKey(item);
    const legacyKey = this.legacyItemKey(item);
    all[key] = Object.assign({}, all[key] || {}, data, {
      zotero_key: item.key,
      item_id: item.id,
      library_id: this.libraryIDForItem(item),
      updated: PaperBridge.Util.todayISO()
    });
    if (legacyKey !== key && this.canRemoveLegacyEntry(item, all[legacyKey])) {
      delete all[legacyKey];
    }
    this.save(all);
  },

  remove(item) {
    if (!item?.key) {
      return;
    }
    const all = this.all();
    const key = this.itemIndexKey(item);
    const legacyKey = this.legacyItemKey(item);
    delete all[key];
    if (legacyKey !== key && this.canRemoveLegacyEntry(item, all[legacyKey])) {
      delete all[legacyKey];
    }
    this.save(all);
  },

  itemIndexKey(item) {
    const key = this.legacyItemKey(item);
    if (!key) {
      return "";
    }
    const libraryID = this.libraryIDForItem(item);
    return libraryID ? `${libraryID}:${key}` : key;
  },

  legacyItemKey(item) {
    return String(item?.key || "").trim();
  },

  libraryIDForItem(item) {
    return PaperBridge.Util.libraryIDForItem(item);
  },

  canUseLegacyEntry(item, entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    if (entry.zotero_key && entry.zotero_key !== item.key) {
      return false;
    }

    const entryLibraryID = Number(entry.library_id || entry.libraryID || 0);
    const itemLibraryID = this.libraryIDForItem(item);
    if (Number.isInteger(entryLibraryID) && entryLibraryID > 0) {
      return entryLibraryID === itemLibraryID;
    }

    return itemLibraryID === this.userLibraryID();
  },

  canRemoveLegacyEntry(item, entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const entryKey = entry.zotero_key || item.key;
    if (entryKey && entryKey !== item.key) {
      return false;
    }
    const entryLibraryID = Number(entry.library_id || entry.libraryID || 0);
    const itemLibraryID = this.libraryIDForItem(item);
    if (Number.isInteger(entryLibraryID) && entryLibraryID > 0) {
      return entryLibraryID === itemLibraryID;
    }
    return itemLibraryID === this.userLibraryID();
  },

  userLibraryID() {
    return PaperBridge.Util.libraryIDForItem({ libraryID: Zotero.Libraries?.userLibraryID });
  }
};
