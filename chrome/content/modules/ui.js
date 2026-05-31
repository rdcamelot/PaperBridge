PaperBridge = PaperBridge || {};

PaperBridge.UI = {
  addedElementIDs: new Map(),

  addToWindow(window) {
    if (this.addedElementIDs.has(window)) {
      return;
    }
    const doc = window.document;
    const ids = [];

    window.MozXULElement?.insertFTLIfNeeded?.("paperbridge.ftl");

    const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.id = "paperbridge-window-style";
    style.textContent = `@import url("${PaperBridge.rootURI}style.css");`;
    doc.documentElement.appendChild(style);
    ids.push(style.id);

    this.addedElementIDs.set(window, ids);
  },

  removeFromWindow(window) {
    const ids = this.addedElementIDs.get(window) || [];
    for (const id of ids) {
      window.document.getElementById(id)?.remove();
    }
    window.document.querySelector('[href="paperbridge.ftl"]')?.remove();
    window.document.getElementById("paperbridge-rank-popup")?.remove();
    this.addedElementIDs.delete(window);
  },

  removeFromAllWindows() {
    for (const window of [...this.addedElementIDs.keys()]) {
      this.removeFromWindow(window);
    }
  }
};
