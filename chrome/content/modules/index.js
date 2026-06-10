PaperBridge = PaperBridge || {};

PaperBridge.Index = {
  cacheRaw: null,
  cacheParsed: null,

  all() {
    const raw = PaperBridge.Settings.getString("index", "{}");
    if (raw === this.cacheRaw && this.cacheParsed && typeof this.cacheParsed === "object") {
      return this.cacheParsed;
    }

    try {
      const parsed = JSON.parse(raw);
      const all = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      this.cacheRaw = raw;
      this.cacheParsed = all;
      return all;
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
      this.cacheRaw = raw;
      this.cacheParsed = {};
      return {};
    }
  },

  save(all) {
    const raw = JSON.stringify(all || {});
    this.cacheRaw = raw;
    this.cacheParsed = all || {};
    PaperBridge.Settings.set("index", raw);
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
      return false;
    }
    const all = this.all();
    const key = this.itemIndexKey(item);
    const legacyKey = this.legacyItemKey(item);
    let changed = false;
    if (key && Object.prototype.hasOwnProperty.call(all, key)) {
      delete all[key];
      changed = true;
    }
    if (legacyKey !== key && this.canRemoveLegacyEntry(item, all[legacyKey])) {
      delete all[legacyKey];
      changed = true;
    }
    if (changed) {
      this.save(all);
    }
    return changed;
  },

  removeByItemID(itemID) {
    const numericItemID = Number(itemID);
    if (!Number.isInteger(numericItemID) || numericItemID <= 0) {
      return false;
    }

    const all = this.all();
    let changed = false;
    for (const [key, entry] of Object.entries(all)) {
      if (Number(entry?.item_id || entry?.itemID || 0) === numericItemID) {
        delete all[key];
        changed = true;
      }
    }
    if (changed) {
      this.save(all);
    }
    return changed;
  },

  removeByLibraryAndKey(libraryID, itemKey) {
    const key = String(itemKey || "").trim();
    const numericLibraryID = PaperBridge.Util.isValidLibraryID(libraryID) ? Number(libraryID) : null;
    if (!key) {
      return false;
    }

    const all = this.all();
    let changed = false;
    const directKeys = [numericLibraryID ? `${numericLibraryID}:${key}` : "", key].filter(Boolean);
    for (const indexKey of directKeys) {
      if (this.removeEntryByIndexKey(all, indexKey, key, numericLibraryID)) {
        changed = true;
      }
    }

    for (const [indexKey, entry] of Object.entries(all)) {
      if (!this.entryMatchesLibraryAndKey(indexKey, entry, numericLibraryID, key)) {
        continue;
      }
      delete all[indexKey];
      changed = true;
    }
    if (changed) {
      this.save(all);
    }
    return changed;
  },

  removeEntryByIndexKey(all, indexKey, itemKey, libraryID) {
    const entry = all[indexKey];
    if (!entry || !this.entryMatchesLibraryAndKey(indexKey, entry, libraryID, itemKey)) {
      return false;
    }
    delete all[indexKey];
    return true;
  },

  entryMatchesLibraryAndKey(indexKey, entry, libraryID, itemKey) {
    const key = String(itemKey || "").trim();
    if (!key) {
      return false;
    }
    const entryKey = this.entryItemKey(indexKey, entry);
    if (entryKey !== key) {
      return false;
    }
    if (PaperBridge.Util.isValidLibraryID(libraryID)) {
      const entryLibraryID = this.entryLibraryID(indexKey, entry);
      if (PaperBridge.Util.isValidLibraryID(entryLibraryID) && Number(entryLibraryID) !== Number(libraryID)) {
        return false;
      }
    }
    return true;
  },

  pruneStaleEntries() {
    const all = this.all();
    let checked = 0;
    let removed = 0;

    for (const [indexKey, entry] of Object.entries(all)) {
      checked++;
      if (!this.shouldKeepEntry(indexKey, entry)) {
        delete all[indexKey];
        removed++;
      }
    }

    if (removed) {
      this.save(all);
      PaperBridge.Util.refreshItemTreeColumns();
    }
    return { checked, removed };
  },

  shouldKeepEntry(indexKey, entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const resolved = this.resolveEntryItem(indexKey, entry);
    if (!resolved.attempted) {
      return true;
    }
    return Boolean(resolved.item && !resolved.item.deleted);
  },

  resolveEntryItem(indexKey, entry) {
    const itemKey = this.entryItemKey(indexKey, entry);
    const libraryID = this.entryLibraryID(indexKey, entry);
    let attempted = false;

    if (itemKey && PaperBridge.Util.isValidLibraryID(libraryID) && typeof Zotero.Items?.getByLibraryAndKey === "function") {
      attempted = true;
      const item = Zotero.Items.getByLibraryAndKey(Number(libraryID), itemKey);
      if (item) {
        return { attempted, item };
      }
    }

    const itemID = Number(entry.item_id || entry.itemID || 0);
    if (Number.isInteger(itemID) && itemID > 0 && typeof Zotero.Items?.get === "function") {
      attempted = true;
      const item = Zotero.Items.get(itemID);
      if (!item) {
        return { attempted, item: null };
      }
      if (itemKey && item.key && item.key !== itemKey) {
        return { attempted, item: null };
      }
      if (PaperBridge.Util.isValidLibraryID(libraryID) && PaperBridge.Util.libraryIDForItem(item) !== Number(libraryID)) {
        return { attempted, item: null };
      }
      return { attempted, item };
    }

    return { attempted, item: null };
  },

  entryItemKey(indexKey, entry) {
    const explicit = String(entry?.zotero_key || entry?.key || "").trim();
    if (explicit) {
      return explicit;
    }
    const parts = String(indexKey || "").split(":");
    return String(parts[parts.length - 1] || "").trim();
  },

  entryLibraryID(indexKey, entry) {
    const explicit = Number(entry?.library_id || entry?.libraryID || 0);
    if (PaperBridge.Util.isValidLibraryID(explicit)) {
      return explicit;
    }
    const match = String(indexKey || "").match(/^(\d+):/);
    return match ? Number(match[1]) : null;
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
