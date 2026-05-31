PaperBridge = PaperBridge || {};

PaperBridge.Shortcuts = {
  handlers: new Map(),

  addToWindow(window) {
    if (this.handlers.has(window)) {
      return;
    }
    const handler = event => this.onKeyDown(event);
    window.document.addEventListener("keydown", handler, true);
    this.handlers.set(window, handler);
  },

  removeFromWindow(window) {
    const handler = this.handlers.get(window);
    if (!handler) {
      return;
    }
    window.document.removeEventListener("keydown", handler, true);
    this.handlers.delete(window);
  },

  removeFromAllWindows() {
    for (const [window, handler] of this.handlers.entries()) {
      window.document.removeEventListener("keydown", handler, true);
    }
    this.handlers.clear();
  },

  onKeyDown(event) {
    if (this.shouldIgnoreEvent(event)) {
      return;
    }

    const key = event.key;
    if (["1", "2", "3", "4"].includes(key)) {
      this.applyRank(event, key);
      return;
    }
    if (key === "0") {
      this.applyRank(event, "");
      return;
    }
    if (key === "x" || key === "X") {
      this.applyRank(event, "x");
      return;
    }
    if (key === "m" || key === "M") {
      this.openSelectedNote(event);
    }
  },

  shouldIgnoreEvent(event) {
    return Boolean(
      event.defaultPrevented
      || event.isComposing
      || event.repeat
      || event.ctrlKey
      || event.altKey
      || event.metaKey
      || this.isInteractiveTarget(event.target)
      || !this.isItemTreeContext(event)
    );
  },

  isEditableTarget(target) {
    return this.isInteractiveTarget(target);
  },

  isInteractiveTarget(target) {
    const tagName = target?.tagName?.toLowerCase?.() || "";
    if ([
      "input",
      "textarea",
      "select",
      "button",
      "textbox",
      "search-textbox",
      "menulist",
      "menuitem"
    ].includes(tagName)) {
      return true;
    }
    if (target?.isContentEditable) {
      return true;
    }
    if (typeof target?.closest !== "function") {
      return false;
    }
    return Boolean(target.closest([
      "input",
      "textarea",
      "select",
      "button",
      "textbox",
      "search-textbox",
      "menulist",
      "menuitem",
      "menupopup",
      "panel",
      "dialog",
      '[contenteditable=""]',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].join(",")));
  },

  isItemTreeContext(event) {
    if (this.eventPathHasItemTree(event)) {
      return true;
    }
    if (this.isItemTreeTarget(event.target)) {
      return true;
    }

    const doc = event.target?.ownerDocument || event.currentTarget || null;
    if (this.isItemTreeTarget(doc?.activeElement)) {
      return true;
    }

    return this.itemsViewHasFocus(event);
  },

  eventPathHasItemTree(event) {
    if (typeof event.composedPath !== "function") {
      return false;
    }
    try {
      return event.composedPath().some(target => this.isItemTreeTarget(target));
    }
    catch (error) {
      return false;
    }
  },

  isItemTreeTarget(target) {
    if (!target) {
      return false;
    }

    const tagName = target.tagName?.toLowerCase?.() || "";
    if (tagName === "item-tree") {
      return true;
    }

    const id = String(target.id || "");
    if (id === "zotero-items-tree" || id.startsWith("item-tree-main")) {
      return true;
    }

    if (typeof target.closest !== "function") {
      return false;
    }
    try {
      return Boolean(target.closest([
        "#zotero-items-tree",
        '[id^="item-tree-main"]',
        "item-tree",
        ".item-tree"
      ].join(",")));
    }
    catch (error) {
      return false;
    }
  },

  itemsViewHasFocus(event) {
    const pane = event.view?.ZoteroPane || Zotero.getActiveZoteroPane?.() || null;
    const itemsView = pane?.itemsView;
    if (!itemsView) {
      return false;
    }

    if (typeof itemsView.isFocused === "function") {
      try {
        return Boolean(itemsView.isFocused());
      }
      catch (error) {
        return false;
      }
    }

    const doc = event.target?.ownerDocument || event.currentTarget || null;
    const activeElement = doc?.activeElement;
    if (activeElement && typeof itemsView.tree?.contains === "function") {
      try {
        return Boolean(itemsView.tree.contains(activeElement));
      }
      catch (error) {
        return false;
      }
    }
    return false;
  },

  applyRank(event, rank) {
    const items = PaperBridge.Util.getSelectedRegularItems();
    if (!items.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    PaperBridge.Ranks.setRankForSelected(rank).catch(error => {
      PaperBridge.Util.logError(error);
      PaperBridge.Util.alert(error.message);
    });
  },

  openSelectedNote(event) {
    const [item] = PaperBridge.Util.getSelectedRegularItems();
    if (!item) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    PaperBridge.Notes.handleNoteClick(item.id).catch(error => {
      PaperBridge.Util.logError(error);
      PaperBridge.Util.alert(error.message);
    });
  }
};
