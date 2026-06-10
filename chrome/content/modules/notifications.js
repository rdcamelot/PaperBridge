PaperBridge = PaperBridge || {};

PaperBridge.Notifications = {
  observerID: null,
  timers: new Map(),
  pending: new Map(),
  retryCounts: new Map(),
  noticeStates: new Map(),
  retryDelay: 5000,
  maxRetries: 5,

  start() {
    if (this.observerID) {
      return;
    }
    this.observerID = Zotero.Notifier.registerObserver(this.observer, ["item", "collection-item"], PaperBridge.id);
  },

  stop() {
    const observerID = this.observerID;
    this.observerID = null;
    if (observerID) {
      try {
        Zotero.Notifier.unregisterObserver(observerID);
      }
      catch (error) {
        PaperBridge.Util.safeLogError(error);
      }
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pending.clear();
    this.retryCounts.clear();
    this.noticeStates.clear();
  },

  observer: {
    notify: (event, type, ids, extraData) => {
      PaperBridge.Notifications.notify(event, type, ids, extraData);
    }
  },

  notify(event, type, ids, extraData) {
    if (type === "item" && (event === "delete" || event === "trash")) {
      this.handleDeletedOrTrashedItems(ids, extraData).catch(error => PaperBridge.Util.safeLogError(error));
      return;
    }

    if (!PaperBridge.Settings.getBool("autoCreate", true)) {
      return;
    }

    if (type === "item" && (event === "add" || event === "modify")) {
      for (const id of ids) {
        const item = Zotero.Items.get(Number(id));
        if (item?.deleted) {
          PaperBridge.Index.remove(item);
          PaperBridge.Util.refreshItemTreeColumns();
          continue;
        }
        this.scheduleItem(id);
      }
    }

    if (type === "collection-item" && event === "add") {
      for (const entry of this.extractCollectionItemEvents(ids, extraData)) {
        this.scheduleItem(entry.itemID, entry.collectionID);
      }
    }
  },

  scheduleItem(itemID, collectionID = null, delay = 3000) {
    const numericID = this.positiveIntegerID(itemID);
    if (!numericID) {
      return;
    }
    clearTimeout(this.timers.get(numericID));
    const existing = this.pending.get(numericID) || {};
    const numericCollectionID = this.positiveIntegerID(collectionID);
    const nextCollectionID = numericCollectionID
      ? numericCollectionID
      : existing.collectionID || null;
    this.pending.set(numericID, { collectionID: nextCollectionID });
    if (delay <= 3000) {
      this.showQueuedNotice(numericID, nextCollectionID);
    }

    const timer = setTimeout(() => {
      this.timers.delete(numericID);
      const pending = this.pending.get(numericID) || {};
      this.pending.delete(numericID);
      this.tryAutoCreate(numericID, pending.collectionID).catch(error => PaperBridge.Util.logError(error));
    }, delay);
    this.timers.set(numericID, timer);
  },

  async tryAutoCreate(itemID, collectionID = null) {
    const item = Zotero.Items.get(itemID);
    if (item?.deleted) {
      PaperBridge.Index.remove(item);
      PaperBridge.Util.refreshItemTreeColumns();
      this.clearNoticeState(itemID);
      return;
    }
    if (!item || !PaperBridge.Notes.isRegularItem(item) || item.deleted) {
      return;
    }
    const collectionIDs = this.collectionIDsForItem(item);
    if (!collectionIDs.length) {
      return;
    }
    const collection = this.autoCreateCollectionForItem(item, collectionID);
    if (!collection) {
      return;
    }
    if (!PaperBridge.Notes.hasMinimumMetadata(item)) {
      this.retryItem(itemID, collectionID, "metadata is still incomplete");
      return;
    }

    const state = PaperBridge.Notes.getNoteState(item);
    if (state !== PaperBridge.Constants.noteStates.create && !this.shouldRepairExistingNoteState(item, state)) {
      this.retryCounts.delete(itemID);
      this.clearNoticeState(itemID);
      return;
    }

    try {
      this.showAutoCreateNotice(item, "creating", { collection });
      const path = await PaperBridge.Notes.createNoteForItem(item, { collection });
      this.retryCounts.delete(itemID);
      this.showAutoCreateNotice(item, "complete", { collection, path, force: true });
      this.clearNoticeState(itemID);
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
      this.retryItem(itemID, collectionID, `last attempt failed: ${this.errorMessage(error)}`);
    }
  },

  shouldRepairExistingNoteState(item, state) {
    if (state !== PaperBridge.Constants.noteStates.missing) {
      return false;
    }
    const path = PaperBridge.Notes.getNotePath(item);
    return Boolean(path && PaperBridge.Util.pathExistsSync(path));
  },

  removeIndexEntriesForItemIDs(ids, extraData = {}) {
    let changed = false;
    for (const id of ids || []) {
      changed = PaperBridge.Index.removeByItemID(id) || changed;
    }

    for (const value of Object.values(extraData || {})) {
      const key = value?.key || value?.itemKey || value?.item?.key || value?.old?.key;
      const libraryID = value?.libraryID || value?.library?.libraryID || value?.item?.libraryID || value?.old?.libraryID;
      if (key) {
        changed = PaperBridge.Index.removeByLibraryAndKey(libraryID, key) || changed;
      }
    }

    if (changed) {
      PaperBridge.Util.refreshItemTreeColumns();
    }
    return changed;
  },

  async handleDeletedOrTrashedItems(ids, extraData = {}) {
    const recycleResult = await this.recycleMarkdownForDeletedItems(ids, extraData);
    const changed = this.removeIndexEntriesForItemIDs(ids, extraData);
    if (changed || recycleResult.recycled || recycleResult.failed) {
      PaperBridge.Util.refreshItemTreeColumns();
    }
    return Object.assign({ indexChanged: changed }, recycleResult);
  },

  async recycleMarkdownForDeletedItems(ids, extraData = {}) {
    const result = { checked: 0, recycled: 0, failed: 0 };
    const enabled = PaperBridge.Settings.deleteMarkdownWithZoteroItem?.()
      ?? PaperBridge.Settings.getBool("deleteMarkdownWithZoteroItem", true);
    if (!enabled || typeof PaperBridge.DeleteQueue?.recycleMarkdownNoteForItem !== "function") {
      return result;
    }

    for (const candidate of this.deletedItemIndexCandidates(ids, extraData)) {
      result.checked++;
      const item = candidate.item || this.resolveItemForIndexEntry(candidate.entry);
      const path = String(candidate.entry?.note_path || "").trim();
      if (!item || !path) {
        continue;
      }
      try {
        const existedBefore = PaperBridge.Util.pathExistsSync(path);
        const recycledPath = await PaperBridge.DeleteQueue.recycleMarkdownNoteForItem(item, path);
        if (existedBefore && recycledPath && !PaperBridge.Util.pathExistsSync(recycledPath)) {
          result.recycled++;
        }
      }
      catch (error) {
        result.failed++;
        PaperBridge.Util.safeLogError(error);
      }
    }
    return result;
  },

  deletedItemIndexCandidates(ids, extraData = {}) {
    const all = PaperBridge.Index.all();
    const candidates = new Map();
    const itemIDs = new Set();
    const itemsByID = new Map();
    const keyedEvents = [];
    const addCandidate = (indexKey, entry, item = null) => {
      if (!indexKey || !entry || candidates.has(indexKey)) {
        return;
      }
      candidates.set(indexKey, { indexKey, entry, item });
    };

    for (const id of ids || []) {
      const numericID = this.positiveIntegerID(id);
      if (!numericID) {
        continue;
      }
      itemIDs.add(numericID);
      itemsByID.set(numericID, Zotero.Items.get(numericID) || null);
    }

    for (const value of Object.values(extraData || {})) {
      const key = value?.key || value?.itemKey || value?.item?.key || value?.old?.key;
      const libraryID = value?.libraryID || value?.library?.libraryID || value?.item?.libraryID || value?.old?.libraryID;
      if (!key) {
        continue;
      }
      keyedEvents.push({ key, libraryID, item: value?.item || null });
    }

    if (!itemIDs.size && !keyedEvents.length) {
      return [];
    }

    for (const [indexKey, entry] of Object.entries(all)) {
      const entryItemID = this.positiveIntegerID(entry?.item_id || entry?.itemID);
      if (entryItemID && itemIDs.has(entryItemID)) {
        addCandidate(indexKey, entry, itemsByID.get(entryItemID) || null);
        continue;
      }

      for (const event of keyedEvents) {
        if (PaperBridge.Index.entryMatchesLibraryAndKey(indexKey, entry, event.libraryID, event.key)) {
          addCandidate(indexKey, entry, event.item);
          break;
        }
      }
    }

    return [...candidates.values()];
  },

  resolveItemForIndexEntry(entry) {
    if (!entry) {
      return null;
    }
    const itemID = this.positiveIntegerID(entry.item_id || entry.itemID);
    if (itemID) {
      const item = Zotero.Items.get(itemID);
      if (item) {
        return item;
      }
    }
    const itemKey = String(entry.zotero_key || entry.key || "").trim();
    const libraryID = Number(entry.library_id || entry.libraryID || 0);
    if (itemKey && PaperBridge.Util.isValidLibraryID(libraryID) && typeof Zotero.Items?.getByLibraryAndKey === "function") {
      return Zotero.Items.getByLibraryAndKey(libraryID, itemKey) || null;
    }
    return null;
  },

  retryItem(itemID, collectionID, reason = "metadata is still incomplete") {
    const retries = (this.retryCounts.get(itemID) || 0) + 1;
    const item = Zotero.Items.get(itemID);
    if (retries > this.maxRetries) {
      PaperBridge.Util.log(`Skipping auto-create for item ${itemID}; ${reason} after ${this.maxRetries} retries.`);
      this.retryCounts.delete(itemID);
      this.showAutoCreateNotice(item, "failed", {
        reason: `${reason} after ${this.maxRetries} retries`,
        force: true
      });
      this.clearNoticeState(itemID);
      return;
    }
    this.retryCounts.set(itemID, retries);
    this.showAutoCreateNotice(item, reason.startsWith("last attempt failed") ? "retrying" : "waiting", {
      reason,
      retry: retries
    });
    this.scheduleItem(itemID, collectionID, this.retryDelay);
  },

  showQueuedNotice(itemID, collectionID) {
    const item = Zotero.Items.get(itemID);
    if (!item || !PaperBridge.Notes.isRegularItem(item)) {
      return false;
    }
    const collectionIDs = this.collectionIDsForItem(item);
    if (!collectionIDs.length) {
      return false;
    }
    const collection = this.autoCreateCollectionForItem(item, collectionID);
    if (!collection) {
      return false;
    }
    const state = PaperBridge.Notes.getNoteState(item);
    if (state !== PaperBridge.Constants.noteStates.create && !this.shouldRepairExistingNoteState(item, state)) {
      return false;
    }
    return this.showAutoCreateNotice(item, "queued", { collection });
  },

  showAutoCreateNotice(item, stage, options = {}) {
    if (!item || !this.shouldShowAutoCreateNotices()) {
      return false;
    }
    const stageInfo = this.autoCreateNoticeForStage(item, stage, options);
    if (!stageInfo) {
      return false;
    }

    const stateKey = this.autoCreateNoticeStateKey(stage, options);
    if (!options.force && item.id && this.noticeStates.get(item.id) === stateKey) {
      return false;
    }
    if (item.id) {
      this.noticeStates.set(item.id, stateKey);
    }

    return PaperBridge.Util.showProgressNotification({
      headline: "PaperBridge",
      message: stageInfo.message,
      description: stageInfo.description,
      itemType: "note",
      progress: stageInfo.progress,
      error: stageInfo.error,
      timeout: stageInfo.timeout
    });
  },

  shouldShowAutoCreateNotices() {
    return Boolean(PaperBridge.Settings.autoCreateNotifications?.()
      ?? PaperBridge.Settings.getBool("autoCreateNotifications", true));
  },

  autoCreateNoticeForStage(item, stage, options = {}) {
    const title = this.truncatedItemTitle(item);
    const collectionName = options.collection?.name ? ` (${options.collection.name})` : "";
    const path = String(options.path || "").trim();
    const reason = options.reason ? this.errorMessage(options.reason) : "";

    switch (stage) {
      case "queued":
        return {
          message: `Received item: ${title}`,
          description: `PaperBridge will create the Markdown note after Zotero metadata settles${collectionName}.`,
          progress: 20,
          timeout: 3500
        };
      case "waiting":
        return {
          message: `Waiting for metadata: ${title}`,
          description: reason || "Zotero has not finished filling item metadata yet.",
          progress: 35,
          timeout: 4500
        };
      case "creating":
        return {
          message: `Creating Markdown note: ${title}`,
          description: collectionName ? `Target collection${collectionName}` : "",
          progress: 65,
          timeout: 3500
        };
      case "retrying":
        return {
          message: `Markdown note creation will retry: ${title}`,
          description: reason,
          progress: 45,
          timeout: 5500
        };
      case "complete":
        return {
          message: `Markdown note created: ${title}`,
          description: path,
          progress: 100,
          timeout: 500
        };
      case "failed":
        return {
          message: `Markdown note was not created: ${title}`,
          description: reason,
          error: true,
          progress: 100,
          timeout: 8000
        };
      default:
        return null;
    }
  },

  autoCreateNoticeStateKey(stage, options = {}) {
    if (stage === "failed") {
      return `${stage}:${this.errorMessage(options.reason || "")}`;
    }
    return stage;
  },

  clearNoticeState(itemID) {
    const numericID = this.positiveIntegerID(itemID);
    if (numericID) {
      this.noticeStates.delete(numericID);
    }
  },

  truncatedItemTitle(item) {
    const title = String(item?.getField?.("title") || "(untitled)").replace(/\s+/g, " ").trim();
    return title.length > 70 ? `${title.slice(0, 67)}...` : title;
  },

  errorMessage(error) {
    const message = String(error?.message || error || "unknown error").replace(/\s+/g, " ").trim();
    return message.length > 120 ? `${message.slice(0, 117)}...` : message;
  },

  collectionForItem(item, collectionID) {
    const collection = PaperBridge.Notes.resolveCollection(collectionID);
    const itemCollectionIDs = this.collectionIDSetForItem(item);
    if (collection && itemCollectionIDs.has(Number(collection.id))) {
      return collection;
    }
    return null;
  },

  collectionsForItem(item) {
    const collectionIDs = this.collectionIDsForItem(item);
    return collectionIDs
      .map(collectionID => PaperBridge.Notes.resolveCollection(collectionID))
      .filter(Boolean);
  },

  collectionIDsForItem(item) {
    return PaperBridge.Util.collectionIDsForItem(item);
  },

  collectionIDSetForItem(item) {
    return new Set(this.collectionIDsForItem(item));
  },

  autoCreateCollectionForItem(item, collectionID) {
    const preferredCollection = this.collectionForItem(item, collectionID);
    if (preferredCollection) {
      return this.shouldAutoCreateForCollection(preferredCollection) ? preferredCollection : null;
    }
    const selectedCollection = this.selectedCollectionForItem(item);
    if (selectedCollection) {
      return this.shouldAutoCreateForCollection(selectedCollection) ? selectedCollection : null;
    }
    return this.collectionsForItem(item).find(collection => this.shouldAutoCreateForCollection(collection)) || null;
  },

  selectedCollectionForItem(item) {
    const selected = PaperBridge.Util.getSelectedCollection();
    const selectedID = this.positiveIntegerID(selected?.id);
    if (!selectedID || !this.collectionIDSetForItem(item).has(selectedID)) {
      return null;
    }
    return PaperBridge.Notes.resolveCollection(selectedID) || selected;
  },

  shouldAutoCreateForCollection(collection) {
    if (!collection?.name) {
      return false;
    }
    const ignored = PaperBridge.Settings.ignoreCollections();
    if (PaperBridge.Settings.collectionNameMatches(collection.name, ignored)) {
      return false;
    }
    const allowed = PaperBridge.Settings.autoCreateOnlyCollections();
    return !allowed.length || PaperBridge.Settings.collectionNameMatches(collection.name, allowed);
  },

  extractCollectionItemEvents(ids, extraData) {
    const found = new Map();
    for (const value of Object.values(extraData || {})) {
      const itemID = value?.itemID || value?.item?.id || value?.id;
      const collectionID = value?.collectionID || value?.collection?.id;
      const numericItemID = this.positiveIntegerID(itemID);
      if (numericItemID) {
        found.set(numericItemID, {
          itemID: numericItemID,
          collectionID: this.positiveIntegerID(collectionID)
        });
      }
    }

    for (const id of ids || []) {
      const parsed = this.collectionItemFromNotifierID(id);
      if (parsed?.itemID && Zotero.Items.get(parsed.itemID)) {
        found.set(parsed.itemID, parsed);
      }
    }
    return [...found.values()];
  },

  collectionItemFromNotifierID(id) {
    const numbers = (String(id).match(/\d+/g)?.map(Number) || [])
      .filter(number => this.positiveIntegerID(number));
    if (!numbers.length) {
      return null;
    }

    if (numbers.length >= 2) {
      const candidates = [
        { collectionID: numbers[0], itemID: numbers[numbers.length - 1] },
        { collectionID: numbers[numbers.length - 1], itemID: numbers[0] }
      ];
      for (const candidate of candidates) {
        if (Zotero.Items.get(candidate.itemID) && PaperBridge.Notes.resolveCollection(candidate.collectionID)) {
          return candidate;
        }
      }
    }

    return {
      itemID: numbers[numbers.length - 1],
      collectionID: null
    };
  },

  positiveIntegerID(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }
};
