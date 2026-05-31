PaperBridge = PaperBridge || {};

PaperBridge.Tray = {
  handlers: new Map(),
  helperStarted: false,
  helperWarmupTimer: null,
  helperWarmupPromise: null,
  autoHidden: false,
  allowQuit: false,
  closeHidePromise: null,
  quitObserver: null,
  quitObserverTopics: ["quit-application-requested"],
  commandTimeoutMS: 1000,
  quickPingTimeoutMS: 250,
  helperWarmupDelayMS: 1500,

  start() {
    this.allowQuit = false;
    this.registerQuitObserver();
    this.scheduleHelperWarmup();
  },

  addToWindow(window) {
    if (this.handlers.has(window)) {
      return;
    }

    const state = {
      closeHandler: event => this.onClose(event, window),
      beforeUnloadHandler: event => this.onBeforeUnload(event, window),
      originalClose: null,
      originalGoQuitApplication: null
    };
    window.addEventListener("close", state.closeHandler, true);
    window.addEventListener("beforeunload", state.beforeUnloadHandler, true);
    this.hookWindowCloseMethods(window, state);
    this.handlers.set(window, state);
    this.scheduleHelperWarmup();

    if (this.shouldUseTray() && PaperBridge.Settings.trayAutoHideOnStartup() && !this.autoHidden) {
      this.autoHidden = true;
      setTimeout(() => this.hideWindow(window).catch(error => PaperBridge.Util.logError(error)), 1200);
    }
  },

  removeFromWindow(window) {
    const state = this.handlers.get(window);
    if (!state) {
      return;
    }
    window.removeEventListener("close", state.closeHandler, true);
    window.removeEventListener("beforeunload", state.beforeUnloadHandler, true);
    this.restoreWindowCloseMethods(window, state);
    this.handlers.delete(window);
  },

  removeFromAllWindows() {
    for (const [window, state] of this.handlers.entries()) {
      window.removeEventListener("close", state.closeHandler, true);
      window.removeEventListener("beforeunload", state.beforeUnloadHandler, true);
      this.restoreWindowCloseMethods(window, state);
    }
    this.handlers.clear();
  },

  async stop() {
    this.unregisterQuitObserver();
    this.removeFromAllWindows();
    this.cancelHelperWarmup();
    if (this.helperWarmupPromise) {
      await this.helperWarmupPromise.catch(() => {});
    }
    if (this.helperStarted) {
      await this.sendCommand("quit-helper", 1).catch(() => {});
    }
    this.helperStarted = false;
    this.allowQuit = false;
    this.deleteQuitRequestFile();
  },

  scheduleHelperWarmup(delayMS = this.helperWarmupDelayMS) {
    if (this.helperWarmupTimer || this.helperWarmupPromise || this.helperStarted || !this.shouldUseTray()) {
      return;
    }
    this.helperWarmupTimer = setTimeout(() => {
      this.helperWarmupTimer = null;
      this.warmHelper();
    }, delayMS);
  },

  cancelHelperWarmup() {
    if (this.helperWarmupTimer) {
      clearTimeout(this.helperWarmupTimer);
      this.helperWarmupTimer = null;
    }
  },

  warmHelper() {
    if (this.helperWarmupPromise || this.helperStarted || !this.shouldUseTray()) {
      return this.helperWarmupPromise || Promise.resolve();
    }
    this.helperWarmupPromise = this.startOrConnectHelper()
      .catch(error => {
        PaperBridge.Util.safeLogError(error);
      })
      .finally(() => {
        this.helperWarmupPromise = null;
      });
    return this.helperWarmupPromise;
  },

  registerQuitObserver() {
    if (this.quitObserver || !Services.obs?.addObserver) {
      return;
    }

    this.quitObserver = {
      observe: (subject, topic, data) => {
        if (topic !== "quit-application-requested") {
          return;
        }
        if (this.consumeExternalQuitRequest()) {
          this.allowQuit = true;
          return;
        }
        if (this.allowQuit || !this.shouldUseTray() || this.isSystemQuit(data)) {
          this.allowQuit = true;
          return;
        }
        this.cancelQuit(subject);
        this.hideActiveWindow().catch(error => {
          PaperBridge.Util.logError(error);
          PaperBridge.Util.alert(error.message);
        });
      }
    };
    for (const topic of this.quitObserverTopics) {
      Services.obs.addObserver(this.quitObserver, topic);
    }
  },

  unregisterQuitObserver() {
    if (!this.quitObserver || !Services.obs?.removeObserver) {
      this.quitObserver = null;
      return;
    }

    for (const topic of this.quitObserverTopics) {
      try {
        Services.obs.removeObserver(this.quitObserver, topic);
      }
      catch (error) {
        PaperBridge.Util.safeLogError(error);
      }
    }
    this.quitObserver = null;
  },

  shouldUseTray() {
    return Boolean(this.isWindows() && PaperBridge.Settings.closeToTray());
  },

  isWindows() {
    return Boolean(Zotero.isWin || Services.appinfo?.OS === "WINNT");
  },

  isSystemQuit(reason) {
    return ["restart", "os-restart", "os-shutdown"].includes(String(reason || ""));
  },

  cancelQuit(subject) {
    if (!subject) {
      return;
    }
    try {
      subject.QueryInterface?.(Ci.nsISupportsPRBool);
    }
    catch (error) {
    }
    try {
      subject.data = true;
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
    }
  },

  onClose(event, window) {
    this.interceptWindowClose(event, window);
  },

  onBeforeUnload(event, window) {
    return this.interceptWindowClose(event, window) ? false : undefined;
  },

  interceptWindowClose(event, window) {
    if (this.allowQuit || this.consumeExternalQuitRequest()) {
      this.allowQuit = true;
      return false;
    }
    if (!this.shouldUseTray()) {
      return false;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    if (event) {
      event.returnValue = false;
    }
    this.scheduleHide(window);
    return true;
  },

  scheduleHide(window) {
    if (this.closeHidePromise) {
      return this.closeHidePromise;
    }
    this.closeHidePromise = this.hideWindow(window)
      .catch(error => {
        PaperBridge.Util.logError(error);
        PaperBridge.Util.alert(error.message);
      })
      .finally(() => {
        this.closeHidePromise = null;
      });
    return this.closeHidePromise;
  },

  hookWindowCloseMethods(window, state) {
    if (typeof window.close === "function") {
      state.originalClose = window.close;
      window.close = (...args) => {
        if (this.interceptWindowClose(null, window)) {
          return undefined;
        }
        return state.originalClose.apply(window, args);
      };
    }
    if (typeof window.goQuitApplication === "function") {
      state.originalGoQuitApplication = window.goQuitApplication;
      window.goQuitApplication = (...args) => {
        if (this.interceptWindowClose(null, window)) {
          return false;
        }
        return state.originalGoQuitApplication.apply(window, args);
      };
    }
  },

  restoreWindowCloseMethods(window, state) {
    if (state.originalClose) {
      window.close = state.originalClose;
    }
    if (state.originalGoQuitApplication) {
      window.goQuitApplication = state.originalGoQuitApplication;
    }
  },

  consumeExternalQuitRequest() {
    const path = this.quitRequestPath();
    if (!path || !PaperBridge.Util.pathExistsSync(path)) {
      return false;
    }

    try {
      const file = Zotero.File.pathToFile(path);
      const modifiedTime = Number(file.lastModifiedTime || 0);
      if (modifiedTime > 1000000000000 && Date.now() - modifiedTime > 30000) {
        this.deleteQuitRequestFile(path);
        return false;
      }

      const token = String(Zotero.File.getContents(path) || "").trim();
      const expected = PaperBridge.Settings.trayToken();
      this.deleteQuitRequestFile(path);
      return Boolean(token && expected && token === expected);
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
      this.deleteQuitRequestFile(path);
      return false;
    }
  },

  deleteQuitRequestFile(path = this.quitRequestPath()) {
    if (!path) {
      return;
    }
    try {
      const file = Zotero.File.pathToFile(path);
      if (file.exists()) {
        file.remove(false);
      }
    }
    catch (error) {
      PaperBridge.Util.safeLogError(error);
    }
  },

  async hideActiveWindow() {
    const window = Zotero.getActiveZoteroPane?.()?.document?.defaultView || Zotero.getMainWindows?.()[0];
    if (!window) {
      return;
    }
    await this.hideWindow(window);
  },

  async hideWindow(window) {
    if (!this.shouldUseTray()) {
      window.minimize?.();
      return;
    }

    try {
      await this.ensureHelperRunning();
      const ok = await this.sendCommand("hide", 5);
      if (ok) {
        return;
      }
    }
    catch (error) {
      PaperBridge.Util.logError(error);
    }

    throw new Error("Could not hide Zotero through the PaperBridge tray helper. Zotero was left visible.");
  },

  async showWindow() {
    if (!this.shouldUseTray()) {
      return;
    }
    await this.ensureHelperRunning();
    await this.sendCommand("show", 3);
  },

  async quitZotero(window) {
    this.allowQuit = true;
    await this.stop();
    if (window?.goQuitApplication) {
      window.goQuitApplication();
      return;
    }
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  },

  async ensureHelperRunning() {
    if (this.helperWarmupPromise) {
      await this.helperWarmupPromise.catch(() => {});
    }
    await this.startOrConnectHelper();
  },

  async startOrConnectHelper() {
    if (await this.sendCommand("ping", 1, this.quickPingTimeoutMS)) {
      this.helperStarted = true;
      return;
    }

    const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    if (!PaperBridge.Util.pathExistsSync(powershell)) {
      throw new Error("PowerShell was not found; cannot start the PaperBridge tray helper.");
    }

    const scriptPath = await this.ensureHelperScript();
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      scriptPath,
      "-Port",
      String(PaperBridge.Settings.trayPort()),
      "-Token",
      PaperBridge.Settings.trayToken(),
      "-ZoteroPid",
      String(this.processID()),
      "-ZoteroExe",
      this.executablePath(),
      "-QuitRequestPath",
      this.quitRequestPath()
    ];
    PaperBridge.Util.runProcess(powershell, args, false);
    this.helperStarted = true;
    if (!(await this.sendCommand("ping", 8, this.commandTimeoutMS))) {
      this.helperStarted = false;
      throw new Error(`The PaperBridge tray helper did not start on port ${PaperBridge.Settings.trayPort()}. The port may already be in use.`);
    }
  },

  async ensureHelperScript() {
    const tempDir = Services.dirsvc.get("TmpD", Ci.nsIFile).path;
    const scriptPath = PaperBridge.Util.pathJoin(tempDir, "paperbridge-tray-helper.ps1");
    const response = await this.fetchWithTimeout(PaperBridge.rootURI + "chrome/content/tray-helper.ps1", {}, 3000);
    if (!response.ok) {
      throw new Error(`Could not load tray helper script: ${response.status}`);
    }
    await Zotero.File.putContentsAsync(scriptPath, await response.text());
    return scriptPath;
  },

  async sendCommand(command, attempts = 3, timeoutMS = this.commandTimeoutMS) {
    const token = encodeURIComponent(PaperBridge.Settings.trayToken());
    const url = `http://127.0.0.1:${PaperBridge.Settings.trayPort()}/${encodeURIComponent(command)}?token=${token}`;
    for (let i = 0; i < attempts; i++) {
      try {
        const response = await this.fetchWithTimeout(url, { cache: "no-store" }, timeoutMS);
        const body = await response.text();
        if (response.ok && body.trim() === "PaperBridge:OK") {
          return true;
        }
      }
      catch (error) {
        if (i === attempts - 1) {
          return false;
        }
      }
      await PaperBridge.Util.sleep(250);
    }
    return false;
  },

  async fetchWithTimeout(url, options = {}, timeoutMS = 1000) {
    if (typeof AbortController === "undefined") {
      return fetch(url, options);
    }

    const controller = new AbortController();
    const timeoutID = setTimeout(() => controller.abort(), timeoutMS);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    }
    finally {
      clearTimeout(timeoutID);
    }
  },

  processID() {
    return Number(Services.appinfo?.processID || 0);
  },

  executablePath() {
    try {
      return Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
    }
    catch (error) {
      return "";
    }
  },

  quitRequestPath() {
    try {
      const tempDir = Services.dirsvc.get("TmpD", Ci.nsIFile).path;
      return PaperBridge.Util.pathJoin(tempDir, `paperbridge-quit-${this.processID() || "zotero"}.txt`);
    }
    catch (error) {
      return "";
    }
  }
};
