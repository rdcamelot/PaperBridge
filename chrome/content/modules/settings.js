PaperBridge = PaperBridge || {};

PaperBridge.Settings = {
  key(name) {
    return PaperBridge.Constants.prefBranch + name;
  },

  get(name, fallback = undefined) {
    const value = Zotero.Prefs.get(this.key(name), true);
    return value === undefined || value === null ? fallback : value;
  },

  getString(name, fallback = "") {
    const value = this.get(name, fallback);
    return typeof value === "string" ? value : String(value ?? fallback);
  },

  getBool(name, fallback = false) {
    const value = this.get(name, fallback);
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off", ""].includes(normalized)) {
        return false;
      }
    }
    return Boolean(fallback);
  },

  getInt(name, fallback = 0) {
    const value = Number.parseInt(this.get(name, fallback), 10);
    return Number.isFinite(value) ? value : fallback;
  },

  listPref(name) {
    return this.getString(name, "")
      .split(/[\r\n,;\uFF0C\uFF1B]+/)
      .map(value => value.trim())
      .filter(Boolean);
  },

  collectionListPref(name) {
    return this.listPref(name);
  },

  normalizeCollectionName(name) {
    return String(name || "").trim().toLowerCase();
  },

  collectionNameMatches(name, list) {
    const normalized = this.normalizeCollectionName(name);
    return Boolean(normalized) && list.some(value => this.normalizeCollectionName(value) === normalized);
  },

  set(name, value) {
    Zotero.Prefs.set(this.key(name), value, true);
  },

  markdownRoot() {
    return this.getString("markdownRoot", "D:\\\u5b66\\\u8bba\u6587").trim();
  },

  editorPath() {
    return this.getString("markdownEditorPath", "").trim();
  },

  filenameTemplate() {
    return this.getString("filenameTemplate", "{{citekey}} - {{shortTitle}}.md");
  },

  useBetterBibTeXCitekey() {
    return this.getBool("useBetterBibTeXCitekey", true);
  },

  fallbackCitekeyPattern() {
    return this.getString("fallbackCitekeyPattern", "{{firstCreator}}{{year}}_{{firstTitleWord}}").trim()
      || "{{firstCreator}}{{year}}_{{firstTitleWord}}";
  },

  autoCreateOnlyCollections() {
    return this.collectionListPref("autoCreateOnlyCollections");
  },

  autoCreateNotifications() {
    return this.getBool("autoCreateNotifications", true);
  },

  autoCreateDelayMS() {
    const seconds = this.getInt("autoCreateDelaySeconds", 8);
    return Math.min(60, Math.max(3, seconds)) * 1000;
  },

  autoCreateItemTypes() {
    return this.listPref("autoCreateItemTypes").map(value => this.normalizeItemTypeName(value));
  },

  normalizeItemTypeName(name) {
    return String(name || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  },

  itemTypeNameMatches(name, list) {
    const normalized = this.normalizeItemTypeName(name);
    return Boolean(normalized) && list.some(value => this.normalizeItemTypeName(value) === normalized);
  },

  deleteMarkdownWithZoteroItem() {
    return this.getBool("deleteMarkdownWithZoteroItem", true);
  },

  externalFileMonitorEnabled() {
    return this.getBool("externalFileMonitor", true);
  },

  externalFileRefreshIntervalMS() {
    const seconds = this.getInt("externalFileRefreshIntervalSeconds", 30);
    return Math.min(300, Math.max(10, seconds)) * 1000;
  },

  ignoreCollections() {
    return this.collectionListPref("ignoreCollections");
  },

  maxFilenameLength() {
    const length = this.getInt("maxFilenameLength", 180);
    return Math.min(240, Math.max(80, length));
  },

  rankTagPrefix() {
    return this.safeTagPrefix("rankTagPrefix", "paperbridge/rank/");
  },

  statusTagPrefix() {
    const prefix = this.safeTagPrefix("statusTagPrefix", "paperbridge/status/");
    if (prefix !== this.rankTagPrefix()) {
      return prefix;
    }
    return this.rankTagPrefix() === "paperbridge/status/"
      ? "paperbridge/state/"
      : "paperbridge/status/";
  },

  safeTagPrefix(name, fallback) {
    const prefix = this.getString(name, fallback).trim();
    return prefix ? prefix : fallback;
  },

  noteAttachmentTitle() {
    return this.getString("noteAttachmentTitle", PaperBridge.Constants.noteAttachmentTitle);
  },

  closeToTray() {
    return this.getBool("closeToTray", Boolean(Zotero.isWin || Services.appinfo?.OS === "WINNT"));
  },

  trayAutoHideOnStartup() {
    return this.getBool("trayAutoHideOnStartup", false);
  },

  trayPort() {
    const port = this.getInt("trayPort", 23128);
    return port >= 1024 && port < 65536 ? port : 23128;
  },

  trayToken() {
    let token = this.getString("trayToken", "").trim();
    if (!token) {
      token = PaperBridge.Util.randomToken();
      this.set("trayToken", token);
    }
    return token;
  }
};
