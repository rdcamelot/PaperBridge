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

async function startup({ id, version, rootURI }) {
  paperbridgeLog(`Starting ${version}`);

  const scripts = [
    "chrome/content/modules/constants.js",
    "chrome/content/modules/settings.js",
    "chrome/content/modules/util.js",
    "chrome/content/modules/index.js",
    "chrome/content/modules/tray.js",
    "chrome/content/modules/ranks.js",
    "chrome/content/modules/notes.js",
    "chrome/content/modules/bulk.js",
    "chrome/content/modules/annotations.js",
    "chrome/content/modules/scanner.js",
    "chrome/content/modules/deleteQueue.js",
    "chrome/content/modules/readingQueue.js",
    "chrome/content/modules/citations.js",
    "chrome/content/modules/itemPane.js",
    "chrome/content/modules/columns.js",
    "chrome/content/modules/menus.js",
    "chrome/content/modules/shortcuts.js",
    "chrome/content/modules/notifications.js",
    "chrome/content/modules/ui.js",
    "chrome/content/paperbridge.js"
  ];

  for (const script of scripts) {
    Services.scriptloader.loadSubScript(rootURI + script, this);
  }

  PaperBridge.init({ id, version, rootURI });

  await paperbridgeOptionalStartupStep("preferences", () => paperbridgeRegisterPreferencePane(id, rootURI));
  await paperbridgeOptionalStartupStep("runtime", () => PaperBridge.start());
  await paperbridgeOptionalStartupStep("existing windows", () => PaperBridge.addToAllWindows());
  await paperbridgeOptionalStartupStep("late window setup", () => PaperBridge.afterWindowsReady());
}

function onMainWindowLoad({ window }) {
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
