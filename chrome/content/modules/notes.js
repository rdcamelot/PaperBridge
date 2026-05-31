PaperBridge = PaperBridge || {};

PaperBridge.Notes = {
  frontmatterValidationCache: new Map(),

  isRegularItem(item) {
    return Boolean(item && typeof item.isRegularItem === "function" && item.isRegularItem());
  },

  hasMinimumMetadata(item) {
    return Boolean(this.isRegularItem(item) && String(item.getField("title") || "").trim());
  },

  getNoteAttachment(item) {
    if (!item || typeof item.getAttachments !== "function") {
      return null;
    }
    const title = PaperBridge.Settings.noteAttachmentTitle();
    const indexedPath = PaperBridge.Index.get(item)?.note_path || "";
    const indexedComparable = PaperBridge.Util.normalizePathForCompare(indexedPath);
    const attachments = [];

    for (const attachmentID of item.getAttachments()) {
      const attachment = Zotero.Items.get(attachmentID);
      if (!attachment?.isAttachment?.()) {
        continue;
      }
      const path = this.getAttachmentPath(attachment);
      const attachmentTitle = attachment.getField("title") || "";
      attachments.push({ attachment, path, title: attachmentTitle });
    }

    const titled = attachments.find(entry => entry.title === title);
    if (titled) {
      return titled.attachment;
    }

    if (indexedComparable) {
      const indexed = attachments.find(entry =>
        PaperBridge.Util.normalizePathForCompare(entry.path) === indexedComparable
      );
      if (indexed) {
        return indexed.attachment;
      }
    }

    return null;
  },

  getAttachmentPath(attachment) {
    if (!attachment) {
      return "";
    }
    if (typeof attachment.getFilePath === "function") {
      return attachment.getFilePath() || "";
    }
    const path = attachment.attachmentPath || "";
    if (path.startsWith(Zotero.Attachments.BASE_PATH_PLACEHOLDER)) {
      const resolved = Zotero.Attachments.resolveRelativePath(path);
      return resolved || "";
    }
    return path;
  },

  getNotePath(item) {
    const attachment = this.getNoteAttachment(item);
    const attachmentPath = this.getAttachmentPath(attachment);
    if (attachmentPath) {
      return attachmentPath;
    }
    return PaperBridge.Index.get(item)?.note_path || "";
  },

  getNoteState(item) {
    if (!this.isRegularItem(item)) {
      return "";
    }
    const path = this.getNotePath(item);
    if (!path) {
      return PaperBridge.Constants.noteStates.create;
    }
    if (this.needsLinkedAttachmentRepair(item)) {
      return PaperBridge.Constants.noteStates.missing;
    }
    return PaperBridge.Util.pathExistsSync(path)
      && this.hasValidFrontmatterAtPath(path, item)
      ? PaperBridge.Constants.noteStates.ready
      : PaperBridge.Constants.noteStates.missing;
  },

  needsLinkedAttachmentRepair(item) {
    if (!PaperBridge.Settings.getBool("attachLinkedNote", true)) {
      return false;
    }
    const indexedPath = PaperBridge.Index.get(item)?.note_path || "";
    return Boolean(indexedPath && !this.getNoteAttachment(item));
  },

  getNoteCellData(item) {
    if (!this.isRegularItem(item)) {
      return "";
    }
    return `${item.id}|${this.getNoteState(item)}`;
  },

  async handleNoteClick(itemID) {
    const item = Zotero.Items.get(Number(itemID));
    if (!item || !this.isRegularItem(item)) {
      return;
    }

    const state = this.getNoteState(item);
    if (state === PaperBridge.Constants.noteStates.ready) {
      await this.openNote(item);
      return;
    }

    if (state === PaperBridge.Constants.noteStates.missing) {
      const path = this.getNotePath(item);
      if (path && PaperBridge.Util.pathExistsSync(path)) {
        const repair = PaperBridge.Util.confirm("The linked Markdown note has missing or invalid PaperBridge frontmatter. Repair it?");
        if (!repair) {
          return;
        }
        await this.repairMarkdownNote(item);
        await this.openNote(item);
        return;
      }

      const relink = PaperBridge.Util.confirm("The linked Markdown note is missing. Select an existing Markdown note to relink? Press Cancel to create a new note.");
      if (relink) {
        const relinkedPath = await this.selectAndRelinkMarkdownNote(item);
        if (relinkedPath) {
          await this.openPath(relinkedPath);
        }
        return;
      }
    }

    const path = await this.createNoteForItem(item);
    await this.openPath(path);
  },

  async createNoteForItem(item, options = {}) {
    if (!this.isRegularItem(item)) {
      throw new Error("PaperBridge can create notes only for regular Zotero items.");
    }

    const collection = this.resolveCollection(options.collection) || this.pickPrimaryCollection(item);
    const existingPath = this.getNotePath(item);
    if (existingPath && PaperBridge.Util.pathExistsSync(existingPath)) {
      await this.ensureExistingNoteLinked(item, existingPath, collection);
      return existingPath;
    }

    const directory = this.directoryForCollection(collection);
    await PaperBridge.Util.ensureDirectory(directory);

    const filename = await this.filenameForItem(item);
    const path = await PaperBridge.Util.uniquePath(directory, filename);
    const content = await this.renderMarkdown(item, collection);
    await Zotero.File.putContentsAsync(path, content);

    this.rememberNotePath(item, path, collection);
    try {
      if (PaperBridge.Settings.getBool("attachLinkedNote", true)) {
        await this.attachMarkdownNote(item, path);
      }
    }
    catch (error) {
      PaperBridge.Util.refreshItemTreeColumns();
      throw error;
    }

    await PaperBridge.Ranks.ensureUnreadStatus(item);
    PaperBridge.Util.refreshItemTreeColumns();
    return path;
  },

  rememberNotePath(item, path, collection = null, fields = {}) {
    PaperBridge.Index.set(item, {
      note_path: path,
      primary_collection: fields?.primary_collection
        || fields?.collection
        || collection?.name
        || PaperBridge.Index.get(item)?.primary_collection
        || PaperBridge.Constants.unfiledDirectoryName,
      citekey: this.citekeyForItem(item),
      rank: PaperBridge.Ranks.getRank(item)
    });
  },

  async ensureExistingNoteLinked(item, path, collection = null) {
    const fields = await this.ensurePaperBridgeFrontmatter(item, path, collection);
    this.rememberNotePath(item, path, collection, fields);

    if (PaperBridge.Settings.getBool("attachLinkedNote", true)) {
      await this.attachMarkdownNote(item, path);
    }
    PaperBridge.Util.refreshItemTreeColumns();
  },

  async ensurePaperBridgeFrontmatter(item, path, collection = null) {
    const content = await Zotero.File.getContentsAsync(path);
    let fields = this.parseFrontmatter(content) || {};
    const originalFields = Object.assign({}, fields);
    this.assertFrontmatterBelongsToItem(fields, item);
    if (!this.validateFrontmatterContent(content, item).ok) {
      const updates = this.frontmatterRepairUpdatesForItem(item, content, collection);
      await Zotero.File.putContentsAsync(path, this.updateMarkdownFrontmatterContent(content, updates));
      fields = Object.assign({}, fields, updates);
      this.frontmatterValidationCache.delete(this.frontmatterCacheKey(path, item));
    }
    await PaperBridge.Ranks.applyFrontmatterState(item, originalFields);
    return fields;
  },

  async relinkMarkdownNote(item, path, collection = null) {
    if (!this.isRegularItem(item)) {
      throw new Error("PaperBridge can relink notes only for regular Zotero items.");
    }
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      throw new Error("Select an existing Markdown note file.");
    }
    await this.assertRelinkTargetBelongsToItem(item, path);
    await this.ensureExistingNoteLinked(item, path, collection || this.pickPrimaryCollection(item));
    PaperBridge.Util.refreshItemTreeColumns();
    return path;
  },

  async assertRelinkTargetBelongsToItem(item, path) {
    const content = await Zotero.File.getContentsAsync(path);
    const fields = this.parseFrontmatter(content);
    this.assertFrontmatterBelongsToItem(fields, item);
  },

  assertFrontmatterBelongsToItem(fields, item) {
    const existingKey = String(fields?.zotero_key || "").trim();
    if (existingKey && item?.key && existingKey !== item.key) {
      throw new Error(`The selected Markdown note belongs to another Zotero item (${existingKey}).`);
    }

    const existingURIKey = PaperBridge.Util.itemKeyFromZoteroURI(fields?.zotero);
    if (existingURIKey && item?.key && existingURIKey !== item.key) {
      throw new Error(`The selected Markdown note links to another Zotero item (${existingURIKey}).`);
    }

    const existingLibraryID = PaperBridge.Util.libraryIDFromZoteroURI(fields?.zotero);
    const itemLibraryID = PaperBridge.Util.libraryIDForItem(item);
    if (PaperBridge.Util.zoteroURIHasLibraryTarget(fields?.zotero) && !existingLibraryID) {
      throw new Error("The selected Markdown note links to an unknown Zotero library.");
    }
    if (existingLibraryID && itemLibraryID && existingLibraryID !== itemLibraryID) {
      throw new Error(`The selected Markdown note belongs to another Zotero library (${existingLibraryID}).`);
    }
  },

  async selectAndRelinkMarkdownNote(item) {
    const path = await PaperBridge.Util.pickMarkdownFile("Select Markdown Reading Note");
    if (!path) {
      return "";
    }
    return this.relinkMarkdownNote(item, path);
  },

  async openNote(item) {
    const path = this.getNotePath(item);
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      throw new Error("Markdown note file is missing.");
    }
    await this.openPath(path);
  },

  async openPath(path) {
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      throw new Error("Markdown note file is missing.");
    }

    const editorPath = PaperBridge.Settings.editorPath();
    if (editorPath && PaperBridge.Util.pathExistsSync(editorPath)) {
      try {
        PaperBridge.Util.runProcess(editorPath, [path], false);
        return;
      }
      catch (error) {
        PaperBridge.Util.safeLogError(error);
      }
    }

    const file = Zotero.File.pathToFile(path);
    file.launch();
  },

  async attachMarkdownNote(item, path) {
    const existing = this.getNoteAttachment(item);
    if (existing) {
      return this.updateMarkdownAttachment(existing, path);
    }

    return Zotero.Attachments.linkFromFile({
      file: path,
      parentItemID: item.id,
      title: PaperBridge.Settings.noteAttachmentTitle(),
      contentType: PaperBridge.Constants.markdownContentType
    });
  },

  async updateMarkdownAttachment(attachment, path) {
    const previous = {
      title: this.attachmentTitle(attachment),
      path: attachment.attachmentPath,
      contentType: attachment.attachmentContentType
    };

    try {
      this.setAttachmentTitle(attachment, PaperBridge.Settings.noteAttachmentTitle());
      attachment.attachmentPath = path;
      attachment.attachmentContentType = PaperBridge.Constants.markdownContentType;
      await attachment.saveTx();
      return attachment;
    }
    catch (error) {
      this.restoreAttachmentState(attachment, previous);
      throw error;
    }
  },

  attachmentTitle(attachment) {
    try {
      return attachment?.getField?.("title") || "";
    }
    catch (error) {
      return "";
    }
  },

  setAttachmentTitle(attachment, title) {
    if (typeof attachment?.setField === "function") {
      attachment.setField("title", title);
      return;
    }
    attachment.title = title;
  },

  restoreAttachmentState(attachment, previous) {
    try {
      this.setAttachmentTitle(attachment, previous.title);
      attachment.attachmentPath = previous.path;
      attachment.attachmentContentType = previous.contentType;
    }
    catch (restoreError) {
      PaperBridge.Util.safeLogError(restoreError);
    }
  },

  async moveNoteToCollection(item, collection) {
    if (!this.isRegularItem(item)) {
      throw new Error("PaperBridge can move notes only for regular Zotero items.");
    }
    const resolvedCollection = this.resolveCollection(collection);
    if (!resolvedCollection) {
      throw new Error("Select a Zotero collection before moving the note.");
    }

    const currentPath = this.getNotePath(item);
    if (!currentPath || !PaperBridge.Util.pathExistsSync(currentPath)) {
      throw new Error("Markdown note file is missing.");
    }

    const targetDirectory = this.directoryForCollection(resolvedCollection);
    await PaperBridge.Util.ensureDirectory(targetDirectory);

    const currentDirectory = PaperBridge.Util.pathParent(currentPath);
    const filename = PaperBridge.Util.pathBasename(currentPath) || await this.filenameForItem(item);
    const targetPath = PaperBridge.Util.pathsEqual(currentDirectory, targetDirectory)
      ? currentPath
      : await PaperBridge.Util.uniquePath(targetDirectory, filename);

    const originalContent = await Zotero.File.getContentsAsync(currentPath);
    this.assertFrontmatterBelongsToItem(this.parseFrontmatter(originalContent), item);
    const nextContent = this.updateMarkdownFrontmatterContent(originalContent, {
      collection: resolvedCollection.name,
      primary_collection: resolvedCollection.name,
      updated: PaperBridge.Util.todayISO()
    });
    const moved = !PaperBridge.Util.pathsEqual(currentPath, targetPath);
    let attachmentUpdated = false;

    if (!PaperBridge.Util.pathsEqual(currentPath, targetPath)) {
      await IOUtils.move(currentPath, targetPath);
    }
    try {
      await Zotero.File.putContentsAsync(targetPath, nextContent);
      if (moved) {
        await this.attachMarkdownNote(item, targetPath);
        attachmentUpdated = true;
      }
    }
    catch (error) {
      if (moved && !attachmentUpdated) {
        await this.rollbackMovedNote(currentPath, targetPath, originalContent);
      }
      throw error;
    }

    PaperBridge.Index.set(item, {
      note_path: targetPath,
      primary_collection: resolvedCollection.name,
      citekey: this.citekeyForItem(item),
      rank: PaperBridge.Ranks.getRank(item)
    });
    PaperBridge.Util.refreshItemTreeColumns();
    return targetPath;
  },

  async rollbackMovedNote(originalPath, movedPath, originalContent) {
    try {
      if (await IOUtils.exists(movedPath)) {
        await IOUtils.move(movedPath, originalPath);
      }
      if (await IOUtils.exists(originalPath)) {
        await Zotero.File.putContentsAsync(originalPath, originalContent);
      }
    }
    catch (rollbackError) {
      PaperBridge.Util.logError(rollbackError);
    }
  },

  async updateMarkdownFrontmatter(path, updates) {
    const content = await Zotero.File.getContentsAsync(path);
    await Zotero.File.putContentsAsync(path, this.updateMarkdownFrontmatterContent(content, updates));
  },

  async repairMarkdownNote(item) {
    const path = this.getNotePath(item);
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      throw new Error("Markdown note file is missing.");
    }
    const collection = this.pickPrimaryCollection(item);
    const content = await Zotero.File.getContentsAsync(path);
    this.assertFrontmatterBelongsToItem(this.parseFrontmatter(content), item);
    const updates = this.frontmatterRepairUpdatesForItem(item, content, collection);
    await Zotero.File.putContentsAsync(path, this.updateMarkdownFrontmatterContent(content, updates));
    this.frontmatterValidationCache.delete(this.frontmatterCacheKey(path, item));
    await this.attachMarkdownNote(item, path);
    PaperBridge.Index.set(item, {
      note_path: path,
      primary_collection: updates.primary_collection,
      citekey: this.citekeyForItem(item),
      rank: PaperBridge.Ranks.getRank(item)
    });
    PaperBridge.Util.refreshItemTreeColumns();
    return path;
  },

  async updateLinkedNoteRank(item, rank) {
    const path = this.getNotePath(item);
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      return false;
    }

    const content = await Zotero.File.getContentsAsync(path);
    this.assertFrontmatterBelongsToItem(this.parseFrontmatter(content), item);
    const validation = this.validateFrontmatterContent(content, item);
    const updates = validation.ok
      ? {
        rank,
        updated: PaperBridge.Util.todayISO()
      }
      : this.frontmatterRepairUpdatesForItem(item, content, null, { rank });

    await Zotero.File.putContentsAsync(path, this.updateMarkdownFrontmatterContent(content, updates));
    this.frontmatterValidationCache.delete(this.frontmatterCacheKey(path, item));
    return true;
  },

  updateMarkdownFrontmatterContent(content, updates) {
    const text = String(content || "");
    const lines = text.split(/\r?\n/);
    if (!this.isFrontmatterDelimiter(lines[0], true)) {
      return this.renderAddedFrontmatter(text, updates);
    }

    const endIndex = lines.findIndex((line, index) => index > 0 && this.isFrontmatterDelimiter(line));
    if (endIndex < 0) {
      return this.renderAddedFrontmatter(text, updates);
    }

    const frontmatter = lines.slice(1, endIndex);
    const rest = lines.slice(endIndex);
    const pending = Object.assign({}, updates);
    const updateKeys = new Set(Object.keys(updates));
    const replacedKeys = new Set();
    const nextFrontmatter = frontmatter.map(line => {
      const match = line.match(/^([A-Za-z0-9_-]+):(?:\s.*)?$/);
      if (!match || !updateKeys.has(match[1])) {
        return line;
      }
      const key = match[1];
      if (replacedKeys.has(key)) {
        return null;
      }
      const value = pending[key];
      delete pending[key];
      replacedKeys.add(key);
      return `${key}: ${this.yamlValue(value)}`;
    }).filter(line => line !== null);

    for (const [key, value] of Object.entries(pending)) {
      nextFrontmatter.push(`${key}: ${this.yamlValue(value)}`);
    }

    return ["---", ...nextFrontmatter, ...rest].join("\n");
  },

  renderAddedFrontmatter(content, updates) {
    const lines = ["---"];
    for (const [key, value] of Object.entries(updates)) {
      lines.push(`${key}: ${this.yamlValue(value)}`);
    }
    lines.push("---", "", String(content || ""));
    return lines.join("\n");
  },

  yamlValue(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    return PaperBridge.Util.yamlString(value);
  },

  frontmatterForItem(item, collection, options = {}) {
    const pdfAttachment = this.bestPDFAttachment(item);
    const collectionName = options.collectionName
      || collection?.name
      || PaperBridge.Index.get(item)?.primary_collection
      || PaperBridge.Constants.unfiledDirectoryName;
    const primaryCollectionName = options.primaryCollectionName || collectionName;
    const date = PaperBridge.Util.todayISO();
    const data = {
      title: item.getField("title") || "Untitled",
      citekey: this.citekeyForItem(item),
      zotero_key: item.key,
      collection: collectionName,
      primary_collection: primaryCollectionName,
      rank: Object.prototype.hasOwnProperty.call(options, "rank") ? options.rank : PaperBridge.Ranks.getRank(item),
      status: options.status || PaperBridge.Ranks.getStatus(item) || PaperBridge.Constants.statusUnread,
      doi: item.getField("DOI") || "",
      url: item.getField("url") || "",
      pdf: PaperBridge.Util.zoteroPDFURI(pdfAttachment),
      zotero: PaperBridge.Util.zoteroSelectURI(item),
      created: options.created || date,
      updated: date
    };
    return data;
  },

  frontmatterRepairUpdatesForItem(item, content, collection = null, overrides = {}) {
    const existingFields = this.parseFrontmatter(content) || {};
    const index = PaperBridge.Index.get(item) || {};
    const fallbackCollectionName = collection?.name
      || index.primary_collection
      || PaperBridge.Constants.unfiledDirectoryName;
    return this.frontmatterForItem(item, null, Object.assign({
      collectionName: existingFields.collection
        || existingFields.primary_collection
        || fallbackCollectionName,
      primaryCollectionName: existingFields.primary_collection
        || existingFields.collection
        || fallbackCollectionName,
      rank: Object.prototype.hasOwnProperty.call(existingFields, "rank")
        ? existingFields.rank
        : PaperBridge.Ranks.getRank(item),
      status: existingFields.status || PaperBridge.Constants.statusUnread,
      created: existingFields.created || PaperBridge.Util.todayISO()
    }, overrides));
  },

  hasValidFrontmatterAtPath(path, item) {
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      return false;
    }
    if (typeof Zotero.File?.getContents !== "function") {
      return true;
    }
    const cacheKey = this.frontmatterCacheKey(path, item);
    const modifiedTime = PaperBridge.Util.fileModifiedTimeSync(path);
    if (modifiedTime !== null) {
      const cached = this.frontmatterValidationCache.get(cacheKey);
      if (cached?.modifiedTime === modifiedTime) {
        return cached.ok;
      }
    }

    try {
      const ok = this.validateFrontmatterContent(Zotero.File.getContents(path), item).ok;
      if (modifiedTime !== null) {
        this.frontmatterValidationCache.set(cacheKey, { modifiedTime, ok });
      }
      return ok;
    }
    catch (error) {
      PaperBridge.Util.logError(error);
      return true;
    }
  },

  frontmatterCacheKey(path, item) {
    return [
      PaperBridge.Util.normalizePathForCompare(path),
      PaperBridge.Util.libraryIDForItem(item) || "",
      item?.key || ""
    ].join("|");
  },

  validateFrontmatterContent(content, item = null) {
    const fields = this.parseFrontmatter(content);
    if (!fields) {
      return {
        ok: false,
        missingKeys: [...PaperBridge.Constants.requiredFrontmatterKeys],
        mismatchedKeys: []
      };
    }

    const missingKeys = PaperBridge.Constants.requiredFrontmatterKeys.filter(key => !fields[key]);
    const mismatchedKeys = [];
    if (item?.key && fields.zotero_key && fields.zotero_key !== item.key) {
      mismatchedKeys.push("zotero_key");
    }
    const uriItemKey = PaperBridge.Util.itemKeyFromZoteroURI(fields.zotero);
    if (item?.key && uriItemKey && uriItemKey !== item.key) {
      mismatchedKeys.push("zotero");
    }
    const frontmatterLibraryID = PaperBridge.Util.libraryIDFromZoteroURI(fields.zotero);
    const itemLibraryID = PaperBridge.Util.libraryIDForItem(item);
    if (PaperBridge.Util.zoteroURIHasLibraryTarget(fields.zotero) && !frontmatterLibraryID && !mismatchedKeys.includes("zotero")) {
      mismatchedKeys.push("zotero");
    }
    if (frontmatterLibraryID && itemLibraryID && frontmatterLibraryID !== itemLibraryID && !mismatchedKeys.includes("zotero")) {
      mismatchedKeys.push("zotero");
    }
    return {
      ok: missingKeys.length === 0 && mismatchedKeys.length === 0,
      missingKeys,
      mismatchedKeys
    };
  },

  parseFrontmatter(content) {
    const lines = String(content || "").split(/\r?\n/);
    if (!this.isFrontmatterDelimiter(lines[0], true)) {
      return null;
    }
    const endIndex = lines.findIndex((line, index) => index > 0 && this.isFrontmatterDelimiter(line));
    if (endIndex < 0) {
      return null;
    }

    const fields = {};
    for (const line of lines.slice(1, endIndex)) {
      const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (!match) {
        continue;
      }
      fields[match[1]] = this.unquoteYamlScalar(match[2] || "");
    }
    return fields;
  },

  isFrontmatterDelimiter(line, allowBOM = false) {
    let value = String(line || "");
    if (allowBOM) {
      value = value.replace(/^\uFEFF/, "");
    }
    return value.trim() === "---";
  },

  unquoteYamlScalar(value) {
    const trimmed = String(value || "").trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    return trimmed;
  },

  pickPrimaryCollection(item) {
    const selected = PaperBridge.Util.getSelectedCollection();
    const collectionIDs = PaperBridge.Util.collectionIDsForItem(item);
    const selectedID = Number(selected?.id);
    if (selected && Number.isInteger(selectedID) && collectionIDs.includes(selectedID)) {
      return selected;
    }
    if (collectionIDs.length) {
      return Zotero.Collections.get(collectionIDs[0]);
    }
    return null;
  },

  resolveCollection(collection) {
    if (!collection) {
      return null;
    }
    if (typeof collection === "object") {
      return collection;
    }
    const collectionID = Number(collection);
    if (!Number.isFinite(collectionID)) {
      return null;
    }
    try {
      return Zotero.Collections.get(collectionID) || null;
    }
    catch (error) {
      PaperBridge.Util.logError(error);
      return null;
    }
  },

  directoryForCollection(collection) {
    const root = PaperBridge.Settings.markdownRoot();
    if (!root) {
      throw new Error("Markdown root directory is not configured.");
    }
    const collectionName = collection?.name || PaperBridge.Constants.unfiledDirectoryName;
    return PaperBridge.Util.pathJoin(root, PaperBridge.Util.sanitizePathSegment(collectionName));
  },

  async filenameForItem(item) {
    const template = PaperBridge.Settings.filenameTemplate();
    const data = {
      citekey: this.citekeyForItem(item),
      shortTitle: this.shortTitle(item),
      title: item.getField("title") || "Untitled"
    };

    let filename = template.replace(/{{\s*(citekey|shortTitle|title)\s*}}/g, (_, key) => data[key] || "");
    filename = PaperBridge.Util.sanitizePathSegment(filename, `${data.citekey}.md`);
    if (!filename.toLowerCase().endsWith(".md")) {
      filename += ".md";
    }
    return PaperBridge.Util.truncateFilename(filename, PaperBridge.Settings.maxFilenameLength());
  },

  async renderMarkdown(item, collection) {
    const frontmatter = this.frontmatterForItem(item, collection);

    const lines = [
      "---",
      `title: ${this.yamlValue(frontmatter.title)}`,
      `citekey: ${this.yamlValue(frontmatter.citekey)}`,
      `zotero_key: ${this.yamlValue(frontmatter.zotero_key)}`,
      `collection: ${this.yamlValue(frontmatter.collection)}`,
      `primary_collection: ${this.yamlValue(frontmatter.primary_collection)}`,
      `rank: ${this.yamlValue(frontmatter.rank)}`,
      `status: ${frontmatter.status}`,
      `doi: ${this.yamlValue(frontmatter.doi)}`,
      `url: ${this.yamlValue(frontmatter.url)}`,
      `pdf: ${this.yamlValue(frontmatter.pdf)}`,
      `zotero: ${this.yamlValue(frontmatter.zotero)}`,
      `created: ${this.yamlValue(frontmatter.created)}`,
      `updated: ${this.yamlValue(frontmatter.updated)}`,
      "---",
      "",
      "## 一句话总结",
      "",
      "## 研究问题",
      "",
      "## 核心方法",
      "",
      "## 关键结论",
      "",
      "## 可复用点",
      "",
      "## 局限性",
      "",
      "## 和我的研究的关系",
      "",
      "## 后续引用价值",
      ""
    ];
    return lines.join("\n");
  },

  bestPDFAttachment(item) {
    if (!item || typeof item.getAttachments !== "function") {
      return null;
    }
    for (const attachmentID of item.getAttachments()) {
      const attachment = Zotero.Items.get(attachmentID);
      const contentType = attachment?.attachmentContentType || "";
      const path = this.getAttachmentPath(attachment);
      if (contentType === "application/pdf" || path.toLowerCase().endsWith(".pdf")) {
        return attachment;
      }
    }
    return null;
  },

  citekeyForItem(item) {
    if (PaperBridge.Settings.useBetterBibTeXCitekey()) {
      const fromNativeField = this.citekeyFromNativeField(item);
      if (fromNativeField) {
        return fromNativeField;
      }

      const fromBetterBibTeX = this.citekeyFromBetterBibTeX(item);
      if (fromBetterBibTeX) {
        return fromBetterBibTeX;
      }
    }

    const extra = item.getField("extra") || "";
    const pinned = extra.match(/^Citation Key:\s*(.+)$/mi);
    if (pinned?.[1]) {
      return this.normalizeCitekey(pinned[1]) || "citekey";
    }

    return this.fallbackCitekey(item);
  },

  citekeyFromNativeField(item) {
    for (const field of ["citationKey", "citekey"]) {
      try {
        const key = this.extractCitekeyValue(item.getField?.(field));
        if (key) {
          return key;
        }
      }
      catch (error) {
        // Older Zotero versions can throw for fields they do not know.
      }
    }
    return this.extractCitekeyValue(item.citationKey || item.citekey);
  },

  citekeyFromBetterBibTeX(item) {
    try {
      if (Zotero.BetterBibTeX?.KeyManager?.get) {
        const key = this.extractCitekeyValue(Zotero.BetterBibTeX.KeyManager.get(item.id));
        if (key) {
          return key;
        }
      }
      if (Zotero.BetterBibTeX?.getCitationKey) {
        const key = this.extractCitekeyValue(Zotero.BetterBibTeX.getCitationKey(item.id));
        if (key) {
          return key;
        }
      }
    }
    catch (error) {
      PaperBridge.Util.logError(error);
    }
    return "";
  },

  extractCitekeyValue(value) {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "object") {
      for (const key of ["citationKey", "citationkey", "citekey", "key"]) {
        const extracted = this.extractCitekeyValue(value[key]);
        if (extracted) {
          return extracted;
        }
      }
    }
    return "";
  },

  fallbackCitekey(item) {
    const title = item.getField("title") || "paper";
    const data = {
      firstCreator: this.citekeySegment(item.firstCreator || "unknown"),
      year: this.yearForItem(item) || "nd",
      firstTitleWord: this.citekeySegment(this.firstTitleWord(title) || "paper"),
      shortTitle: this.citekeySegment(this.shortTitle(item)),
      title: this.citekeySegment(title),
      itemKey: this.citekeySegment(item.key || item.id || "")
    };
    const template = PaperBridge.Settings.fallbackCitekeyPattern();
    const raw = template.replace(/{{\s*(firstCreator|year|firstTitleWord|shortTitle|title|itemKey)\s*}}/g, (_, key) => data[key] || "");
    return this.normalizeCitekey(raw) || `item_${item.key || item.id || PaperBridge.Util.todayISO().replace(/-/g, "")}`;
  },

  firstTitleWord(title) {
    return PaperBridge.Util.sanitizePathSegment(title || "paper", "paper").split(/\s+/)[0] || "paper";
  },

  citekeySegment(value) {
    return this.normalizeCitekey(value).toLowerCase();
  },

  normalizeCitekey(value) {
    return PaperBridge.Util.sanitizePathSegment(value || "", "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_\-]/gi, "")
      .replace(/_+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "");
  },

  yearForItem(item) {
    const date = item.getField("date") || "";
    const match = String(date).match(/(18|19|20)\d{2}/);
    return match ? match[0] : "";
  },

  shortTitle(item) {
    const title = item.getField("title") || "Untitled";
    const clean = PaperBridge.Util.sanitizePathSegment(title, "Untitled");
    return clean.length > 90 ? clean.slice(0, 90).trim() : clean;
  }
};
