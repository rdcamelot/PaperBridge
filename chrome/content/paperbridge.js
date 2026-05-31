PaperBridge = Object.assign(PaperBridge || {}, {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,

  init({ id, version, rootURI }) {
    if (this.initialized) {
      return;
    }
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.initialized = true;
  },

  async start() {
    await this.startFeature("tray observer", () => this.Tray.start());
    await this.startFeature("item tree columns", () => this.Columns.register());
    await this.startFeature("item pane", () => this.ItemPane.register());
    await this.startFeature("notifications", () => this.Notifications.start());
  },

  async afterWindowsReady() {
    await this.startFeature("Tools menu", () => this.Menus.register());
  },

  async stop() {
    await this.runCleanupStep("notifications", () => this.Notifications.stop());
    await this.runCleanupStep("tray", () => this.Tray.stop());
    await this.runCleanupStep("menus unregister", () => this.Menus.unregister());
    await this.runCleanupStep("menus remove", () => this.Menus.removeFromAllWindows());
    await this.runCleanupStep("shortcuts", () => this.Shortcuts.removeFromAllWindows());
    await this.runCleanupStep("window UI", () => this.UI.removeFromAllWindows());
    await this.runCleanupStep("item pane", () => this.ItemPane.unregister());
    await this.runCleanupStep("columns", () => this.Columns.unregister());
  },

  async runCleanupStep(name, callback) {
    try {
      await callback();
    }
    catch (error) {
      this.Util.safeLogError(new Error(`Cleanup failed during ${name}: ${error.message || error}`));
    }
  },

  async startFeature(name, callback) {
    try {
      return await callback();
    }
    catch (error) {
      this.logFeatureError(name, error);
      return null;
    }
  },

  runWindowFeature(name, callback) {
    try {
      return callback();
    }
    catch (error) {
      this.logFeatureError(name, error);
      return null;
    }
  },

  logFeatureError(name, error) {
    const message = error?.message || error;
    this.Util.safeLogError(new Error(`PaperBridge ${name} failed: ${message}`));
  },

  addToWindow(window) {
    if (!window?.ZoteroPane) {
      return;
    }
    this.runWindowFeature("window UI", () => this.UI.addToWindow(window));
    this.runWindowFeature("tray window hook", () => this.Tray.addToWindow(window));
    this.runWindowFeature("window menu", () => this.Menus.addToWindow(window));
    this.runWindowFeature("shortcuts", () => this.Shortcuts.addToWindow(window));
  },

  addToAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      this.addToWindow(window);
    }
  },

  removeFromWindow(window) {
    this.runWindowFeature("shortcuts cleanup", () => this.Shortcuts.removeFromWindow(window));
    this.runWindowFeature("window menu cleanup", () => this.Menus.removeFromWindow(window));
    this.runWindowFeature("tray window cleanup", () => this.Tray.removeFromWindow(window));
    this.runWindowFeature("window UI cleanup", () => this.UI.removeFromWindow(window));
  },

  removeFromAllWindows() {
    for (const window of Zotero.getMainWindows()) {
      this.removeFromWindow(window);
    }
  }
});
