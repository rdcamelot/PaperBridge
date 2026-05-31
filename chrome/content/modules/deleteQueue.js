PaperBridge = PaperBridge || {};

PaperBridge.DeleteQueue = {
  async cleanRankedItems() {
    const items = await this.findDeleteRankedItems();
    if (!items.length) {
      PaperBridge.Util.alert("No items are marked with rank x.");
      return;
    }

    const ok = PaperBridge.Util.confirm(
      `Clean ${items.length} item(s) marked x?\n\nZotero items will be moved to Zotero Trash. Markdown notes will be deleted to the Windows Recycle Bin. No .trash folder will be used.`
    );
    if (!ok) {
      return;
    }

    const result = await this.cleanItems(items);
    PaperBridge.Util.refreshItemTreeColumns();
    PaperBridge.Util.alert(
      `Processed ${result.total} item(s).\n` +
      `Cleaned: ${result.cleaned}\n` +
      `Failed: ${result.failed}`
    );
  },

  async cleanItems(items) {
    const result = {
      total: 0,
      cleaned: 0,
      failed: 0
    };
    for (const item of items) {
      result.total++;
      try {
        await this.cleanItem(item);
        result.cleaned++;
      }
      catch (error) {
        result.failed++;
        PaperBridge.Util.logError(error);
      }
    }
    return result;
  },

  async findDeleteRankedItems() {
    const items = [];
    const seen = new Set();
    for (const libraryID of this.libraryIDsForCleanup()) {
      const search = new Zotero.Search();
      search.libraryID = libraryID;
      search.addCondition("tag", "is", PaperBridge.Ranks.rankTag("x"));
      const ids = await search.search();
      for (const id of ids) {
        const itemID = Number(id);
        if (!Number.isInteger(itemID) || itemID <= 0 || seen.has(itemID)) {
          continue;
        }
        seen.add(itemID);
        const item = Zotero.Items.get(itemID);
        if (item && PaperBridge.Notes.isRegularItem(item) && !item.deleted) {
          items.push(item);
        }
      }
    }
    return items;
  },

  libraryIDsForCleanup() {
    const selectedLibraryID = PaperBridge.Util.getSelectedLibraryID();
    if (PaperBridge.Util.isValidLibraryID(selectedLibraryID)) {
      return [Number(selectedLibraryID)];
    }

    if (typeof Zotero.Libraries?.getAll === "function") {
      return [...new Set(Zotero.Libraries.getAll()
        .map(library => library.libraryID || library.id)
        .filter(libraryID => PaperBridge.Util.isValidLibraryID(libraryID))
        .map(Number))];
    }

    return PaperBridge.Util.isValidLibraryID(Zotero.Libraries.userLibraryID)
      ? [Number(Zotero.Libraries.userLibraryID)]
      : [];
  },

  async cleanItem(item) {
    const path = await this.getSafeNotePathForCleanup(item);
    const previousDeleted = item.deleted;
    let zoteroTrashed = false;
    item.deleted = true;
    try {
      await item.saveTx();
      zoteroTrashed = true;
    }
    catch (error) {
      item.deleted = previousDeleted;
      throw error;
    }
    try {
      if (path && PaperBridge.Util.pathExistsSync(path)) {
        await this.sendFileToRecycleBin(path);
        if (PaperBridge.Util.pathExistsSync(path)) {
          throw new Error(`Recycle Bin deletion did not remove Markdown note: ${path}`);
        }
      }
    }
    catch (error) {
      if (zoteroTrashed) {
        await this.restoreDeletedState(item, previousDeleted, error);
      }
      throw error;
    }
    PaperBridge.Index.remove(item);
  },

  async getSafeNotePathForCleanup(item) {
    const path = PaperBridge.Notes.getNotePath(item);
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      return path;
    }

    const content = await Zotero.File.getContentsAsync(path);
    const fields = PaperBridge.Notes.parseFrontmatter(content);
    PaperBridge.Notes.assertFrontmatterBelongsToItem(fields, item);

    const validation = PaperBridge.Notes.validateFrontmatterContent(content, item);
    if (!validation.ok) {
      const missing = validation.missingKeys.length ? ` missing: ${validation.missingKeys.join(", ")}` : "";
      const mismatched = validation.mismatchedKeys.length ? ` mismatched: ${validation.mismatchedKeys.join(", ")}` : "";
      throw new Error(`Refusing to recycle Markdown note with invalid PaperBridge frontmatter.${missing}${mismatched}`);
    }

    return path;
  },

  async restoreDeletedState(item, deleted, originalError) {
    try {
      item.deleted = deleted;
      await item.saveTx();
    }
    catch (restoreError) {
      PaperBridge.Util.safeLogError(restoreError);
      PaperBridge.Util.safeLogError(originalError);
    }
  },

  async sendFileToRecycleBin(path) {
    if (!Zotero.isWin) {
      throw new Error("PaperBridge currently implements recycle-bin deletion only on Windows.");
    }

    const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    if (!PaperBridge.Util.pathExistsSync(powershell)) {
      throw new Error("PowerShell was not found; cannot send file to Recycle Bin.");
    }

    const escaped = String(path).replace(/'/g, "''");
    const command = [
      "Add-Type -AssemblyName Microsoft.VisualBasic;",
      `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}',`,
      "[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,",
      "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
    ].join(" ");
    PaperBridge.Util.runProcess(
      powershell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      true
    );
  }
};
