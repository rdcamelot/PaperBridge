var PaperBridge;
var paperbridgePreferencePaneID = null;

function paperbridgeLog(message) {
  try {
    if (typeof Zotero !== "undefined" && Zotero.debug) {
      Zotero.debug(`PaperBridge: ${message}`);
    }
  }
  catch (_error) {
    // Logging must never block add-on installation.
  }
}

function paperbridgeLogError(error) {
  try {
    if (typeof Zotero !== "undefined" && Zotero.logError) {
      Zotero.logError(error);
    }
    else {
      paperbridgeLog(error?.message || String(error));
    }
  }
  catch (logError) {
    paperbridgeLog(error?.message || String(error));
  }
}

async function paperbridgeOptionalStartupStep(name, callback) {
  try {
    return await callback();
  }
  catch (error) {
    paperbridgeLog(`Startup step failed (${name}): ${error.message || error}`);
    paperbridgeLogError(error);
    return null;
  }
}

async function paperbridgeRegisterPreferencePane(id, rootURI) {
  if (!Zotero.PreferencePanes?.register) {
    paperbridgeLog("Preference pane API is unavailable.");
    return;
  }

  if (Zotero.PreferencePanes?.unregister) {
    try {
      Zotero.PreferencePanes.unregister("paperbridge-preferences-pane");
    }
    catch (_error) {
      // The pane may not have been registered in this session.
    }
  }

  paperbridgePreferencePaneID = await Zotero.PreferencePanes.register({
    pluginID: id,
    id: "paperbridge-preferences-pane",
    label: "PaperBridge",
    image: rootURI + "icons/paperbridge-20.svg",
    src: rootURI + "preferences.xhtml",
    scripts: [rootURI + "preferences.js"],
    stylesheets: [rootURI + "style.css"]
  });
}

async function paperbridgeWaitForZoteroReady() {
  const promises = [
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise
  ].filter(promise => promise && typeof promise.then === "function");

  if (promises.length) {
    await Promise.all(promises);
  }
}

function paperbridgeLoadSubScript(rootURI, script) {
  try {
    Services.scriptloader.loadSubScript(rootURI + script.path, this);
    return true;
  }
  catch (error) {
    paperbridgeLog(`Could not load ${script.path}: ${error.message || error}`);
    paperbridgeLogError(error);
    if (script.required) {
      throw error;
    }
    return false;
  }
}

async function startup({ id, version, rootURI }) {
  paperbridgeLog(`Starting ${version}`);
  await paperbridgeWaitForZoteroReady();

  const scripts = [
    { path: "chrome/content/modules/constants.js", required: true },
    { path: "chrome/content/modules/settings.js", required: true },
    { path: "chrome/content/modules/util.js", required: true },
    { path: "chrome/content/modules/index.js", required: true },
    { path: "chrome/content/modules/tray.js" },
    { path: "chrome/content/modules/ranks.js" },
    { path: "chrome/content/modules/notes.js" },
    { path: "chrome/content/modules/bulk.js" },
    { path: "chrome/content/modules/annotations.js" },
    { path: "chrome/content/modules/scanner.js" },
    { path: "chrome/content/modules/deleteQueue.js" },
    { path: "chrome/content/modules/readingQueue.js" },
    { path: "chrome/content/modules/citations.js" },
    { path: "chrome/content/modules/diagnostics.js" },
    { path: "chrome/content/modules/itemPane.js" },
    { path: "chrome/content/modules/columns.js" },
    { path: "chrome/content/modules/menus.js" },
    { path: "chrome/content/modules/shortcuts.js" },
    { path: "chrome/content/modules/notifications.js" },
    { path: "chrome/content/modules/ui.js" },
    { path: "chrome/content/paperbridge.js", required: true }
  ];

  for (const script of scripts) {
    paperbridgeLoadSubScript.call(this, rootURI, script);
  }

  PaperBridge.init({ id, version, rootURI });

  await paperbridgeOptionalStartupStep("preferences", () => paperbridgeRegisterPreferencePane(id, rootURI));
  await paperbridgeOptionalStartupStep("runtime", () => PaperBridge.start());
  await paperbridgeOptionalStartupStep("existing windows", () => PaperBridge.addToAllWindows());
  await paperbridgeOptionalStartupStep("late window setup", () => PaperBridge.afterWindowsReady());
}

async function onMainWindowLoad({ window }) {
  await paperbridgeWaitForZoteroReady();
  PaperBridge?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  PaperBridge?.removeFromWindow(window);
}

async function shutdown() {
  paperbridgeLog("Shutting down");
  await cleanupPaperBridgeStartup();
  PaperBridge = undefined;
}

async function cleanupPaperBridgeStartup() {
  if (paperbridgePreferencePaneID && Zotero.PreferencePanes?.unregister) {
    try {
      Zotero.PreferencePanes.unregister(paperbridgePreferencePaneID);
    }
    catch (error) {
      paperbridgeLogError(error);
    }
    paperbridgePreferencePaneID = null;
  }
  try {
    await PaperBridge?.stop();
  }
  catch (error) {
    paperbridgeLogError(error);
  }
  try {
    PaperBridge?.removeFromAllWindows();
  }
  catch (error) {
    paperbridgeLogError(error);
  }
}

function install() {
  paperbridgeLog("Installed");
}

function uninstall() {
  paperbridgeLog("Uninstalled");
}
