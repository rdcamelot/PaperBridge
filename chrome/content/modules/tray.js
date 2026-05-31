PaperBridge = PaperBridge || {};

PaperBridge.Tray = {
  handlers: new Map(),
  helperStarted: false,
  autoHidden: false,
  allowQuit: false,
  quitObserver: null,
  quitObserverTopics: ["quit-application-granted", "quit-application"],
  commandTimeoutMS: 1000,

  start() {
    this.allowQuit = false;
    this.registerQuitObserver();
  },

  addToWindow(window) {
    if (this.handlers.has(window)) {
      return;
    }

    const closeHandler = event => this.onClose(event, window);
    window.addEventListener("close", closeHandler, true);
    this.handlers.set(window, closeHandler);

    if (this.shouldUseTray() && PaperBridge.Settings.trayAutoHideOnStartup() && !this.autoHidden) {
      this.autoHidden = true;
      setTimeout(() => this.hideWindow(window).catch(error => PaperBridge.Util.logError(error)), 1200);
    }
  },

  removeFromWindow(window) {
    const handler = this.handlers.get(window);
    if (!handler) {
      return;
    }
    window.removeEventListener("close", handler, true);
    this.handlers.delete(window);
  },

  removeFromAllWindows() {
    for (const [window, handler] of this.handlers.entries()) {
      window.removeEventListener("close", handler, true);
    }
    this.handlers.clear();
  },

  async stop() {
    this.unregisterQuitObserver();
    this.removeFromAllWindows();
    if (this.helperStarted) {
      await this.sendCommand("quit-helper", 1).catch(() => {});
    }
    this.helperStarted = false;
    this.allowQuit = false;
  },

  registerQuitObserver() {
    if (this.quitObserver || !Services.obs?.addObserver) {
      return;
    }

    this.quitObserver = {
      observe: (_subject, topic) => {
        if (this.quitObserverTopics.includes(topic)) {
          this.allowQuit = true;
        }
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
    return Boolean(Zotero.isWin && PaperBridge.Settings.closeToTray());
  },

  onClose(event, window) {
    if (this.allowQuit || !this.shouldUseTray()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.hideWindow(window).catch(error => {
      PaperBridge.Util.logError(error);
      PaperBridge.Util.alert(error.message);
    });
  },

  async hideActiveWindow() {
    const window = Zotero.getActiveZoteroPane?.()?.document?.defaultView || Zotero.getMainWindows()[0];
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

    if (window?.minimize) {
      window.minimize?.();
    }
    throw new Error("Could not contact the PaperBridge tray helper. Zotero was minimized to the taskbar instead.");
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
    if (await this.sendCommand("ping", 1)) {
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
      this.executablePath()
    ];
    PaperBridge.Util.runProcess(powershell, args, false);
    this.helperStarted = true;
    if (!(await this.sendCommand("ping", 8))) {
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

  async sendCommand(command, attempts = 3) {
    const token = encodeURIComponent(PaperBridge.Settings.trayToken());
    const url = `http://127.0.0.1:${PaperBridge.Settings.trayPort()}/${encodeURIComponent(command)}?token=${token}`;
    for (let i = 0; i < attempts; i++) {
      try {
        const response = await this.fetchWithTimeout(url, { cache: "no-store" }, this.commandTimeoutMS);
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
  }
};
