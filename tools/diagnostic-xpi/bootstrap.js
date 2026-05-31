function log(message) {
  try {
    Zotero.debug(`PaperBridge Diagnostic: ${message}`);
  }
  catch (_error) {
  }
}

function install() {
  log("Installed");
}

function startup({ version }) {
  log(`Started ${version}`);
}

function shutdown() {
  log("Stopped");
}

function uninstall() {
  log("Uninstalled");
}
