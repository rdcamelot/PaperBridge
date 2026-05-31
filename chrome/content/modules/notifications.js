PaperBridge = PaperBridge || {};

PaperBridge.Notifications = {
  observerID: null,
  timers: new Map(),
  pending: new Map(),
  retryCounts: new Map(),
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
  },

  observer: {
    notify: (event, type, ids, extraData) => {
      PaperBridge.Notifications.notify(event, type, ids, extraData);
    }
  },

  notify(event, type, ids, extraData) {
    if (!PaperBridge.Settings.getBool("autoCreate", true)) {
      return;
    }

    if (type === "item" && (event === "add" || event === "modify")) {
      for (const id of ids) {
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
      return;
    }

    try {
      await PaperBridge.Notes.createNoteForItem(item, { collection });
      this.retryCounts.delete(itemID);
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

  retryItem(itemID, collectionID, reason = "metadata is still incomplete") {
    const retries = (this.retryCounts.get(itemID) || 0) + 1;
    if (retries > this.maxRetries) {
      PaperBridge.Util.log(`Skipping auto-create for item ${itemID}; ${reason} after ${this.maxRetries} retries.`);
      this.retryCounts.delete(itemID);
      return;
    }
    this.retryCounts.set(itemID, retries);
    this.scheduleItem(itemID, collectionID, this.retryDelay);
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
    return this.collectionsForItem(item).find(collection => this.shouldAutoCreateForCollection(collection)) || null;
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
