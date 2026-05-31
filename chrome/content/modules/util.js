PaperBridge = PaperBridge || {};

PaperBridge.Util = {
  log(message) {
    Zotero.debug(`PaperBridge: ${message}`);
  },

  logError(error) {
    Zotero.logError(error);
  },

  safeLogError(error) {
    try {
      this.logError(error);
    }
    catch (logError) {
      try {
        Zotero.debug(`PaperBridge: Could not log error: ${logError.message}`);
      }
      catch (debugError) {
      }
    }
  },

  alert(message, title = "PaperBridge") {
    Services.prompt.alert(null, title, message);
  },

  confirm(message, title = "PaperBridge") {
    return Services.prompt.confirm(null, title, message);
  },

  todayISO() {
    return new Date().toISOString().slice(0, 10);
  },

  pathJoin(...segments) {
    const clean = segments.filter(segment => segment !== undefined && segment !== null && String(segment).length);
    return PathUtils.join(...clean.map(segment => String(segment)));
  },

  normalizePathForCompare(path) {
    return String(path || "").replace(/\//g, "\\").toLowerCase();
  },

  pathsEqual(left, right) {
    return this.normalizePathForCompare(left) === this.normalizePathForCompare(right);
  },

  pathBasename(path) {
    const parts = String(path || "").split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  },

  pathParent(path) {
    if (PathUtils.parent) {
      return PathUtils.parent(path);
    }
    const value = String(path || "");
    const index = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
    return index > 0 ? value.slice(0, index) : "";
  },

  sanitizePathSegment(value, fallback = "Untitled") {
    const sanitized = this.cleanPathSegment(value);
    if (sanitized) {
      return this.avoidWindowsReservedName(sanitized);
    }
    const cleanFallback = this.cleanPathSegment(fallback);
    return cleanFallback ? this.avoidWindowsReservedName(cleanFallback) : "";
  },

  cleanPathSegment(value) {
    return String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");
  },

  avoidWindowsReservedName(name) {
    const value = String(name || "");
    const dotIndex = value.indexOf(".");
    const stem = dotIndex >= 0 ? value.slice(0, dotIndex) : value;
    const suffix = dotIndex >= 0 ? value.slice(dotIndex) : "";
    return this.isWindowsReservedDeviceName(stem)
      ? `${stem}_${suffix}`
      : value;
  },

  isWindowsReservedDeviceName(name) {
    return /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i.test(String(name || ""));
  },

  truncateFilename(filename, maxLength) {
    if (!maxLength || filename.length <= maxLength) {
      return this.avoidWindowsReservedName(filename);
    }
    const extIndex = filename.lastIndexOf(".");
    const ext = extIndex > 0 ? filename.slice(extIndex) : "";
    const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename;
    const room = Math.max(24, maxLength - ext.length);
    return this.avoidWindowsReservedName(`${stem.slice(0, room).trim()}${ext}`);
  },

  yamlString(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    return `"${String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, " ")}"`;
  },

  pathExistsSync(path) {
    if (!path) {
      return false;
    }
    try {
      return Zotero.File.pathToFile(path).exists();
    }
    catch (error) {
      return false;
    }
  },

  fileModifiedTimeSync(path) {
    if (!path) {
      return null;
    }
    try {
      const file = Zotero.File.pathToFile(path);
      return file.exists() ? file.lastModifiedTime : null;
    }
    catch (error) {
      return null;
    }
  },

  async ensureDirectory(path) {
    await IOUtils.makeDirectory(path, { createAncestors: true, ignoreExisting: true });
  },

  async uniquePath(directory, filename, maxFilenameLength = null) {
    const limit = this.effectiveMaxFilenameLength(maxFilenameLength);
    const baseFilename = limit ? this.truncateFilename(filename, limit) : this.avoidWindowsReservedName(filename);
    let candidate = this.pathJoin(directory, baseFilename);
    if (!(await IOUtils.exists(candidate))) {
      return candidate;
    }

    const dot = baseFilename.lastIndexOf(".");
    const stem = dot > 0 ? baseFilename.slice(0, dot) : baseFilename;
    const ext = dot > 0 ? baseFilename.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
      const candidateFilename = this.filenameWithNumericSuffix(stem, ext, i, limit);
      candidate = this.pathJoin(directory, candidateFilename);
      if (!(await IOUtils.exists(candidate))) {
        return candidate;
      }
    }
    throw new Error(`Cannot find an available filename for ${baseFilename}`);
  },

  effectiveMaxFilenameLength(maxFilenameLength = null) {
    const explicit = Number(maxFilenameLength);
    if (Number.isFinite(explicit) && explicit > 0) {
      return explicit;
    }
    try {
      return PaperBridge.Settings?.maxFilenameLength?.() || 0;
    }
    catch (error) {
      return 0;
    }
  },

  filenameWithNumericSuffix(stem, ext, number, maxFilenameLength = 0) {
    const suffix = ` (${number})`;
    if (!maxFilenameLength) {
      return this.avoidWindowsReservedName(`${stem}${suffix}${ext}`);
    }

    const room = Math.max(1, maxFilenameLength - ext.length - suffix.length);
    let shortenedStem = String(stem || "").slice(0, room).trim();
    if (!shortenedStem) {
      shortenedStem = String(stem || "file").slice(0, room) || "file";
    }
    return this.avoidWindowsReservedName(`${shortenedStem}${suffix}${ext}`);
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  randomToken() {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    }
    return Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
  },

  isValidLibraryID(libraryID) {
    const value = Number(libraryID);
    return Number.isInteger(value) && value > 0;
  },

  libraryIDForItem(item) {
    const rawLibraryID = item?.libraryID !== undefined && item?.libraryID !== null && item?.libraryID !== ""
      ? item.libraryID
      : Zotero.Libraries?.userLibraryID;
    const libraryID = Number(rawLibraryID || 0);
    return this.isValidLibraryID(libraryID) ? libraryID : null;
  },

  zoteroURIHasLibraryTarget(uri) {
    return /zotero:\/\/(?:select|open-pdf)\/(?:library|groups\/\d+)\/items\//.test(String(uri || ""));
  },

  libraryIDFromZoteroURI(uri) {
    const value = String(uri || "");
    if (/zotero:\/\/(?:select|open-pdf)\/library\/items\//.test(value)) {
      return this.libraryIDForItem({ libraryID: Zotero.Libraries?.userLibraryID });
    }

    const groupMatch = value.match(/zotero:\/\/(?:select|open-pdf)\/groups\/(\d+)\/items\//);
    if (groupMatch && typeof Zotero.Groups?.get === "function") {
      const group = Zotero.Groups.get(Number(groupMatch[1]));
      return this.isValidLibraryID(group?.libraryID) ? Number(group.libraryID) : null;
    }
    return null;
  },

  itemKeyFromZoteroURI(uri) {
    const match = String(uri || "").match(/zotero:\/\/(?:select|open-pdf)\/(?:library|groups\/\d+)\/items\/([^?/#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  },

  libraryURIPath(item) {
    const libraryID = this.libraryIDForItem(item);
    if (libraryID === this.libraryIDForItem({ libraryID: Zotero.Libraries?.userLibraryID })) {
      return "library";
    }
    const groupID = this.groupIDForLibraryID(libraryID, item);
    if (groupID) {
      return `groups/${groupID}`;
    }
    return "library";
  },

  groupIDForLibraryID(libraryID, item = null) {
    if (!this.isValidLibraryID(libraryID)) {
      return null;
    }

    if (this.isValidLibraryID(item?.groupID)) {
      return Number(item.groupID);
    }

    try {
      const library = Zotero.Libraries?.get?.(libraryID);
      if (library?.libraryType === "group" && this.isValidLibraryID(library.groupID)) {
        return Number(library.groupID);
      }
    }
    catch (error) {}

    try {
      const group = Zotero.Groups?.getByLibraryID?.(libraryID);
      if (this.isValidLibraryID(group?.groupID)) {
        return Number(group.groupID);
      }
    }
    catch (error) {}

    if (typeof Zotero.Groups?.getAll === "function") {
      try {
        for (const group of Zotero.Groups.getAll()) {
          if (Number(group?.libraryID) === Number(libraryID) && this.isValidLibraryID(group.groupID)) {
            return Number(group.groupID);
          }
        }
      }
      catch (error) {}
    }
    return null;
  },

  zoteroSelectURI(item) {
    return `zotero://select/${this.libraryURIPath(item)}/items/${item.key}`;
  },

  zoteroPDFURI(attachment) {
    if (!attachment) {
      return "";
    }
    return `zotero://open-pdf/${this.libraryURIPath(attachment)}/items/${attachment.key}`;
  },

  getActivePane() {
    try {
      return Zotero.getActiveZoteroPane?.() || null;
    }
    catch (error) {
      return null;
    }
  },

  getSelectedRegularItems() {
    const pane = this.getActivePane();
    const selected = pane?.getSelectedItems?.() || [];
    return selected.filter(item => item && PaperBridge.Notes.isRegularItem(item));
  },

  getSelectedCollection() {
    try {
      return this.getActivePane()?.getSelectedCollection?.() || null;
    }
    catch (error) {
      return null;
    }
  },

  collectionIDsForItem(item) {
    const collectionIDs = typeof item?.getCollections === "function" ? item.getCollections() : [];
    return (collectionIDs || [])
      .map(collectionID => Number(collectionID))
      .filter(collectionID => Number.isInteger(collectionID) && collectionID > 0);
  },

  getSelectedLibraryID() {
    try {
      const pane = this.getActivePane();
      const libraryID = Number(pane?.getSelectedLibraryID?.());
      return this.isValidLibraryID(libraryID) ? libraryID : null;
    }
    catch (error) {
      return null;
    }
  },

  async pickMarkdownFile(title = "Select Markdown Reading Note") {
    const window = this.getActivePane()?.document?.defaultView || Zotero.getMainWindows?.()[0] || null;
    if (!window) {
      throw new Error("No Zotero window is available for the file picker.");
    }
    const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    const picker = new FilePicker();
    picker.init(window, title, picker.modeOpen);
    picker.appendFilter("Markdown files", "*.md");
    picker.appendFilters(picker.filterAll);
    const result = await picker.show();
    return result === picker.returnOK ? picker.file : "";
  },

  refreshItemTreeColumns() {
    try {
      Zotero.ItemTreeManager?.refreshColumns?.();
    }
    catch (error) {
      this.logError(error);
    }
  },

  runProcess(executablePath, args, blocking = true) {
    const file = Zotero.File.pathToFile(executablePath);
    const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    process.init(file);
    process.run(blocking, args, args.length);
  }
};
