PaperBridge = PaperBridge || {};

PaperBridge.Bulk = {
  async createNotesForSelected() {
    const items = PaperBridge.Util.getSelectedRegularItems();
    if (!items.length) {
      PaperBridge.Util.alert("No regular Zotero items are selected.");
      return;
    }

    const result = await this.createNotesForItems(items, {
      collection: PaperBridge.Util.getSelectedCollection()
    });
    this.showResult(result);
  },

  async createNotesForCurrentCollection() {
    const collection = PaperBridge.Util.getSelectedCollection();
    if (!collection) {
      PaperBridge.Util.alert("Select a Zotero collection first.");
      return;
    }

    const items = await this.regularItemsFromCollection(collection);
    if (!items.length) {
      PaperBridge.Util.alert("The selected collection has no regular Zotero items.");
      return;
    }

    const ok = PaperBridge.Util.confirm(
      `Create or relink Markdown notes for ${items.length} item(s) in "${collection.name}"?`
    );
    if (!ok) {
      return;
    }

    const result = await this.createNotesForItems(items, { collection });
    this.showResult(result);
  },

  async moveSelectedNotesToCurrentCollection() {
    const collection = PaperBridge.Util.getSelectedCollection();
    if (!collection) {
      PaperBridge.Util.alert("Select a Zotero collection first.");
      return;
    }

    const items = PaperBridge.Util.getSelectedRegularItems();
    if (!items.length) {
      PaperBridge.Util.alert("No regular Zotero items are selected.");
      return;
    }

    const ok = PaperBridge.Util.confirm(
      `Move Markdown notes for ${items.length} selected item(s) to "${collection.name}"?`
    );
    if (!ok) {
      return;
    }

    const result = await this.moveNotesForItems(items, collection);
    PaperBridge.Util.alert(
      `Processed ${result.total} item(s).\n` +
      `Moved/updated: ${result.moved}\n` +
      `Missing notes: ${result.missing}\n` +
      `Failed: ${result.failed}`
    );
  },

  async relinkNoteForSelected() {
    const items = PaperBridge.Util.getSelectedRegularItems();
    if (items.length !== 1) {
      PaperBridge.Util.alert("Select exactly one regular Zotero item to relink a Markdown note.");
      return;
    }

    const path = await PaperBridge.Notes.selectAndRelinkMarkdownNote(items[0]);
    if (path) {
      PaperBridge.Util.alert(`Relinked Markdown note:\n${path}`);
    }
  },

  async regularItemsFromCollection(collection) {
    const childItems = await Promise.resolve(collection.getChildItems?.() || []);
    const items = await this.resolveChildItems(childItems);
    return items.filter(item => item && PaperBridge.Notes.isRegularItem(item) && !item.deleted);
  },

  async resolveChildItems(childItems) {
    const entries = Array.isArray(childItems) ? childItems : [];
    const itemIDs = entries
      .filter(entry => Number.isInteger(Number(entry)) && Number(entry) > 0)
      .map(Number);
    const directItems = entries.filter(entry => entry && typeof entry === "object");
    if (!itemIDs.length) {
      return directItems;
    }

    const resolved = typeof Zotero.Items.getAsync === "function"
      ? await Zotero.Items.getAsync(itemIDs)
      : itemIDs.map(id => Zotero.Items.get(id));
    return [...directItems, ...resolved];
  },

  async createNotesForItems(items, options = {}) {
    const seen = new Set();
    const result = {
      total: 0,
      created: 0,
      alreadyReady: 0,
      failed: 0
    };

    for (const item of items) {
      if (!item || seen.has(item.id) || !PaperBridge.Notes.isRegularItem(item) || item.deleted) {
        continue;
      }
      seen.add(item.id);
      result.total++;

      try {
        const state = PaperBridge.Notes.getNoteState(item);
        await PaperBridge.Notes.createNoteForItem(item, options);
        if (state === PaperBridge.Constants.noteStates.ready) {
          result.alreadyReady++;
        }
        else {
          result.created++;
        }
      }
      catch (error) {
        result.failed++;
        PaperBridge.Util.logError(error);
      }
    }

    PaperBridge.Util.refreshItemTreeColumns();
    return result;
  },

  async moveNotesForItems(items, collection) {
    const seen = new Set();
    const result = {
      total: 0,
      moved: 0,
      missing: 0,
      failed: 0
    };

    for (const item of items) {
      if (!item || seen.has(item.id) || !PaperBridge.Notes.isRegularItem(item) || item.deleted) {
        continue;
      }
      seen.add(item.id);
      result.total++;

      try {
        if (PaperBridge.Notes.getNoteState(item) !== PaperBridge.Constants.noteStates.ready) {
          result.missing++;
          continue;
        }
        await PaperBridge.Notes.moveNoteToCollection(item, collection);
        result.moved++;
      }
      catch (error) {
        result.failed++;
        PaperBridge.Util.logError(error);
      }
    }

    PaperBridge.Util.refreshItemTreeColumns();
    return result;
  },

  showResult(result) {
    PaperBridge.Util.alert(
      `Processed ${result.total} item(s).\n` +
      `Created/relinked: ${result.created}\n` +
      `Already ready: ${result.alreadyReady}\n` +
      `Failed: ${result.failed}`
    );
  }
};
