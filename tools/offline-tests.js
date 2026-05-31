const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const prefs = new Map([
  ["extensions.paperbridge.markdownRoot", "D:\\Papers"],
  ["extensions.paperbridge.filenameTemplate", "{{citekey}} - {{shortTitle}}.md"],
  ["extensions.paperbridge.useBetterBibTeXCitekey", true],
  ["extensions.paperbridge.fallbackCitekeyPattern", "{{firstCreator}}{{year}}_{{firstTitleWord}}"],
  ["extensions.paperbridge.autoCreateOnlyCollections", ""],
  ["extensions.paperbridge.ignoreCollections", ""],
  ["extensions.paperbridge.maxFilenameLength", 180],
  ["extensions.paperbridge.rankTagPrefix", "paperbridge/rank/"],
  ["extensions.paperbridge.statusTagPrefix", "paperbridge/status/"],
  ["extensions.paperbridge.noteAttachmentTitle", "Markdown Reading Note"],
  ["extensions.paperbridge.index", "{}"],
  ["extensions.paperbridge.closeToTray", "false"]
]);

const attachmentByID = new Map();
const fileContentsByPath = new Map();
const childrenByDirectory = new Map();
const pathTypes = new Map();
const zoteroItemsByID = new Map();
let searchIDs = [];
const launchedFiles = [];
const observerRegistrations = [];
const observerRemovals = [];
const collectionsByID = new Map([
  [7, { id: 7, name: "Inbox" }],
  [8, { id: 8, name: "Ignored" }],
  [9, { id: 9, name: "Reading Queue" }]
]);
let linkedAttachmentPayload = null;
let noteFileContent = "";
const context = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  PaperBridge: {},
  Zotero: {
    Prefs: {
      get(key) {
        return prefs.get(key);
      },
      set(key, value) {
        prefs.set(key, value);
      }
    },
    debug() {},
    logError(error) {
      throw error;
    },
    Libraries: {
      userLibraryID: 1,
      get() {
        return null;
      },
      getAll() {
        return [{ libraryID: 1 }];
      }
    },
    Attachments: {
      BASE_PATH_PLACEHOLDER: "attachments:",
      resolveRelativePath(value) {
        return value.replace(/^attachments:/, "D:\\Papers\\");
      },
      async linkFromFile(payload) {
        linkedAttachmentPayload = payload;
        return payload;
      }
    },
    File: {
      pathToFile(filePath) {
        return {
          exists() {
            return pathTypes.get(filePath) !== "missing" && Boolean(filePath);
          },
          lastModifiedTime: 123,
          launch() {
            launchedFiles.push(filePath);
          }
        };
      },
      async getContentsAsync(filePath) {
        return fileContentsByPath.has(filePath) ? fileContentsByPath.get(filePath) : noteFileContent;
      },
      getContents(filePath) {
        return fileContentsByPath.has(filePath) ? fileContentsByPath.get(filePath) : noteFileContent;
      },
      async putContentsAsync(filePath, content) {
        if (filePath) {
          fileContentsByPath.set(filePath, content);
        }
        noteFileContent = content;
      }
    },
    Items: {
      getAll() {
        return context.getAllItemsResult || null;
      },
      get(id) {
        return attachmentByID.get(id) || zoteroItemsByID.get(id);
      },
      async getAsync(ids) {
        return (ids || []).map(id => attachmentByID.get(id) || zoteroItemsByID.get(id)).filter(Boolean);
      },
      getByLibraryAndKey(libraryID, key) {
        return Number(libraryID) === 1 && key === "ABCD1234" ? context.scanMatchItem : null;
      }
    },
    Search: function () {
      this.libraryID = null;
      this.addCondition = function () {};
      this.search = async function () {
        return searchIDs;
      };
    },
    Collections: {
      get(id) {
        return collectionsByID.get(Number(id)) || null;
      }
    },
    BetterBibTeX: null
  },
  Services: {
    obs: {
      addObserver(observer, topic) {
        observerRegistrations.push({ observer, topic });
      },
      removeObserver(observer, topic) {
        observerRemovals.push({ observer, topic });
      }
    },
    uuid: {
      generateUUID() {
        return "{00000000-0000-4000-8000-000000000000}";
      }
    }
  },
  PathUtils: {
    join(...segments) {
      return path.win32.join(...segments);
    }
  },
  IOUtils: {
    async makeDirectory(directory) {
      pathTypes.set(directory, "directory");
    },
    async exists(filePath) {
      return pathTypes.has(filePath);
    },
    async getChildren(directory) {
      return childrenByDirectory.get(directory) || [];
    },
    async stat(filePath) {
      return { type: pathTypes.get(filePath) || "regular" };
    },
    async move(source, target) {
      if (!pathTypes.has(source)) {
        throw new Error(`Missing source: ${source}`);
      }
      pathTypes.set(target, pathTypes.get(source));
      pathTypes.delete(source);
      if (fileContentsByPath.has(source)) {
        fileContentsByPath.set(target, fileContentsByPath.get(source));
        fileContentsByPath.delete(source);
      }
    }
  },
  Cc: {},
  Ci: {},
  crypto: {
    getRandomValues(bytes) {
      bytes.fill(7);
      return bytes;
    }
  }
};

vm.createContext(context);

for (const file of [
  "chrome/content/modules/constants.js",
  "chrome/content/modules/settings.js",
  "chrome/content/modules/util.js",
  "chrome/content/modules/tray.js",
  "chrome/content/modules/index.js",
  "chrome/content/modules/ranks.js",
  "chrome/content/modules/notes.js",
  "chrome/content/modules/bulk.js",
  "chrome/content/modules/annotations.js",
  "chrome/content/modules/deleteQueue.js",
  "chrome/content/modules/readingQueue.js",
  "chrome/content/modules/citations.js",
  "chrome/content/modules/scanner.js",
  "chrome/content/modules/itemPane.js",
  "chrome/content/modules/columns.js",
  "chrome/content/modules/menus.js",
  "chrome/content/modules/shortcuts.js",
  "chrome/content/modules/notifications.js"
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

const { PaperBridge } = context;
const plain = value => JSON.parse(JSON.stringify(value));
const sourceIncludes = (file, text) => fs.readFileSync(path.join(root, file), "utf8").includes(text);
const ftlIDList = file => [...fs.readFileSync(path.join(root, file), "utf8").matchAll(/^([A-Za-z][A-Za-z0-9_-]*)\s*=/gm)].map(match => match[1]);
const ftlIDs = file => new Set(ftlIDList(file));
const ftlAttributes = file => {
  const attributes = new Map();
  let currentID = "";
  for (const line of fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/)) {
    const idMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=/);
    if (idMatch) {
      currentID = idMatch[1];
      attributes.set(currentID, new Set());
      continue;
    }
    const attributeMatch = line.match(/^\s+\.([A-Za-z][A-Za-z0-9_-]*)\s*=/);
    if (attributeMatch && currentID) {
      attributes.get(currentID).add(attributeMatch[1]);
    }
  }
  return attributes;
};

function createFakeMenuWindow() {
  const elements = new Map();
  const removed = [];
  const makeElement = tagName => ({
    tagName,
    id: "",
    attributes: {},
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      if (child.id) {
        elements.set(child.id, child);
      }
    },
    remove() {
      removed.push(this.id);
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      }
      if (this.id) {
        elements.delete(this.id);
      }
      for (const child of [...this.children]) {
        child.remove();
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
  });

  const document = {
    documentElement: makeElement("window"),
    createXULElement: makeElement,
    createElement: makeElement,
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
  const toolsPopup = makeElement("menupopup");
  toolsPopup.id = "menu_ToolsPopup";
  elements.set(toolsPopup.id, toolsPopup);
  return {
    window: { document },
    document,
    elements,
    removed,
    toolsPopup
  };
}

async function runBootstrapLifecycleTests({ failStart = false, failUnregister = false } = {}) {
  const calls = [];
  const bootstrapContext = {
    Zotero: {
      debug(message) {
        calls.push(["debug", message]);
      },
      logError(error) {
        calls.push(["log-error", error.message]);
      },
      PreferencePanes: {
        unregister(id) {
          calls.push(["unregister-pref", id]);
          if (failUnregister) {
            throw new Error(`unregister failed: ${id}`);
          }
        },
        async register(options) {
          calls.push(["register-pref", options.id, options.pluginID, options.src]);
          return options.id;
        }
      }
    },
    Services: {
      scriptloader: {
        loadSubScript(uri, scope) {
          calls.push(["load", uri]);
          if (uri.endsWith("chrome/content/paperbridge.js")) {
            scope.PaperBridge = {
              init(payload) {
                calls.push(["init", payload.id, payload.version, payload.rootURI]);
              },
              async start() {
                calls.push(["start"]);
                if (failStart) {
                  throw new Error("start failed");
                }
              },
              addToAllWindows() {
                calls.push(["add-windows"]);
              },
              afterWindowsReady() {
                calls.push(["after-windows"]);
              },
              async stop() {
                calls.push(["stop"]);
              },
              removeFromAllWindows() {
                calls.push(["remove-windows"]);
              }
            };
          }
        }
      }
    }
  };
  vm.createContext(bootstrapContext);
  vm.runInContext(fs.readFileSync(path.join(root, "bootstrap.js"), "utf8"), bootstrapContext, { filename: "bootstrap.js" });

  const startupPayload = {
    id: "paperbridge@example.com",
    version: "0.1.3",
    rootURI: "resource://paperbridge/"
  };
  await bootstrapContext.startup.call(bootstrapContext, startupPayload);
  assert.ok(calls.some(call => call[0] === "register-pref" && call[1] === "paperbridge-preferences-pane"));
  assert.ok(calls.some(call => call[0] === "add-windows"));
  assert.ok(calls.findIndex(call => call[0] === "add-windows") < calls.findIndex(call => call[0] === "after-windows"));
  if (failStart) {
    assert.ok(calls.some(call => call[0] === "log-error" && call[1].includes("start failed")));
  }
  await bootstrapContext.shutdown.call(bootstrapContext);
  assert.ok(calls.some(call => call[0] === "unregister-pref" && call[1] === "paperbridge-preferences-pane"));
  assert.strictEqual(bootstrapContext.PaperBridge, undefined);
  return calls;
}

async function runBootstrapUnregisterFailureTest() {
  const calls = await runBootstrapLifecycleTests({ failUnregister: true });
  assert.ok(calls.some(call => call[0] === "log-error" && call[1].includes("unregister failed")));
  assert.ok(calls.some(call => call[0] === "stop"));
  assert.ok(calls.some(call => call[0] === "remove-windows"));
}

async function runBootstrapCleanupFailureTest() {
  const calls = [];
  const bootstrapContext = {
    Zotero: {
      debug(message) {
        calls.push(["debug", message]);
      },
      logError(error) {
        calls.push(["log-error", error.message]);
      },
      PreferencePanes: {
        async register() {
          return "paperbridge-preferences-pane";
        },
        unregister(id) {
          calls.push(["unregister-pref", id]);
        }
      }
    },
    Services: {
      scriptloader: {
        loadSubScript(uri, scope) {
          if (uri.endsWith("chrome/content/paperbridge.js")) {
            scope.PaperBridge = {
              init() {},
              async start() {},
              addToAllWindows() {},
              afterWindowsReady() {},
              async stop() {
                calls.push(["stop"]);
                throw new Error("stop cleanup failed");
              },
              removeFromAllWindows() {
                calls.push(["remove-windows"]);
                throw new Error("window cleanup failed");
              }
            };
          }
        }
      }
    }
  };
  vm.createContext(bootstrapContext);
  vm.runInContext(fs.readFileSync(path.join(root, "bootstrap.js"), "utf8"), bootstrapContext, { filename: "bootstrap.js" });
  await bootstrapContext.startup.call(bootstrapContext, {
    id: "paperbridge@example.com",
    version: "0.1.3",
    rootURI: "resource://paperbridge/"
  });
  await assert.doesNotReject(() => bootstrapContext.shutdown.call(bootstrapContext));
  assert.ok(calls.some(call => call[0] === "log-error" && call[1].includes("stop cleanup failed")));
  assert.ok(calls.some(call => call[0] === "log-error" && call[1].includes("window cleanup failed")));
  assert.strictEqual(bootstrapContext.PaperBridge, undefined);
}

async function runPaperBridgeStopCleanupTest() {
  const calls = [];
  const errors = [];
  const stopContext = {
    PaperBridge: {
      Util: {
        safeLogError(error) {
          errors.push(error.message);
        }
      },
      Notifications: {
        stop() {
          calls.push("notifications");
          throw new Error("notification stop failed");
        }
      },
      Tray: {
        async stop() {
          calls.push("tray");
        },
        addToWindow() {},
        removeFromWindow() {}
      },
      Menus: {
        unregister() {
          calls.push("menus unregister");
        },
        removeFromAllWindows() {
          calls.push("menus remove");
          throw new Error("menu remove failed");
        },
        addToWindow() {},
        removeFromWindow() {}
      },
      Shortcuts: {
        removeFromAllWindows() {
          calls.push("shortcuts");
        },
        addToWindow() {},
        removeFromWindow() {}
      },
      ItemPane: {
        unregister() {
          calls.push("item pane");
        }
      },
      Columns: {
        async unregister() {
          calls.push("columns");
        }
      },
      UI: {
        addToWindow() {},
        removeFromWindow() {},
        removeFromAllWindows() {
          calls.push("window ui");
        }
      }
    }
  };
  vm.createContext(stopContext);
  vm.runInContext(fs.readFileSync(path.join(root, "chrome/content/paperbridge.js"), "utf8"), stopContext, { filename: "paperbridge.js" });
  await stopContext.PaperBridge.stop();
  assert.deepStrictEqual(calls, [
    "notifications",
    "tray",
    "menus unregister",
    "menus remove",
    "shortcuts",
    "window ui",
    "item pane",
    "columns"
  ]);
  assert.ok(errors.some(error => error.includes("notification stop failed")));
  assert.ok(errors.some(error => error.includes("menu remove failed")));
}

async function runPaperBridgeStartupResilienceTest() {
  const calls = [];
  const errors = [];
  const mainWindow = { ZoteroPane: true };
  const context = {
    Zotero: {
      getMainWindows() {
        return [mainWindow];
      }
    },
    PaperBridge: {
      Util: {
        safeLogError(error) {
          errors.push(error.message);
        }
      },
      Tray: {
        start() {
          calls.push("tray start");
          throw new Error("tray failed");
        },
        addToWindow() {
          calls.push("tray window");
          throw new Error("tray window failed");
        },
        removeFromWindow() {}
      },
      Columns: {
        async register() {
          calls.push("columns");
          throw new Error("columns failed");
        },
        async unregister() {}
      },
      ItemPane: {
        register() {
          calls.push("item pane");
        },
        unregister() {}
      },
      Notifications: {
        start() {
          calls.push("notifications");
        },
        stop() {}
      },
      Menus: {
        register() {
          calls.push("menus register");
          throw new Error("menus failed");
        },
        addToWindow() {
          calls.push("menus window");
        },
        removeFromWindow() {},
        unregister() {},
        removeFromAllWindows() {}
      },
      Shortcuts: {
        addToWindow() {
          calls.push("shortcuts");
        },
        removeFromWindow() {},
        removeFromAllWindows() {}
      },
      UI: {
        addToWindow() {
          calls.push("ui");
          throw new Error("ui failed");
        },
        removeFromWindow() {},
        removeFromAllWindows() {}
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "chrome/content/paperbridge.js"), "utf8"), context, { filename: "paperbridge.js" });
  await assert.doesNotReject(() => context.PaperBridge.start());
  await assert.doesNotReject(() => context.PaperBridge.afterWindowsReady());
  assert.doesNotThrow(() => context.PaperBridge.addToAllWindows());
  assert.ok(calls.includes("item pane"));
  assert.ok(calls.includes("notifications"));
  assert.ok(calls.includes("menus window"));
  assert.ok(calls.includes("shortcuts"));
  assert.ok(errors.some(error => error.includes("tray failed")));
  assert.ok(errors.some(error => error.includes("columns failed")));
  assert.ok(errors.some(error => error.includes("menus failed")));
  assert.ok(errors.some(error => error.includes("ui failed")));
  assert.ok(errors.some(error => error.includes("tray window failed")));
}

for (const [file, text] of [
  ["chrome/content/modules/notes.js", "## 一句话总结"],
  ["chrome/content/modules/notes.js", "## 研究问题"],
  ["chrome/content/modules/notes.js", "## 核心方法"],
  ["chrome/content/modules/notes.js", "## 关键结论"],
  ["chrome/content/modules/notes.js", "## 局限性"],
  ["chrome/content/modules/menus.js", "PaperBridge: 为选中条目创建笔记"],
  ["chrome/content/modules/menus.js", "PaperBridge: 扫描 Markdown 并重连"],
  ["chrome/content/modules/menus.js", "PaperBridge: 生成阅读队列"],
  ["chrome/content/modules/menus.js", "PaperBridge: 生成当前分类引用清单"],
  ["chrome/content/modules/menus.js", "PaperBridge: 导出 PDF 注释到笔记"]
]) {
  assert.ok(sourceIncludes(file, text), `${file} should contain valid UTF-8 text: ${text}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.strictEqual(manifest.manifest_version, 2);
assert.strictEqual(manifest.applications?.zotero?.id, "paperbridge@example.com");
assert.strictEqual(manifest.version, "0.1.3");
assert.strictEqual(manifest.applications?.zotero?.update_url, "https://example.com/paperbridge/updates.json");
assert.strictEqual(manifest.applications?.zotero?.strict_min_version, "6.999");
assert.strictEqual(manifest.applications?.zotero?.strict_max_version, "11.*");
assert.strictEqual(manifest.icons?.["48"], "icons/paperbridge-20.svg");
assert.strictEqual(manifest.icons?.["96"], "icons/paperbridge-20.svg");
const defaultPrefsSource = fs.readFileSync(path.join(root, "prefs.js"), "utf8");
assert.ok(defaultPrefsSource.includes('pref("extensions.paperbridge.markdownRoot"'));
assert.ok(defaultPrefsSource.includes('pref("extensions.paperbridge.closeToTray", true);'));
const trayHelperSource = fs.readFileSync(path.join(root, "chrome/content/tray-helper.ps1"), "utf8");
assert.ok(trayHelperSource.includes("$client.ReceiveTimeout = 1000"));
assert.ok(trayHelperSource.includes("$client.SendTimeout = 1000"));
assert.ok(trayHelperSource.includes("$headerLines -gt 64"));
assert.ok(trayHelperSource.includes("PaperBridge:NOT_FOUND"));
assert.ok(trayHelperSource.includes("$script:hiddenWindowHandles = @()"));
assert.ok(trayHelperSource.includes("FindWindowsForProcess($ZoteroPid, [bool]$VisibleOnly)"));
assert.ok(trayHelperSource.includes('"hide" { return Hide-Zotero }'));
assert.ok(trayHelperSource.includes('"show" { return Show-Zotero }'));

const preferencesSource = fs.readFileSync(path.join(root, "preferences.xhtml"), "utf8");
const preferenceL10nIDs = [...preferencesSource.matchAll(/data-l10n-id="([^"]+)"/g)].map(match => match[1]);
const menuL10nIDs = [...fs.readFileSync(path.join(root, "chrome/content/modules/menus.js"), "utf8")
  .matchAll(/l10nID:\s*"([^"]+)"/g)].map(match => match[1]);
const dynamicL10nIDs = [
  ...fs.readFileSync(path.join(root, "chrome/content/modules/itemPane.js"), "utf8")
    .matchAll(/"((?:paperbridge-item-pane|paperbridge-pref)-[a-z0-9-]+)"/g),
  ...menuL10nIDs.map(id => [null, id])
].map(match => match[1]);
assert.ok(preferencesSource.includes('rel="localization" href="paperbridge.ftl"'));
assert.ok(!preferencesSource.includes('label="Use Better BibTeX'));
assert.ok(!preferencesSource.includes('placeholder="Leave empty'));
assert.ok(preferencesSource.includes("根目录"));
assert.ok(preferencesSource.includes("自动创建"));
assert.ok(preferencesSource.includes("托盘"));
assert.ok(preferencesSource.includes("标签"));
assert.ok(!preferencesSource.includes("鏍"));
assert.ok(!preferencesSource.includes("鑷"));
assert.ok(!preferencesSource.includes("鎵"));
assert.ok(!preferencesSource.includes("绛"));
assert.strictEqual((preferencesSource.match(/<groupbox\b/g) || []).length, 4);
assert.strictEqual((preferencesSource.match(/<groupbox\b[^>]*data-search-strings-raw=/g) || []).length, 4);
assert.strictEqual(new Set(preferenceL10nIDs).size, preferenceL10nIDs.length);
const inputL10nIDs = [...preferencesSource.matchAll(/<html:input\b[^>]*data-l10n-id="([^"]+)"/g)].map(match => match[1]);
const checkboxL10nIDs = [...preferencesSource.matchAll(/<checkbox\b[^>]*data-l10n-id="([^"]+)"/g)].map(match => match[1]);
for (const localeFile of ["locale/en-US/paperbridge.ftl", "locale/zh-CN/paperbridge.ftl"]) {
  const idList = ftlIDList(localeFile);
  const ids = ftlIDs(localeFile);
  const attributes = ftlAttributes(localeFile);
  assert.strictEqual(ids.size, idList.length, `${localeFile} should not define duplicate message IDs`);
  for (const id of [...preferenceL10nIDs, ...dynamicL10nIDs]) {
    assert.ok(id.startsWith("paperbridge-"), `${id} should be namespaced`);
    assert.ok(ids.has(id), `${localeFile} should define ${id}`);
  }
  for (const id of inputL10nIDs) {
    assert.ok(attributes.get(id)?.has("placeholder"), `${localeFile} should give ${id} a placeholder attribute`);
  }
  for (const id of checkboxL10nIDs) {
    assert.ok(attributes.get(id)?.has("label"), `${localeFile} should give ${id} a label attribute`);
  }
  for (const id of menuL10nIDs) {
    assert.ok(attributes.get(id)?.has("label"), `${localeFile} should give ${id} a label attribute`);
  }
  assert.ok(fs.readFileSync(path.join(root, localeFile), "utf8").includes('{ "{{firstCreator}}{{year}}_{{firstTitleWord}}" }'));
}

assert.strictEqual(PaperBridge.Settings.closeToTray(), false, "string false pref should parse to false");
assert.doesNotThrow(() => PaperBridge.Util.safeLogError(new Error("safe log test")));
assert.strictEqual(PaperBridge.Util.sanitizePathSegment('A <bad>: "title" / paper?.md'), "A bad title paper .md");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("CON"), "CON_");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("CON.md"), "CON_.md");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("nul.txt"), "nul_.txt");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("NUL.tar.gz"), "NUL_.tar.gz");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("LPT1."), "LPT1_");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("COM\u00b9.md"), "COM\u00b9_.md");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("", "CON.md"), "CON_.md");
assert.strictEqual(PaperBridge.Util.sanitizePathSegment("", ""), "");
assert.strictEqual(PaperBridge.Util.truncateFilename("COM9.md", 80), "COM9_.md");
assert.strictEqual(PaperBridge.Notes.directoryForCollection({ name: "NUL.txt" }), "D:\\Papers\\NUL_.txt");
  assert.strictEqual(PaperBridge.Util.yamlString('C:\\Papers\\"Quoted"'), '"C:\\\\Papers\\\\\\"Quoted\\""');
  assert.strictEqual(PaperBridge.Util.truncateFilename("a".repeat(200) + ".md", 80).length, 80);
  assert.match(PaperBridge.Util.randomToken(), /^[0-9a-f]{48}$/);
  const originalGroupsForUtil = context.Zotero.Groups;
  const originalLibrariesGetForUtil = context.Zotero.Libraries.get;
  context.Zotero.Libraries.get = libraryID => Number(libraryID) === 2
    ? { libraryType: "group", groupID: 22 }
    : null;
  context.Zotero.Groups = {
    get(groupID) {
      return Number(groupID) === 22
        ? { groupID: 22, libraryID: 2 }
        : Number(groupID) === 33
          ? { groupID: 33, libraryID: 3 }
          : null;
    },
    getByLibraryID(libraryID) {
      return Number(libraryID) === 3 ? { groupID: 33, libraryID: 3 } : null;
    }
  };
  assert.strictEqual(PaperBridge.Util.libraryIDFromZoteroURI("zotero://select/library/items/ABCD1234"), 1);
  assert.strictEqual(PaperBridge.Util.libraryIDFromZoteroURI("zotero://select/groups/22/items/ABCD1234"), 2);
  assert.strictEqual(PaperBridge.Util.libraryIDFromZoteroURI("zotero://open-pdf/groups/33/items/PDFKEY"), 3);
assert.strictEqual(PaperBridge.Util.libraryIDFromZoteroURI("zotero://select/groups/999/items/ABCD1234"), null);
assert.strictEqual(PaperBridge.Util.zoteroURIHasLibraryTarget("zotero://select/groups/999/items/ABCD1234"), true);
assert.strictEqual(PaperBridge.Util.zoteroURIHasLibraryTarget("https://example.com/items/ABCD1234"), false);
assert.strictEqual(PaperBridge.Util.itemKeyFromZoteroURI("zotero://select/library/items/ABCD1234"), "ABCD1234");
assert.strictEqual(PaperBridge.Util.itemKeyFromZoteroURI("zotero://open-pdf/groups/33/items/PDF%20KEY?page=4"), "PDF KEY");
assert.strictEqual(PaperBridge.Util.libraryURIPath({ libraryID: 2 }), "groups/22");
assert.strictEqual(PaperBridge.Util.zoteroSelectURI({ libraryID: 2, key: "GRPKEY1" }), "zotero://select/groups/22/items/GRPKEY1");
  context.Zotero.Libraries.get = () => null;
assert.strictEqual(PaperBridge.Util.libraryURIPath({ libraryID: 3 }), "groups/33");
assert.strictEqual(PaperBridge.Util.libraryURIPath({ libraryID: 4, groupID: 44 }), "groups/44");
context.Zotero.Libraries.get = originalLibrariesGetForUtil;
context.Zotero.Groups = originalGroupsForUtil;
const originalGetActivePaneForLibrary = context.Zotero.getActiveZoteroPane;
context.Zotero.getActiveZoteroPane = () => ({
  getSelectedLibraryID() {
    return null;
  }
});
assert.strictEqual(PaperBridge.Util.getSelectedLibraryID(), null);
context.Zotero.getActiveZoteroPane = () => ({
  getSelectedLibraryID() {
    return "2";
  }
});
assert.strictEqual(PaperBridge.Util.getSelectedLibraryID(), 2);
context.Zotero.getActiveZoteroPane = originalGetActivePaneForLibrary;
prefs.set("extensions.paperbridge.autoCreateOnlyCollections", " Inbox ; Research\nReading Queue\uFF0CLLM Safety\uFF1BArchive ");
assert.deepStrictEqual(plain(PaperBridge.Settings.autoCreateOnlyCollections()), ["Inbox", "Research", "Reading Queue", "LLM Safety", "Archive"]);
assert.strictEqual(PaperBridge.Settings.collectionNameMatches("inbox", PaperBridge.Settings.autoCreateOnlyCollections()), true);
assert.strictEqual(PaperBridge.Settings.collectionNameMatches("Other", PaperBridge.Settings.autoCreateOnlyCollections()), false);
prefs.set("extensions.paperbridge.autoCreateOnlyCollections", "");
prefs.set("extensions.paperbridge.maxFilenameLength", 20);
assert.strictEqual(PaperBridge.Settings.maxFilenameLength(), 80);
prefs.set("extensions.paperbridge.maxFilenameLength", 999);
assert.strictEqual(PaperBridge.Settings.maxFilenameLength(), 240);
prefs.set("extensions.paperbridge.maxFilenameLength", 180);
prefs.set("extensions.paperbridge.trayPort", 80);
assert.strictEqual(PaperBridge.Settings.trayPort(), 23128);
prefs.set("extensions.paperbridge.trayPort", 23128);
prefs.set("extensions.paperbridge.rankTagPrefix", "");
prefs.set("extensions.paperbridge.statusTagPrefix", "");
assert.strictEqual(PaperBridge.Settings.rankTagPrefix(), "paperbridge/rank/");
assert.strictEqual(PaperBridge.Settings.statusTagPrefix(), "paperbridge/status/");
prefs.set("extensions.paperbridge.rankTagPrefix", "custom/");
prefs.set("extensions.paperbridge.statusTagPrefix", "custom/");
assert.strictEqual(PaperBridge.Settings.rankTagPrefix(), "custom/");
assert.strictEqual(PaperBridge.Settings.statusTagPrefix(), "paperbridge/status/");
prefs.set("extensions.paperbridge.rankTagPrefix", "paperbridge/status/");
prefs.set("extensions.paperbridge.statusTagPrefix", "");
assert.strictEqual(PaperBridge.Settings.statusTagPrefix(), "paperbridge/state/");
prefs.set("extensions.paperbridge.rankTagPrefix", "paperbridge/rank/");
prefs.set("extensions.paperbridge.statusTagPrefix", "paperbridge/status/");

const mockItem = {
  id: 42,
  key: "ABCD1234",
  libraryID: 1,
  firstCreator: "Doe",
  isRegularItem() {
    return true;
  },
  getField(field) {
    return {
      title: "A Study: On Invalid / Windows * Names",
      date: "2024-05-01",
      extra: ""
    }[field] || "";
  },
  getTags() {
    return [{ tag: "paperbridge/rank/1" }];
  },
  getAttachments() {
    return [100, 101];
  }
};

assert.strictEqual(PaperBridge.Notes.fallbackCitekey(mockItem), "doe2024_a");
context.Zotero.BetterBibTeX = {
  getCitationKey() {
    return "doe2024_bbt";
  }
};
assert.strictEqual(PaperBridge.Notes.citekeyForItem(mockItem), "doe2024_bbt");
const nativeCitekeyItem = Object.assign({}, mockItem, {
  getField(field) {
    return field === "citationKey" ? "native2026_key" : mockItem.getField(field);
  }
});
assert.strictEqual(PaperBridge.Notes.citekeyForItem(nativeCitekeyItem), "native2026_key");
context.Zotero.BetterBibTeX = {
  KeyManager: {
    get() {
      return { citationKey: "doe2024_object" };
    }
  }
};
assert.strictEqual(PaperBridge.Notes.citekeyForItem(mockItem), "doe2024_object");
const propertyCitekeyItem = Object.assign({}, mockItem, {
  citationKey: "property2026_key",
  getField(field) {
    if (field === "citationKey") {
      throw new Error("unknown field");
    }
    return mockItem.getField(field);
  }
});
assert.strictEqual(PaperBridge.Notes.citekeyForItem(propertyCitekeyItem), "property2026_key");
prefs.set("extensions.paperbridge.useBetterBibTeXCitekey", false);
assert.strictEqual(PaperBridge.Notes.citekeyForItem(mockItem), "doe2024_a");
prefs.set("extensions.paperbridge.fallbackCitekeyPattern", "{{year}}-{{firstCreator}}-{{firstTitleWord}}-{{itemKey}}");
assert.strictEqual(PaperBridge.Notes.fallbackCitekey(mockItem), "2024-doe-a-abcd1234");
const pinnedItem = Object.assign({}, mockItem, {
  getField(field) {
    return field === "extra" ? "Citation Key: Pinned Key: 2024" : mockItem.getField(field);
  }
});
assert.strictEqual(PaperBridge.Notes.citekeyForItem(pinnedItem), "Pinned_Key_2024");
const mixedStateItem = Object.assign({}, mockItem, {
  getTags() {
    return [
      { tag: "paperbridge/rank/bad" },
      { tag: "paperbridge/status/unknown" },
      { tag: "paperbridge/rank/3" },
      { tag: "paperbridge/status/read" }
    ];
  }
});
assert.strictEqual(PaperBridge.Ranks.getRank(mixedStateItem), "3");
assert.strictEqual(PaperBridge.Ranks.getStatus(mixedStateItem), "read");
const originalGetSelectedCollectionForPrimary = PaperBridge.Util.getSelectedCollection;
const stringCollectionIDPrimaryItem = Object.assign({}, mockItem, {
  getCollections() {
    return ["9", "7", "bad", 0];
  }
});
assert.deepStrictEqual(PaperBridge.Util.collectionIDsForItem(stringCollectionIDPrimaryItem), [9, 7]);
PaperBridge.Util.getSelectedCollection = () => collectionsByID.get(7);
assert.strictEqual(PaperBridge.Notes.pickPrimaryCollection(stringCollectionIDPrimaryItem), collectionsByID.get(7));
PaperBridge.Util.getSelectedCollection = () => ({ id: "9", name: "Selected String ID" });
assert.strictEqual(PaperBridge.Notes.pickPrimaryCollection(stringCollectionIDPrimaryItem).name, "Selected String ID");
PaperBridge.Util.getSelectedCollection = () => collectionsByID.get(8);
assert.strictEqual(PaperBridge.Notes.pickPrimaryCollection(stringCollectionIDPrimaryItem), collectionsByID.get(9));
PaperBridge.Util.getSelectedCollection = originalGetSelectedCollectionForPrimary;
prefs.set("extensions.paperbridge.useBetterBibTeXCitekey", true);
prefs.set("extensions.paperbridge.fallbackCitekeyPattern", "{{firstCreator}}{{year}}_{{firstTitleWord}}");
context.Zotero.BetterBibTeX = null;
PaperBridge.Notes.filenameForItem(mockItem).then(async filename => {
  await runBootstrapLifecycleTests();
  await runBootstrapLifecycleTests({ failStart: true });
  await runBootstrapUnregisterFailureTest();
  await runBootstrapCleanupFailureTest();
  await runPaperBridgeStopCleanupTest();
  await runPaperBridgeStartupResilienceTest();
  const registeredMenus = [];
  let unregisteredMenuID = "";
  context.Zotero.MenuManager = {
    registerMenu(options) {
      registeredMenus.push(options);
      return "paperbridge-menu-registration";
    },
    unregisterMenu(menuID) {
      unregisteredMenuID = menuID;
    }
  };
  assert.strictEqual(PaperBridge.Menus.register(), true);
  assert.strictEqual(PaperBridge.Menus.register(), true);
  assert.strictEqual(registeredMenus.length, 1);
  assert.strictEqual(registeredMenus[0].target, "main/menubar/tools");
  assert.strictEqual(registeredMenus[0].pluginID, PaperBridge.id);
  assert.strictEqual(registeredMenus[0].menus[0].menuType, "submenu");
  assert.strictEqual(registeredMenus[0].menus[0].l10nID, "paperbridge-menu-root");
  assert.strictEqual(registeredMenus[0].menus[0].menus.length, PaperBridge.Menus.menuItems().length);
  assert.ok(registeredMenus[0].menus[0].menus.every(menu => menu.menuType === "menuitem" && menu.l10nID.startsWith("paperbridge-menu-")));
  PaperBridge.Menus.unregister();
  assert.strictEqual(unregisteredMenuID, "paperbridge-menu-registration");
  context.Zotero.MenuManager = {
    registerMenu() {
      throw new Error("menu manager failed");
    }
  };
  const throwingMenuWindow = createFakeMenuWindow();
  PaperBridge.Menus.addToWindow(throwingMenuWindow.window);
  assert.strictEqual(throwingMenuWindow.toolsPopup.children.length, 1);
  assert.strictEqual(throwingMenuWindow.toolsPopup.children[0].id, "paperbridge-tools-menu");
  PaperBridge.Menus.removeFromWindow(throwingMenuWindow.window);
  assert.strictEqual(PaperBridge.Menus.registeredMenuID, null);
  delete context.Zotero.MenuManager;

  const fakeMenuWindow = createFakeMenuWindow();
  PaperBridge.Menus.addToWindow(fakeMenuWindow.window);
  PaperBridge.Menus.addToWindow(fakeMenuWindow.window);
  assert.strictEqual(fakeMenuWindow.toolsPopup.children.length, 1);
  assert.strictEqual(fakeMenuWindow.toolsPopup.children[0].id, "paperbridge-tools-menu");
  const fallbackPopup = fakeMenuWindow.elements.get("paperbridge-tools-menu-popup");
  assert.strictEqual(fallbackPopup.children.length, PaperBridge.Menus.menuItems(fakeMenuWindow.window).length);
  assert.ok(fallbackPopup.children.some(item => item.id === "paperbridge-scan-markdown-root" && item.attributes.label === "PaperBridge: 扫描 Markdown 并重连"));
  PaperBridge.Menus.removeFromWindow(fakeMenuWindow.window);
  assert.strictEqual(PaperBridge.Menus.addedElementIDs.has(fakeMenuWindow.window), false);
  assert.strictEqual(fakeMenuWindow.elements.has("paperbridge-tools-menu"), false);
  assert.ok(fakeMenuWindow.removed.includes("paperbridge-tools-menu"));

  const delayedMenuWindow = createFakeMenuWindow();
  delayedMenuWindow.elements.delete("menu_ToolsPopup");
  PaperBridge.Menus.addToWindow(delayedMenuWindow.window);
  assert.strictEqual(PaperBridge.Menus.addedElementIDs.has(delayedMenuWindow.window), false);
  delayedMenuWindow.elements.set("menu_ToolsPopup", delayedMenuWindow.toolsPopup);
  PaperBridge.Menus.addToWindow(delayedMenuWindow.window);
  assert.strictEqual(delayedMenuWindow.toolsPopup.children.length, 1);
  PaperBridge.Menus.removeFromWindow(delayedMenuWindow.window);

  const staleMenuWindow = createFakeMenuWindow();
  const staleMenu = staleMenuWindow.document.createXULElement("menu");
  staleMenu.id = "paperbridge-tools-menu";
  staleMenuWindow.toolsPopup.appendChild(staleMenu);
  delete staleMenuWindow.document.createXULElement;
  PaperBridge.Menus.addToWindow(staleMenuWindow.window);
  assert.ok(staleMenuWindow.removed.includes("paperbridge-tools-menu"));
  assert.strictEqual(staleMenuWindow.toolsPopup.children.length, 1);
  assert.strictEqual(staleMenuWindow.toolsPopup.children[0].id, "paperbridge-tools-menu");
  PaperBridge.Menus.removeFromWindow(staleMenuWindow.window);

  const originalFetch = context.fetch;
  let abortedFetch = false;
  let timeoutFetchOptions = null;
  context.fetch = (url, options = {}) => new Promise((resolve, reject) => {
    timeoutFetchOptions = options;
    options.signal?.addEventListener("abort", () => {
      abortedFetch = true;
      reject(new Error("aborted"));
    });
  });
  await assert.rejects(
    () => PaperBridge.Tray.fetchWithTimeout("http://127.0.0.1:9/ping", { cache: "no-store" }, 5),
    /aborted/
  );
  assert.strictEqual(abortedFetch, true);
  assert.strictEqual(timeoutFetchOptions.cache, "no-store");
  assert.ok(timeoutFetchOptions.signal);

  let commandURL = "";
  context.fetch = async url => {
    commandURL = url;
    return {
      ok: true,
      async text() {
        return "PaperBridge:OK";
      }
    };
  };
  prefs.set("extensions.paperbridge.trayToken", "tray token");
  assert.strictEqual(await PaperBridge.Tray.sendCommand("show", 1), true);
  assert.ok(commandURL.includes("/show?token=tray%20token"));
  prefs.set("extensions.paperbridge.trayToken", "");
  context.fetch = originalFetch;

  observerRegistrations.length = 0;
  observerRemovals.length = 0;
  PaperBridge.Tray.allowQuit = true;
  PaperBridge.Tray.quitObserver = null;
  PaperBridge.Tray.start();
  assert.strictEqual(PaperBridge.Tray.allowQuit, false);
  assert.deepStrictEqual(observerRegistrations.map(entry => entry.topic), ["quit-application-granted", "quit-application"]);
  let trayClosePrevented = false;
  let trayCloseStopped = false;
  let trayHideCalled = false;
  const originalIsWin = context.Zotero.isWin;
  const originalHideWindow = PaperBridge.Tray.hideWindow;
  prefs.set("extensions.paperbridge.closeToTray", "true");
  context.Zotero.isWin = true;
  PaperBridge.Tray.hideWindow = async () => {
    trayHideCalled = true;
  };
  PaperBridge.Tray.onClose({
    preventDefault() {
      trayClosePrevented = true;
    },
    stopPropagation() {
      trayCloseStopped = true;
    }
  }, {});
  assert.strictEqual(trayClosePrevented, true);
  assert.strictEqual(trayCloseStopped, true);
  assert.strictEqual(trayHideCalled, true);
  PaperBridge.Tray.quitObserver.observe(null, "quit-application-granted");
  trayClosePrevented = false;
  trayCloseStopped = false;
  trayHideCalled = false;
  PaperBridge.Tray.onClose({
    preventDefault() {
      trayClosePrevented = true;
    },
    stopPropagation() {
      trayCloseStopped = true;
    }
  }, {});
  assert.strictEqual(trayClosePrevented, false);
  assert.strictEqual(trayCloseStopped, false);
  assert.strictEqual(trayHideCalled, false);
  await PaperBridge.Tray.stop();
  assert.deepStrictEqual(observerRemovals.map(entry => entry.topic), ["quit-application-granted", "quit-application"]);
  assert.strictEqual(PaperBridge.Tray.quitObserver, null);
  assert.strictEqual(PaperBridge.Tray.allowQuit, false);
  PaperBridge.Tray.hideWindow = originalHideWindow;
  context.Zotero.isWin = originalIsWin;
  prefs.set("extensions.paperbridge.closeToTray", "false");

  assert.strictEqual(filename, "doe2024_a - A Study On Invalid Windows Names.md");
  assert.strictEqual(PaperBridge.Util.filenameWithNumericSuffix("a".repeat(20), ".md", 2, 12), "aaaaa (2).md");
  const maxLengthFilename = `${"a".repeat(PaperBridge.Settings.maxFilenameLength() - 3)}.md`;
  pathTypes.set(`D:\\Papers\\${maxLengthFilename}`, "regular");
  const nextUniquePath = await PaperBridge.Util.uniquePath("D:\\Papers", maxLengthFilename);
  const nextUniqueBasename = path.win32.basename(nextUniquePath);
  assert.strictEqual(nextUniqueBasename.length, PaperBridge.Settings.maxFilenameLength());
  assert.ok(nextUniqueBasename.endsWith(" (2).md"));

  attachmentByID.set(100, {
    isAttachment: () => true,
    getField: () => "Unrelated Markdown",
    getFilePath: () => "D:\\Papers\\Other.md"
  });
  attachmentByID.set(101, {
    isAttachment: () => true,
    getField: () => "Markdown Reading Note",
    getFilePath: () => "D:\\Papers\\Note.md"
  });
  fileContentsByPath.set("D:\\Papers\\Note.md", [
    "---",
    'title: "A Study"',
    'citekey: "doe2024_a"',
    'zotero_key: "ABCD1234"',
    'collection: "Inbox"',
    'primary_collection: "Inbox"',
    'status: unread',
    'zotero: "zotero://select/library/items/ABCD1234"',
    'created: "2026-05-30"',
    'updated: "2026-05-31"',
    "---",
    "",
    "Body"
  ].join("\n"));
  assert.strictEqual(PaperBridge.Notes.getNoteAttachment(mockItem), attachmentByID.get(101));
  assert.strictEqual(PaperBridge.ItemPane.summaryForItem(mockItem), "Note M / Rank 1");
  assert.deepStrictEqual(plain(PaperBridge.ItemPane.rowsForItem(mockItem)), [
    {
      label: "Note",
      labelL10nID: "paperbridge-item-pane-row-note",
      value: "Ready",
      valueL10nID: "paperbridge-item-pane-note-ready"
    },
    {
      label: "Path",
      labelL10nID: "paperbridge-item-pane-row-path",
      value: "D:\\Papers\\Note.md",
      valueL10nID: ""
    },
    {
      label: "Rank",
      labelL10nID: "paperbridge-item-pane-row-rank",
      value: "1"
    },
    {
      label: "Status",
      labelL10nID: "paperbridge-item-pane-row-status",
      value: "-"
    }
  ]);
  let itemPaneOptions = null;
  let unregisteredPaneID = null;
  let insertedFTL = "";
  context.Zotero.ItemPaneManager = {
    registerSection(options) {
      itemPaneOptions = options;
      return "paperbridge-paperbridge";
    },
    unregisterSection(paneID) {
      unregisteredPaneID = paneID;
      return true;
    }
  };
  PaperBridge.id = "paperbridge@example.com";
  PaperBridge.rootURI = "resource://paperbridge/";
  assert.strictEqual(PaperBridge.ItemPane.register(), true);
  assert.strictEqual(itemPaneOptions.paneID, "paperbridge");
  assert.strictEqual(itemPaneOptions.pluginID, "paperbridge@example.com");
  assert.strictEqual(itemPaneOptions.header.icon, "resource://paperbridge/icons/paperbridge-16.svg");
  assert.strictEqual(itemPaneOptions.sidenav.icon, "resource://paperbridge/icons/paperbridge-20.svg");
  itemPaneOptions.onItemChange({
    doc: {
      defaultView: {
        MozXULElement: {
          insertFTLIfNeeded(name) {
            insertedFTL = name;
          }
        }
      }
    },
    item: mockItem,
    setEnabled(value) {
      assert.strictEqual(value, true);
    },
    setSectionSummary(value) {
      assert.strictEqual(value, "Note M / Rank 1");
    }
  });
  assert.strictEqual(insertedFTL, "paperbridge.ftl");
  const l10nAttributes = [];
  const testDoc = {
    l10n: {
      setAttributes(element, id) {
        element.attributes["data-l10n-id"] = id;
        l10nAttributes.push(id);
      }
    },
    createElement(tagName) {
      let textContent = "";
      return {
        tagName,
        attributes: {},
        children: [],
        listeners: {},
        className: "",
        title: "",
        disabled: false,
        parentElement: null,
        get textContent() {
          return textContent;
        },
        set textContent(value) {
          textContent = String(value || "");
          if (!textContent) {
            this.children = [];
          }
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        append(...children) {
          for (const child of children) {
            this.appendChild(child);
          }
        },
        appendChild(child) {
          child.parentElement = this;
          this.children.push(child);
          return child;
        },
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },
        closest(selector) {
          if (selector === ".paperbridge-pane") {
            let current = this;
            while (current) {
              if (String(current.className || "").split(/\s+/).includes("paperbridge-pane")) {
                return current;
              }
              current = current.parentElement;
            }
          }
          return null;
        }
      };
    }
  };
  const testBody = testDoc.createElement("div");
  itemPaneOptions.onRender({
    doc: testDoc,
    body: testBody,
    item: mockItem,
    setEnabled() {},
    setSectionSummary() {}
  });
  assert.ok(l10nAttributes.includes("paperbridge-item-pane-row-note"));
  assert.ok(l10nAttributes.includes("paperbridge-item-pane-note-ready"));
  assert.ok(l10nAttributes.includes("paperbridge-item-pane-action-open-create"));
  const originalHandleNoteClickForPane = PaperBridge.Notes.handleNoteClick;
  const originalRefreshColumnsForPane = PaperBridge.Util.refreshItemTreeColumns;
  const paneActions = testBody.children[0].children[1];
  const openCreateButton = paneActions.children[0];
  const paneEvents = [];
  PaperBridge.Notes.handleNoteClick = async itemID => paneEvents.push(`open:${itemID}`);
  PaperBridge.Util.refreshItemTreeColumns = () => paneEvents.push("refresh-columns");
  await openCreateButton.listeners.click({
    preventDefault() {
      paneEvents.push("prevent");
    }
  });
  assert.strictEqual(openCreateButton.disabled, true);
  assert.deepStrictEqual(paneEvents, ["prevent", "open:42", "refresh-columns"]);
  assert.strictEqual(testBody.children.length, 1);
  assert.ok(testBody.children[0].children[1].children[0].listeners.click);
  PaperBridge.Notes.handleNoteClick = originalHandleNoteClickForPane;
  PaperBridge.Util.refreshItemTreeColumns = originalRefreshColumnsForPane;
  PaperBridge.ItemPane.unregister();
  assert.strictEqual(unregisteredPaneID, "paperbridge-paperbridge");
  context.Zotero.ItemPaneManager = {
    registerSection() {
      return "paperbridge-throwing-pane";
    },
    unregisterSection() {
      throw new Error("item pane unregister failed");
    }
  };
  assert.strictEqual(PaperBridge.ItemPane.register(), true);
  assert.doesNotThrow(() => PaperBridge.ItemPane.unregister());
  assert.strictEqual(PaperBridge.ItemPane.registeredID, null);

  const bulkRegularItem = Object.assign({}, mockItem, {
    id: 610,
    key: "BULK610",
    getAttachments() {
      return [];
    }
  });
  const bulkDeletedItem = Object.assign({}, bulkRegularItem, {
    id: 611,
    key: "BULK611",
    deleted: true
  });
  const bulkNonRegularItem = {
    id: 612,
    deleted: false,
    isRegularItem() {
      return false;
    }
  };
  zoteroItemsByID.set(610, bulkRegularItem);
  zoteroItemsByID.set(611, bulkDeletedItem);
  zoteroItemsByID.set(612, bulkNonRegularItem);
  assert.deepStrictEqual(
    plain((await PaperBridge.Bulk.regularItemsFromCollection({
      getChildItems() {
        return [bulkRegularItem, bulkDeletedItem, bulkNonRegularItem];
      }
    })).map(item => item.id)),
    [610]
  );
  assert.deepStrictEqual(
    plain((await PaperBridge.Bulk.regularItemsFromCollection({
      async getChildItems() {
        return ["610", 611, 612, "bad", 0];
      }
    })).map(item => item.id)),
    [610]
  );

  const originalMarkdownAttachment = attachmentByID.get(101);
  const existingMarkdownAttachment = {
    title: "Markdown Reading Note",
    attachmentPath: "D:\\Papers\\Existing Attachment.md",
    attachmentContentType: "text/plain",
    isAttachment() {
      return true;
    },
    getField(field) {
      return field === "title" ? this.title : "";
    },
    setField(field, value) {
      if (field === "title") {
        this.title = value;
      }
    },
    getFilePath() {
      return this.attachmentPath;
    },
    async saveTx() {
      throw new Error("attachment save failed");
    }
  };
  attachmentByID.set(101, existingMarkdownAttachment);
  await assert.rejects(
    () => PaperBridge.Notes.attachMarkdownNote(mockItem, "D:\\Papers\\New Attachment.md"),
    /attachment save failed/
  );
  assert.strictEqual(existingMarkdownAttachment.title, "Markdown Reading Note");
  assert.strictEqual(existingMarkdownAttachment.attachmentPath, "D:\\Papers\\Existing Attachment.md");
  assert.strictEqual(existingMarkdownAttachment.attachmentContentType, "text/plain");
  attachmentByID.set(101, originalMarkdownAttachment);

  const registeredColumns = [];
  const unregisteredColumns = [];
  context.Zotero.ItemTreeManager = {
    async registerColumn(options) {
      registeredColumns.push(options);
      return `registered-${options.dataKey}`;
    },
    async unregisterColumn(key) {
      unregisteredColumns.push(key);
      return true;
    }
  };
  await PaperBridge.Columns.register();
  await PaperBridge.Columns.register();
  assert.deepStrictEqual(registeredColumns.map(column => column.dataKey), ["paperbridge-note", "paperbridge-rank"]);
  assert.deepStrictEqual(registeredColumns.map(column => column.label), ["笔记", "等级"]);
  assert.deepStrictEqual(registeredColumns.map(column => column.pluginID), [PaperBridge.id, PaperBridge.id]);
  assert.strictEqual(registeredColumns[0].dataProvider(mockItem), "42|M");
  assert.strictEqual(registeredColumns[1].dataProvider(mockItem), "42|1");
  await PaperBridge.Columns.unregister();
  assert.deepStrictEqual(unregisteredColumns, ["registered-paperbridge-note", "registered-paperbridge-rank"]);
  PaperBridge.Columns.registeredKeys = ["registered-paperbridge-note", "registered-paperbridge-rank"];
  const throwingUnregisteredColumns = [];
  context.Zotero.ItemTreeManager = {
    async unregisterColumn(key) {
      throwingUnregisteredColumns.push(key);
      if (key === "registered-paperbridge-note") {
        throw new Error("unregister note failed");
      }
    }
  };
  await assert.rejects(() => PaperBridge.Columns.unregister(), /unregister note failed/);
  assert.deepStrictEqual(throwingUnregisteredColumns, ["registered-paperbridge-note", "registered-paperbridge-rank"]);
  assert.deepStrictEqual(plain(PaperBridge.Columns.registeredKeys), []);
  const rollbackRegisteredColumns = [];
  const rollbackUnregisteredColumns = [];
  context.Zotero.ItemTreeManager = {
    async registerColumn(options) {
      rollbackRegisteredColumns.push(options.dataKey);
      if (options.dataKey === "paperbridge-rank") {
        throw new Error("rank column failed");
      }
      return `registered-${options.dataKey}`;
    },
    async unregisterColumn(key) {
      rollbackUnregisteredColumns.push(key);
      return true;
    }
  };
  await assert.rejects(() => PaperBridge.Columns.register(), /rank column failed/);
  assert.deepStrictEqual(rollbackRegisteredColumns, ["paperbridge-note", "paperbridge-rank"]);
  assert.deepStrictEqual(rollbackUnregisteredColumns, ["registered-paperbridge-note"]);
  assert.deepStrictEqual(plain(PaperBridge.Columns.registeredKeys), []);
  delete context.Zotero.ItemTreeManager;

  const originalGetSelectedRegularItems = PaperBridge.Util.getSelectedRegularItems;
  const originalSetRankForSelected = PaperBridge.Ranks.setRankForSelected;
  const originalHandleNoteClick = PaperBridge.Notes.handleNoteClick;
  const shortcutActions = [];
  const itemTreeTarget = {
    tagName: "div",
    id: "",
    isContentEditable: false,
    closest(selector) {
      return selector.includes("item-tree") ? {} : null;
    }
  };
  const nonItemTreeTarget = {
    tagName: "div",
    id: "",
    isContentEditable: false,
    closest() {
      return null;
    }
  };
  const shortcutEvent = overrides => Object.assign({
    key: "1",
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: itemTreeTarget,
    preventDefault() {
      shortcutActions.push("prevent");
    },
    stopPropagation() {
      shortcutActions.push("stop");
    }
  }, overrides || {});
  PaperBridge.Util.getSelectedRegularItems = () => [mockItem];
  PaperBridge.Ranks.setRankForSelected = async rank => shortcutActions.push(`rank:${rank}`);
  PaperBridge.Notes.handleNoteClick = async itemID => shortcutActions.push(`note:${itemID}`);
  for (const event of [
    shortcutEvent({ defaultPrevented: true }),
    shortcutEvent({ isComposing: true }),
    shortcutEvent({ repeat: true }),
    shortcutEvent({ ctrlKey: true }),
    shortcutEvent({ target: { tagName: "input" } }),
    shortcutEvent({ target: nonItemTreeTarget }),
    shortcutEvent({
      target: {
        tagName: "span",
        closest() {
          return {};
        }
      }
    })
  ]) {
    PaperBridge.Shortcuts.onKeyDown(event);
  }
  assert.deepStrictEqual(shortcutActions, []);
  PaperBridge.Shortcuts.onKeyDown(shortcutEvent({ key: "2" }));
  PaperBridge.Shortcuts.onKeyDown(shortcutEvent({ key: "X", shiftKey: true }));
  PaperBridge.Shortcuts.onKeyDown(shortcutEvent({ key: "m" }));
  PaperBridge.Shortcuts.onKeyDown(shortcutEvent({
    key: "3",
    target: nonItemTreeTarget,
    composedPath() {
      return [nonItemTreeTarget, { id: "item-tree-main-default" }];
    }
  }));
  PaperBridge.Shortcuts.onKeyDown(shortcutEvent({
    key: "4",
    target: nonItemTreeTarget,
    view: {
      ZoteroPane: {
        itemsView: {
          isFocused() {
            return true;
          }
        }
      }
    }
  }));
  await Promise.resolve();
  assert.deepStrictEqual(shortcutActions, [
    "prevent", "stop", "rank:2",
    "prevent", "stop", "rank:x",
    "prevent", "stop", "note:42",
    "prevent", "stop", "rank:3",
    "prevent", "stop", "rank:4"
  ]);
  PaperBridge.Util.getSelectedRegularItems = originalGetSelectedRegularItems;
  PaperBridge.Ranks.setRankForSelected = originalSetRankForSelected;
  PaperBridge.Notes.handleNoteClick = originalHandleNoteClick;

  const pdfAttachment = {
    id: 150,
    key: "PDFKEY1",
    libraryID: 1,
    attachmentContentType: "application/pdf",
    isAttachment: () => true,
    getField(field) {
      return field === "title" ? "Main PDF" : "";
    },
    getFilePath() {
      return "D:\\Papers\\Paper.pdf";
    },
    getAnnotations() {
      return [151, 152, 155];
    }
  };
  const supplementAttachment = {
    id: 153,
    key: "PDF KEY3",
    libraryID: 1,
    attachmentContentType: "application/pdf",
    isAttachment: () => true,
    getField(field) {
      return field === "title" ? "Supplement PDF" : "";
    },
    getFilePath() {
      return "D:\\Papers\\Supplement.pdf";
    },
    getAnnotations() {
      return [154];
    }
  };
  attachmentByID.set(150, pdfAttachment);
  attachmentByID.set(153, supplementAttachment);
  attachmentByID.set(151, {
    id: 151,
    key: "ANN1",
    itemType: "annotation",
    annotationType: "highlight",
    annotationText: "Important [quoted] text",
    annotationComment: "Check this",
    annotationColor: "#ffd400",
    annotationPageLabel: "4",
    annotationSortIndex: "00004|000010|00000",
    getTags() {
      return [{ tag: "key-point" }];
    }
  });
  attachmentByID.set(152, {
    id: 152,
    key: "ANN2",
    itemType: "annotation",
    annotationType: "note",
    annotationText: "",
    annotationComment: "Standalone note\nsecond line [check]",
    annotationColor: "#5fb236",
    annotationPageLabel: "5",
    annotationSortIndex: "00005|000020|00000",
    getTags() {
      return [];
    }
  });
  attachmentByID.set(154, {
    id: 154,
    key: "ANN3",
    itemType: "annotation",
    annotationType: "highlight",
    annotationText: "Supplement note",
    annotationComment: "",
    annotationColor: "#ff6666",
    annotationPageLabel: "A]1",
    annotationSortIndex: "00001|000001|00000",
    getTags() {
      return [];
    }
  });
  attachmentByID.set(155, {
    id: 155,
    itemTypeName: "annotation",
    annotationKey: "ANNFIELD",
    getField(field) {
      return {
        annotationType: "underline",
        annotationText: "Getter backed text",
        annotationComment: "Getter backed comment",
        annotationColor: "#2ea8e5",
        annotationPageLabel: "6",
        annotationSortIndex: "00006|000030|00000",
        parentItemKey: "PDFKEY1"
      }[field] || "";
    },
    getTags() {
      return ["getter-tag", { tag: "field-tag" }];
    }
  });
  const annotatedItem = Object.assign({}, mockItem, {
    getAttachments() {
      return [150, 153];
    }
  });
  const annotationEntries = await PaperBridge.Annotations.annotationsForItem(annotatedItem);
  assert.strictEqual(annotationEntries.length, 4);
  const annotationSection = PaperBridge.Annotations.renderAnnotationSection(annotatedItem, annotationEntries);
  assert.ok(annotationSection.includes("## Zotero PDF Annotations"));
  assert.ok(annotationSection.includes("### Main PDF"));
  assert.ok(annotationSection.indexOf("### Main PDF") < annotationSection.indexOf("### Supplement PDF"));
  assert.ok(annotationSection.includes("[p. 4](zotero://open-pdf/library/items/PDFKEY1?page=4&annotation=ANN1)"));
  assert.ok(annotationSection.includes("[p. 6](zotero://open-pdf/library/items/PDFKEY1?page=6&annotation=ANNFIELD)"));
  assert.ok(annotationSection.includes("[p. A\\]1](zotero://open-pdf/library/items/PDF%20KEY3?page=A%5D1&annotation=ANN3)"));
  assert.ok(annotationSection.includes("> Important \\[quoted\\] text"));
  assert.ok(annotationSection.includes("> Getter backed text"));
  assert.ok(annotationSection.includes("Note: Check this"));
  assert.ok(annotationSection.includes("Note: Standalone note\n    second line \\[check\\]"));
  assert.ok(annotationSection.includes("Note: Getter backed comment"));
  assert.ok(annotationSection.includes("Tags: #key-point"));
  assert.ok(annotationSection.includes("Tags: #getter-tag #field-tag"));
  const annotatedOnce = PaperBridge.Annotations.updateAnnotationSection("Intro", annotationSection);
  const annotatedTwice = PaperBridge.Annotations.updateAnnotationSection(annotatedOnce, annotationSection.replace("Check this", "Updated comment"));
  assert.strictEqual((annotatedTwice.match(/PaperBridge Annotations: BEGIN/g) || []).length, 1);
  assert.ok(annotatedTwice.includes("Updated comment"));
  const brokenAnnotated = PaperBridge.Annotations.updateAnnotationSection(
    "Intro\n\n<!-- PaperBridge Annotations: BEGIN -->\nstale annotation text",
    annotationSection
  );
  assert.strictEqual((brokenAnnotated.match(/PaperBridge Annotations: BEGIN/g) || []).length, 1);
  assert.strictEqual((brokenAnnotated.match(/PaperBridge Annotations: END/g) || []).length, 1);
  assert.ok(!brokenAnnotated.includes("stale annotation text"));
  const orphanEndAnnotated = PaperBridge.Annotations.updateAnnotationSection(
    "Intro\n\n## Zotero PDF Annotations\nstale annotation text\n<!-- PaperBridge Annotations: END -->\n\nOutro",
    annotationSection
  );
  assert.strictEqual((orphanEndAnnotated.match(/PaperBridge Annotations: BEGIN/g) || []).length, 1);
  assert.strictEqual((orphanEndAnnotated.match(/PaperBridge Annotations: END/g) || []).length, 1);
  assert.ok(!orphanEndAnnotated.includes("stale annotation text"));
  assert.ok(orphanEndAnnotated.includes("Intro"));
  assert.ok(orphanEndAnnotated.includes("Outro"));
  const childItemsOnlyAttachment = Object.assign({}, pdfAttachment, {
    id: 156,
    key: "PDFKEYCHILD",
    getAnnotations: undefined,
    async getChildItems() {
      return ["151", 155, "bad", 0];
    }
  });
  const childItemAnnotations = await PaperBridge.Annotations.annotationsForAttachment(childItemsOnlyAttachment);
  assert.deepStrictEqual(plain(childItemAnnotations.map(annotation => annotation.key || annotation.annotationKey)), ["ANN1", "ANNFIELD"]);
  searchIDs = [151, 152];
  const searchOnlyAttachment = Object.assign({}, pdfAttachment, {
    id: 160,
    key: "PDFKEY2",
    getAnnotations: undefined
  });
  attachmentByID.set(151, Object.assign({}, attachmentByID.get(151), {
    parentID: 160
  }));
  attachmentByID.set(152, Object.assign({}, attachmentByID.get(152), {
    parentID: 999
  }));
  const searchFallbackAnnotations = await PaperBridge.Annotations.annotationsForAttachment(searchOnlyAttachment);
  assert.strictEqual(searchFallbackAnnotations.length, 1);
  assert.strictEqual(searchFallbackAnnotations[0].key, "ANN1");
  searchIDs = [];

  const originalSearch = context.Zotero.Search;
  let fallbackLibraryID = null;
  context.Zotero.Search = function () {
    Object.defineProperty(this, "libraryID", {
      get() {
        return fallbackLibraryID;
      },
      set(value) {
        fallbackLibraryID = value;
      }
    });
    this.addCondition = function () {};
    this.search = async function () {
      return [154];
    };
  };
  const noLibraryAttachment = Object.assign({}, supplementAttachment, {
    id: 170,
    key: "PDFKEY4",
    libraryID: undefined,
    getAnnotations: undefined
  });
  attachmentByID.set(154, Object.assign({}, attachmentByID.get(154), {
    parentID: 170
  }));
  const noLibraryFallbackAnnotations = await PaperBridge.Annotations.annotationsForAttachment(noLibraryAttachment);
  assert.strictEqual(fallbackLibraryID, context.Zotero.Libraries.userLibraryID);
  assert.strictEqual(noLibraryFallbackAnnotations.length, 1);
  context.Zotero.Search = originalSearch;

  attachmentByID.set(101, {
    isAttachment: () => true,
    getField: () => "Other Title",
    getFilePath: () => "D:\\Papers\\Note.md"
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    ABCD1234: { note_path: "D:/Papers/Note.md" }
  }));
  assert.strictEqual(PaperBridge.Notes.getNoteAttachment(mockItem), attachmentByID.get(101));
  assert.strictEqual(PaperBridge.Index.get(mockItem).note_path, "D:/Papers/Note.md");
  const indexedSameKeyGroupItem = Object.assign({}, mockItem, {
    id: 402,
    libraryID: 2
  });
  assert.strictEqual(PaperBridge.Index.get(indexedSameKeyGroupItem), null);
  PaperBridge.Index.set(indexedSameKeyGroupItem, { note_path: "D:/Papers/Group Note.md" });
  assert.strictEqual(PaperBridge.Index.get(indexedSameKeyGroupItem).note_path, "D:/Papers/Group Note.md");
  assert.strictEqual(JSON.parse(prefs.get("extensions.paperbridge.index"))["2:ABCD1234"].library_id, 2);
  assert.strictEqual(JSON.parse(prefs.get("extensions.paperbridge.index")).ABCD1234.note_path, "D:/Papers/Note.md");

  prefs.set("extensions.paperbridge.index", "[]");
  PaperBridge.Index.set(mockItem, { note_path: "D:/Papers/From Array Index.md" });
  assert.strictEqual(PaperBridge.Index.get(mockItem).note_path, "D:/Papers/From Array Index.md");
  assert.strictEqual(Array.isArray(JSON.parse(prefs.get("extensions.paperbridge.index"))), false);
  assert.strictEqual(JSON.parse(prefs.get("extensions.paperbridge.index"))["1:ABCD1234"].note_path, "D:/Papers/From Array Index.md");
  prefs.set("extensions.paperbridge.index", "{bad json");
  assert.doesNotThrow(() => PaperBridge.Index.get(mockItem));
  PaperBridge.Index.set(mockItem, { note_path: "D:/Papers/Recovered Index.md" });
  assert.strictEqual(PaperBridge.Index.get(mockItem).note_path, "D:/Papers/Recovered Index.md");

  prefs.set("extensions.paperbridge.index", "{}");
  assert.strictEqual(PaperBridge.Notes.getNoteAttachment(mockItem), null);

  const originalRunProcessForOpen = PaperBridge.Util.runProcess;
  const editorLaunches = [];
  prefs.set("extensions.paperbridge.markdownEditorPath", "D:\\Apps\\Typora.exe");
  launchedFiles.length = 0;
  PaperBridge.Util.runProcess = (executablePath, args, blocking) => {
    editorLaunches.push({ executablePath, args, blocking });
  };
  await PaperBridge.Notes.openPath("D:\\Papers\\Open.md");
  assert.deepStrictEqual(plain(editorLaunches), [{
    executablePath: "D:\\Apps\\Typora.exe",
    args: ["D:\\Papers\\Open.md"],
    blocking: false
  }]);
  assert.deepStrictEqual(launchedFiles, []);
  editorLaunches.length = 0;
  PaperBridge.Util.runProcess = () => {
    throw new Error("editor launch failed");
  };
  await PaperBridge.Notes.openPath("D:\\Papers\\Fallback.md");
  assert.deepStrictEqual(launchedFiles, ["D:\\Papers\\Fallback.md"]);
  prefs.set("extensions.paperbridge.markdownEditorPath", "");
  PaperBridge.Util.runProcess = originalRunProcessForOpen;

  const originalMarkdown = [
    "---",
    'title: "Old"',
    'collection: "Old Collection"',
    'primary_collection: "Old Collection"',
    'updated: "2026-05-30"',
    "---",
    "",
    "Body"
  ].join("\n");
  assert.strictEqual(
    PaperBridge.Notes.updateMarkdownFrontmatterContent(originalMarkdown, {
      collection: "New Collection",
      primary_collection: "New Collection",
      updated: "2026-05-31"
    }),
    [
      "---",
      'title: "Old"',
      'collection: "New Collection"',
      'primary_collection: "New Collection"',
      'updated: "2026-05-31"',
      "---",
      "",
      "Body"
    ].join("\n")
  );

  const noFrontmatter = PaperBridge.Notes.updateMarkdownFrontmatterContent("Body only", {
    primary_collection: "Inbox"
  });
  assert.ok(noFrontmatter.startsWith('---\nprimary_collection: "Inbox"\n---\n\nBody only'));

  const bomFrontmatter = [
    "\uFEFF--- ",
    "title: 'Bob''s Paper'",
    'citekey: "doe2024_a"',
    'zotero_key: "ABCD1234"',
    "collection: Inbox",
    "primary_collection: Inbox",
    "status: unread",
    'zotero: "zotero://select/library/items/ABCD1234"',
    'created: "2026-05-30"',
    'updated: "2026-05-31"',
    "---   ",
    "",
    "Body"
  ].join("\n");
  assert.strictEqual(PaperBridge.Notes.parseFrontmatter(bomFrontmatter).title, "Bob's Paper");
  assert.deepStrictEqual(
    plain(PaperBridge.Notes.validateFrontmatterContent(bomFrontmatter, { key: "ABCD1234" })),
    {
      ok: true,
      missingKeys: [],
      mismatchedKeys: []
    }
  );
  const originalGroupsForFrontmatterValidation = context.Zotero.Groups;
  context.Zotero.Groups = {
    get(groupID) {
      return Number(groupID) === 22 ? { groupID: 22, libraryID: 2 } : null;
    }
  };
  const wrongLibraryFrontmatter = bomFrontmatter.replace(
    'zotero: "zotero://select/library/items/ABCD1234"',
    'zotero: "zotero://select/groups/22/items/ABCD1234"'
  );
  assert.deepStrictEqual(
    plain(PaperBridge.Notes.validateFrontmatterContent(wrongLibraryFrontmatter, mockItem)),
    {
      ok: false,
      missingKeys: [],
      mismatchedKeys: ["zotero"]
    }
  );
  const unresolvedLibraryFrontmatter = bomFrontmatter.replace(
    'zotero: "zotero://select/library/items/ABCD1234"',
    'zotero: "zotero://select/groups/999/items/ABCD1234"'
  );
  assert.deepStrictEqual(
    plain(PaperBridge.Notes.validateFrontmatterContent(unresolvedLibraryFrontmatter, mockItem)),
    {
      ok: false,
      missingKeys: [],
      mismatchedKeys: ["zotero"]
    }
  );
  assert.throws(
    () => PaperBridge.Notes.assertFrontmatterBelongsToItem(
      PaperBridge.Notes.parseFrontmatter(unresolvedLibraryFrontmatter),
      mockItem
    ),
    /unknown Zotero library/
  );
  const wrongURIItemFrontmatter = bomFrontmatter.replace(
    'zotero: "zotero://select/library/items/ABCD1234"',
    'zotero: "zotero://select/library/items/OTHERKEY"'
  );
  assert.deepStrictEqual(
    plain(PaperBridge.Notes.validateFrontmatterContent(wrongURIItemFrontmatter, mockItem)),
    {
      ok: false,
      missingKeys: [],
      mismatchedKeys: ["zotero"]
    }
  );
  const wrongLibraryStatePath = "D:\\Papers\\Wrong Library State.md";
  attachmentByID.set(101, {
    isAttachment: () => true,
    getField: () => "Markdown Reading Note",
    getFilePath: () => wrongLibraryStatePath
  });
  fileContentsByPath.set(wrongLibraryStatePath, wrongLibraryFrontmatter);
  assert.strictEqual(PaperBridge.Notes.getNoteState(mockItem), PaperBridge.Constants.noteStates.missing);
  context.Zotero.Groups = originalGroupsForFrontmatterValidation;
  const updatedBOMFrontmatter = PaperBridge.Notes.updateMarkdownFrontmatterContent(bomFrontmatter, {
    status: "read",
    updated: "2026-06-02"
  });
  assert.strictEqual(updatedBOMFrontmatter.split(/\r?\n/)[0], "---");
  assert.strictEqual(PaperBridge.Notes.parseFrontmatter(updatedBOMFrontmatter).status, "read");
  assert.strictEqual(PaperBridge.Notes.parseFrontmatter(updatedBOMFrontmatter).updated, "2026-06-02");

  assert.deepStrictEqual(
    plain(PaperBridge.Notes.validateFrontmatterContent(originalMarkdown, { key: "ABCD1234" })),
    {
      ok: false,
      missingKeys: ["citekey", "zotero_key", "status", "zotero", "created"],
      mismatchedKeys: []
    }
  );

  const validMarkdown = [
    "---",
    'title: "A Study"',
    'citekey: "doe2024_a"',
    'zotero_key: "ABCD1234"',
    'collection: "New Collection"',
    'primary_collection: "New Collection"',
    "status: unread",
    'zotero: "zotero://select/library/items/ABCD1234"',
    'created: "2026-05-30"',
    'updated: "2026-05-31"',
    "---",
    "",
    "Body"
  ].join("\n");
  assert.deepStrictEqual(
    plain(PaperBridge.Notes.validateFrontmatterContent(validMarkdown, { key: "ABCD1234" })),
    {
      ok: true,
      missingKeys: [],
      mismatchedKeys: []
    }
  );
  const markdownForKey = key => validMarkdown
    .replace('zotero_key: "ABCD1234"', `zotero_key: "${key}"`)
    .replace("zotero://select/library/items/ABCD1234", `zotero://select/library/items/${key}`);

  const repairUpdates = PaperBridge.Notes.frontmatterForItem(mockItem, { name: "New Collection" }, {
    created: "2026-05-30"
  });
  assert.strictEqual(repairUpdates.created, "2026-05-30");
  assert.strictEqual(repairUpdates.collection, "New Collection");
  assert.strictEqual(repairUpdates.primary_collection, "New Collection");
  assert.strictEqual(PaperBridge.Notes.frontmatterForItem(mixedStateItem, { name: "New Collection" }).status, "read");

  const conservativeRepairUpdates = PaperBridge.Notes.frontmatterForItem(mockItem, null, {
    collectionName: "Existing Collection",
    primaryCollectionName: "Existing Primary",
    status: "reading",
    created: "2026-01-01"
  });
  assert.strictEqual(conservativeRepairUpdates.collection, "Existing Collection");
  assert.strictEqual(conservativeRepairUpdates.primary_collection, "Existing Primary");
  assert.strictEqual(conservativeRepairUpdates.status, "reading");
  assert.strictEqual(conservativeRepairUpdates.created, "2026-01-01");

  const repairedRankContent = PaperBridge.Notes.updateMarkdownFrontmatterContent(validMarkdown, {
    rank: "2",
    updated: "2026-06-01"
  });
  assert.ok(repairedRankContent.includes('rank: "2"'));
  assert.ok(repairedRankContent.includes('updated: "2026-06-01"'));

  const duplicatedFrontmatter = [
    "---",
    "status: unread",
    "status: reading",
    "rank: 1",
    "rank: 4",
    "---",
    "",
    "Body"
  ].join("\n");
  const dedupedFrontmatter = PaperBridge.Notes.updateMarkdownFrontmatterContent(duplicatedFrontmatter, {
    status: "read",
    rank: "2"
  });
  assert.strictEqual((dedupedFrontmatter.match(/^status:/gm) || []).length, 1);
  assert.strictEqual((dedupedFrontmatter.match(/^rank:/gm) || []).length, 1);
  assert.strictEqual(PaperBridge.Notes.parseFrontmatter(dedupedFrontmatter).status, "read");
  assert.strictEqual(PaperBridge.Notes.parseFrontmatter(dedupedFrontmatter).rank, "2");

  const setRankTags = [
    { tag: "topic/ml" },
    { tag: "paperbridge/rank/1" },
    { tag: "paperbridge/rank/bad" }
  ];
  let setRankSaveCount = 0;
  const setRankItem = Object.assign({}, mockItem, {
    id: 171,
    key: "RANKSAVE",
    getTags() {
      return setRankTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!setRankTags.some(entry => entry.tag === tag)) {
        setRankTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = setRankTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        setRankTags.splice(index, 1);
      }
    },
    getAttachments() {
      return [];
    },
    async saveTx() {
      setRankSaveCount++;
    }
  });
  await PaperBridge.Ranks.setRank(setRankItem, "3");
  assert.deepStrictEqual(setRankTags.map(entry => entry.tag).sort(), ["paperbridge/rank/3", "topic/ml"]);
  assert.strictEqual(setRankSaveCount, 1);
  assert.strictEqual(PaperBridge.Index.get(setRankItem).rank, "3");

  const failedRankTags = [
    { tag: "topic/ml" },
    { tag: "paperbridge/rank/2" }
  ];
  const failedRankItem = Object.assign({}, mockItem, {
    id: 172,
    key: "RANKFAIL",
    getTags() {
      return failedRankTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!failedRankTags.some(entry => entry.tag === tag)) {
        failedRankTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = failedRankTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        failedRankTags.splice(index, 1);
      }
    },
    getAttachments() {
      return [];
    },
    async saveTx() {
      throw new Error("rank save failed");
    }
  });
  await assert.rejects(() => PaperBridge.Ranks.setRank(failedRankItem, "4"), /rank save failed/);
  assert.deepStrictEqual(failedRankTags.map(entry => entry.tag).sort(), ["paperbridge/rank/2", "topic/ml"]);
  assert.strictEqual(PaperBridge.Index.get(failedRankItem), null);

  const syncedTags = [
    { tag: "paperbridge/rank/1" },
    { tag: "paperbridge/status/unread" }
  ];
  let stateSaveCount = 0;
  const stateItem = Object.assign({}, mockItem, {
    getTags() {
      return syncedTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!syncedTags.some(entry => entry.tag === tag)) {
        syncedTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = syncedTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        syncedTags.splice(index, 1);
      }
    },
    async saveTx() {
      stateSaveCount++;
    }
  });
  assert.strictEqual(await PaperBridge.Ranks.applyFrontmatterState(stateItem, { rank: "2", status: "read" }), true);
  assert.deepStrictEqual(syncedTags.map(entry => entry.tag).sort(), ["paperbridge/rank/2", "paperbridge/status/read"]);
  assert.strictEqual(stateSaveCount, 1);
  assert.strictEqual(await PaperBridge.Ranks.applyFrontmatterState(stateItem, { rank: "bad", status: "unknown" }), false);
  assert.deepStrictEqual(syncedTags.map(entry => entry.tag).sort(), ["paperbridge/rank/2", "paperbridge/status/read"]);
  assert.strictEqual(await PaperBridge.Ranks.applyFrontmatterState(stateItem, { rank: "" }), true);
  assert.deepStrictEqual(syncedTags.map(entry => entry.tag).sort(), ["paperbridge/status/read"]);
  await PaperBridge.Ranks.ensureUnreadStatus(stateItem);
  assert.deepStrictEqual(syncedTags.map(entry => entry.tag).sort(), ["paperbridge/status/read"]);
  assert.strictEqual(stateSaveCount, 2);

  const failedStateTags = [
    { tag: "paperbridge/rank/1" },
    { tag: "paperbridge/status/unread" }
  ];
  const failedStateItem = Object.assign({}, mockItem, {
    id: 173,
    key: "STATEFAIL",
    getTags() {
      return failedStateTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!failedStateTags.some(entry => entry.tag === tag)) {
        failedStateTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = failedStateTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        failedStateTags.splice(index, 1);
      }
    },
    async saveTx() {
      throw new Error("state save failed");
    }
  });
  await assert.rejects(() => PaperBridge.Ranks.applyFrontmatterState(failedStateItem, { rank: "4", status: "read" }), /state save failed/);
  assert.deepStrictEqual(failedStateTags.map(entry => entry.tag).sort(), ["paperbridge/rank/1", "paperbridge/status/unread"]);
  assert.strictEqual(PaperBridge.Index.get(failedStateItem), null);

  const invalidStatusTags = [{ tag: "paperbridge/status/unknown" }];
  let unreadSaveCount = 0;
  const unreadItem = Object.assign({}, mockItem, {
    getTags() {
      return invalidStatusTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!invalidStatusTags.some(entry => entry.tag === tag)) {
        invalidStatusTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = invalidStatusTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        invalidStatusTags.splice(index, 1);
      }
    },
    async saveTx() {
      unreadSaveCount++;
    }
  });
  await PaperBridge.Ranks.ensureUnreadStatus(unreadItem);
  assert.deepStrictEqual(invalidStatusTags.map(entry => entry.tag), ["paperbridge/status/unread"]);
  assert.strictEqual(unreadSaveCount, 1);

  const failedUnreadTags = [{ tag: "paperbridge/status/unknown" }];
  const failedUnreadItem = Object.assign({}, mockItem, {
    id: 174,
    key: "UNREADFAIL",
    getTags() {
      return failedUnreadTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!failedUnreadTags.some(entry => entry.tag === tag)) {
        failedUnreadTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = failedUnreadTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        failedUnreadTags.splice(index, 1);
      }
    },
    async saveTx() {
      throw new Error("unread save failed");
    }
  });
  await assert.rejects(() => PaperBridge.Ranks.ensureUnreadStatus(failedUnreadItem), /unread save failed/);
  assert.deepStrictEqual(failedUnreadTags.map(entry => entry.tag), ["paperbridge/status/unknown"]);

  const queueItem1 = Object.assign({}, mockItem, {
    id: 201,
    key: "QUEUE01",
    firstCreator: "Ada",
    getField(field) {
      return {
        title: "Core [Queue] Paper",
        date: "2026",
        extra: ""
      }[field] || "";
    },
    getTags() {
      return [{ tag: "paperbridge/rank/1" }];
    },
    getAttachments() {
      return [];
    }
  });
  const queueItem2 = Object.assign({}, mockItem, {
    id: 202,
    key: "QUEUE02",
    firstCreator: "Babbage",
    getField(field) {
      return {
        title: "Useful Queue Paper",
        date: "2025",
        extra: ""
      }[field] || "";
    },
    getTags() {
      return [{ tag: "paperbridge/rank/3" }];
    },
    getAttachments() {
      return [];
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    QUEUE01: { note_path: "D:\\Papers\\Queue_(Draft) #1.md" }
  }));
  const queue = PaperBridge.ReadingQueue.renderQueue([queueItem2, queueItem1], "My Queue");
  assert.ok(queue.includes("# My Queue"));
  assert.ok(queue.indexOf("## 1 - Core reference") < queue.indexOf("## 3 - Useful"));
  assert.ok(queue.includes("- [Core \\[Queue\\] Paper](zotero://select/library/items/QUEUE01) (ada2026\\_core) | note: D:\\\\Papers\\\\Queue\\_\\(Draft\\) \\#1\\.md"));
  assert.ok(queue.includes("- [Useful Queue Paper](zotero://select/library/items/QUEUE02) (babbage2025\\_useful)"));
  prefs.set("extensions.paperbridge.index", "{}");
  pathTypes.set("D:\\Papers\\reading_queue.md", "regular");
  fileContentsByPath.set("D:\\Papers\\reading_queue.md", "---\ntype: paperbridge-reading-queue\n---\n");
  assert.strictEqual(await PaperBridge.ReadingQueue.queuePath(null), "D:\\Papers\\reading_queue.md");
  fileContentsByPath.set("D:\\Papers\\reading_queue.md", "User content");
  assert.strictEqual(await PaperBridge.ReadingQueue.queuePath(null), "D:\\Papers\\reading_queue (2).md");
  const longQueueCollection = { name: "Q".repeat(260) };
  const longQueueFilename = path.win32.basename(await PaperBridge.ReadingQueue.queuePath(longQueueCollection));
  assert.ok(longQueueFilename.length <= PaperBridge.Settings.maxFilenameLength());
  assert.ok(longQueueFilename.toLowerCase().endsWith(".md"));

  zoteroItemsByID.set(201, queueItem1);
  zoteroItemsByID.set(202, queueItem2);
  const originalGetSelectedCollectionForGenerators = PaperBridge.Util.getSelectedCollection;
  const originalAlertForGenerators = PaperBridge.Util.alert;
  const originalOpenPathForGenerators = PaperBridge.Notes.openPath;
  const generatorAlerts = [];
  const generatorOpens = [];
  const asyncCollection = {
    id: 707,
    name: "Async Collection",
    async getChildItems() {
      return ["201", "202"];
    }
  };
  PaperBridge.Util.getSelectedCollection = () => asyncCollection;
  PaperBridge.Util.alert = message => generatorAlerts.push(message);
  PaperBridge.Notes.openPath = async openedPath => generatorOpens.push(openedPath);
  await PaperBridge.ReadingQueue.generateForCurrentScope();
  const generatedQueuePath = "D:\\Papers\\reading_queue - Async Collection.md";
  assert.ok(fileContentsByPath.get(generatedQueuePath).includes("# Reading Queue - Async Collection"));
  assert.ok(fileContentsByPath.get(generatedQueuePath).includes("Core \\[Queue\\] Paper"));
  assert.ok(generatorAlerts.some(message => message.includes(generatedQueuePath)));

  const citationItem1 = Object.assign({}, mockItem, {
    id: 301,
    key: "CITE01",
    firstCreator: "Curie",
    getCreators() {
      return [{ firstName: "Marie", lastName: "Curie" }, { firstName: "Pierre", lastName: "Curie" }];
    },
    getField(field) {
      return {
        title: "A Reference [With] Markdown",
        date: "1911",
        DOI: "10.1000/example(1)",
        url: "https://example.com/ref_(v1)?q=a+b",
        extra: ""
      }[field] || "";
    },
    getAttachments() {
      return [];
    }
  });
  const citationItem2 = Object.assign({}, mockItem, {
    id: 302,
    key: "CITE02",
    firstCreator: "Einstein",
    getCreators() {
      return [{ lastName: "Einstein" }];
    },
    getField(field) {
      return {
        title: "Another Reference",
        date: "1905",
        DOI: "",
        url: "",
        extra: ""
      }[field] || "";
    },
    getAttachments() {
      return [];
    }
  });
  const citationList = PaperBridge.Citations.renderCitationList([citationItem1, citationItem2], "References - Test");
  assert.ok(citationList.includes("# References - Test"));
  assert.ok(citationList.indexOf("@curie1911_a") < citationList.indexOf("@einstein1905_another"));
  assert.ok(citationList.includes("`@curie1911_a` Curie & Curie (1911). [A Reference \\[With\\] Markdown](zotero://select/library/items/CITE01)."));
  assert.ok(citationList.includes("DOI: 10\\.1000/example\\(1\\)."));
  assert.ok(citationList.includes("URL: https://example\\.com/ref\\_\\(v1\\)?q=a\\+b."));
  const testCollection = { name: "Test Collection" };
  pathTypes.set("D:\\Papers\\references - Test Collection.md", "regular");
  fileContentsByPath.set("D:\\Papers\\references - Test Collection.md", "User content");
  assert.strictEqual(await PaperBridge.Citations.citationListPath(testCollection), "D:\\Papers\\references - Test Collection (2).md");
  const longCitationCollection = { name: "R".repeat(260) };
  const longCitationFilename = path.win32.basename(await PaperBridge.Citations.citationListPath(longCitationCollection));
  assert.ok(longCitationFilename.length <= PaperBridge.Settings.maxFilenameLength());
  assert.ok(longCitationFilename.toLowerCase().endsWith(".md"));
  await PaperBridge.Citations.generateForCurrentCollection();
  const generatedCitationPath = "D:\\Papers\\references - Async Collection.md";
  assert.ok(fileContentsByPath.get(generatedCitationPath).includes("# References - Async Collection"));
  assert.ok(fileContentsByPath.get(generatedCitationPath).includes("@ada2026_core"));
  assert.deepStrictEqual(generatorOpens, [generatedQueuePath, generatedCitationPath]);
  PaperBridge.Util.getSelectedCollection = originalGetSelectedCollectionForGenerators;
  PaperBridge.Util.alert = originalAlertForGenerators;
  PaperBridge.Notes.openPath = originalOpenPathForGenerators;

  const repairFromInvalid = PaperBridge.Notes.frontmatterRepairUpdatesForItem(mockItem, originalMarkdown, null, {
    rank: "3"
  });
  assert.strictEqual(repairFromInvalid.collection, "Old Collection");
  assert.strictEqual(repairFromInvalid.primary_collection, "Old Collection");
  assert.strictEqual(repairFromInvalid.rank, "3");

  noteFileContent = originalMarkdown;
  linkedAttachmentPayload = null;
  const itemWithoutAttachment = Object.assign({}, mockItem, {
    getAttachments() {
      return [];
    }
  });
  await PaperBridge.Notes.ensureExistingNoteLinked(itemWithoutAttachment, "D:\\Papers\\Existing.md", { name: "Fallback Collection" });
  assert.strictEqual(linkedAttachmentPayload.file, "D:\\Papers\\Existing.md");
  assert.strictEqual(linkedAttachmentPayload.parentItemID, itemWithoutAttachment.id);
  assert.ok(noteFileContent.includes('citekey: "doe2024_a"'));
  assert.ok(noteFileContent.includes('primary_collection: "Old Collection"'));
  assert.strictEqual(PaperBridge.Index.get(itemWithoutAttachment).note_path, "D:\\Papers\\Existing.md");

  noteFileContent = "Body only";
  linkedAttachmentPayload = null;
  await PaperBridge.Notes.relinkMarkdownNote(itemWithoutAttachment, "D:\\Papers\\Relinked.md", { name: "Relinked Collection" });
  assert.strictEqual(linkedAttachmentPayload.file, "D:\\Papers\\Relinked.md");
  assert.ok(noteFileContent.startsWith("---\n"));
  assert.ok(noteFileContent.includes('primary_collection: "Relinked Collection"'));
  assert.strictEqual(PaperBridge.Index.get(itemWithoutAttachment).note_path, "D:\\Papers\\Relinked.md");
  const failingAttachPath = "D:\\Papers\\Attach Failure Existing.md";
  fileContentsByPath.set(failingAttachPath, validMarkdown);
  prefs.set("extensions.paperbridge.index", "{}");
  const originalAttachForExisting = PaperBridge.Notes.attachMarkdownNote;
  PaperBridge.Notes.attachMarkdownNote = async () => {
    throw new Error("existing attach failed");
  };
  await assert.rejects(
    () => PaperBridge.Notes.relinkMarkdownNote(itemWithoutAttachment, failingAttachPath, { name: "Existing Attach Failure" }),
    /existing attach failed/
  );
  assert.strictEqual(PaperBridge.Index.get(itemWithoutAttachment).note_path, failingAttachPath);
  assert.strictEqual(PaperBridge.Notes.getNoteState(itemWithoutAttachment), PaperBridge.Constants.noteStates.missing);
  PaperBridge.Notes.attachMarkdownNote = originalAttachForExisting;
  linkedAttachmentPayload = null;
  const recoveredExistingAttachPath = await PaperBridge.Notes.createNoteForItem(itemWithoutAttachment, { collection: collectionsByID.get(7) });
  assert.strictEqual(recoveredExistingAttachPath, failingAttachPath);
  assert.strictEqual(linkedAttachmentPayload.file, failingAttachPath);
  const previousRelinkIndex = prefs.get("extensions.paperbridge.index");
  const wrongRelinkPath = "D:\\Papers\\Wrong Item.md";
  const wrongRelinkContent = validMarkdown.replace('zotero_key: "ABCD1234"', 'zotero_key: "OTHERKEY"');
  fileContentsByPath.set(wrongRelinkPath, wrongRelinkContent);
  linkedAttachmentPayload = null;
  await assert.rejects(
    () => PaperBridge.Notes.relinkMarkdownNote(itemWithoutAttachment, wrongRelinkPath),
    /belongs to another Zotero item/
  );
  assert.strictEqual(fileContentsByPath.get(wrongRelinkPath), wrongRelinkContent);
  assert.strictEqual(linkedAttachmentPayload, null);
  assert.strictEqual(prefs.get("extensions.paperbridge.index"), previousRelinkIndex);
  const originalGroupsForRelink = context.Zotero.Groups;
  context.Zotero.Groups = {
    get(groupID) {
      return Number(groupID) === 22 ? { groupID: 22, libraryID: 2 } : null;
    }
  };
  const wrongLibraryPath = "D:\\Papers\\Wrong Library.md";
  const wrongLibraryContent = validMarkdown.replace(
    'zotero: "zotero://select/library/items/ABCD1234"',
    'zotero: "zotero://select/groups/22/items/ABCD1234"'
  );
  fileContentsByPath.set(wrongLibraryPath, wrongLibraryContent);
  await assert.rejects(
    () => PaperBridge.Notes.relinkMarkdownNote(itemWithoutAttachment, wrongLibraryPath),
    /belongs to another Zotero library/
  );
  assert.strictEqual(fileContentsByPath.get(wrongLibraryPath), wrongLibraryContent);
  assert.strictEqual(linkedAttachmentPayload, null);
  assert.strictEqual(prefs.get("extensions.paperbridge.index"), previousRelinkIndex);
  context.Zotero.Groups = originalGroupsForRelink;
  const wrongURIItemPath = "D:\\Papers\\Wrong URI Item.md";
  const wrongURIItemContent = validMarkdown.replace(
    'zotero: "zotero://select/library/items/ABCD1234"',
    'zotero: "zotero://select/library/items/OTHERKEY"'
  );
  fileContentsByPath.set(wrongURIItemPath, wrongURIItemContent);
  await assert.rejects(
    () => PaperBridge.Notes.relinkMarkdownNote(itemWithoutAttachment, wrongURIItemPath),
    /links to another Zotero item/
  );
  assert.strictEqual(fileContentsByPath.get(wrongURIItemPath), wrongURIItemContent);
  assert.strictEqual(linkedAttachmentPayload, null);
  assert.strictEqual(prefs.get("extensions.paperbridge.index"), previousRelinkIndex);
  const wrongIndexedPath = "D:\\Papers\\Wrong Indexed.md";
  fileContentsByPath.set(wrongIndexedPath, wrongRelinkContent);
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    ABCD1234: { note_path: wrongIndexedPath }
  }));
  linkedAttachmentPayload = null;
  await assert.rejects(
    () => PaperBridge.Notes.createNoteForItem(itemWithoutAttachment, { collection: collectionsByID.get(7) }),
    /belongs to another Zotero item/
  );
  assert.strictEqual(fileContentsByPath.get(wrongIndexedPath), wrongRelinkContent);
  assert.strictEqual(linkedAttachmentPayload, null);
  assert.strictEqual(PaperBridge.Index.get(itemWithoutAttachment).note_path, wrongIndexedPath);
  await assert.rejects(
    () => PaperBridge.Notes.repairMarkdownNote(itemWithoutAttachment),
    /belongs to another Zotero item/
  );
  assert.strictEqual(fileContentsByPath.get(wrongIndexedPath), wrongRelinkContent);
  await assert.rejects(
    () => PaperBridge.Notes.updateLinkedNoteRank(itemWithoutAttachment, "2"),
    /belongs to another Zotero item/
  );
  assert.strictEqual(fileContentsByPath.get(wrongIndexedPath), wrongRelinkContent);
  await assert.rejects(
    () => PaperBridge.Notes.moveNoteToCollection(itemWithoutAttachment, { name: "Target" }),
    /belongs to another Zotero item/
  );
  assert.strictEqual(fileContentsByPath.get(wrongIndexedPath), wrongRelinkContent);
  assert.strictEqual(pathTypes.has("D:\\Papers\\Target\\Wrong Indexed.md"), false);
  const failingRepairPath = "D:\\Papers\\Fail Repair.md";
  fileContentsByPath.set(failingRepairPath, originalMarkdown);
  const originalPutContentsAsync = context.Zotero.File.putContentsAsync;
  const indexBeforeRepairFailure = prefs.get("extensions.paperbridge.index");
  context.Zotero.File.putContentsAsync = async (filePath, content) => {
    if (filePath === failingRepairPath) {
      throw new Error("frontmatter write failed");
    }
    return originalPutContentsAsync(filePath, content);
  };
  linkedAttachmentPayload = null;
  await assert.rejects(
    () => PaperBridge.Notes.relinkMarkdownNote(itemWithoutAttachment, failingRepairPath),
    /frontmatter write failed/
  );
  assert.strictEqual(fileContentsByPath.get(failingRepairPath), originalMarkdown);
  assert.strictEqual(linkedAttachmentPayload, null);
  assert.strictEqual(prefs.get("extensions.paperbridge.index"), indexBeforeRepairFailure);
  context.Zotero.File.putContentsAsync = originalPutContentsAsync;

  const createFailTags = [];
  const createFailItem = Object.assign({}, mockItem, {
    id: 88,
    key: "CREATEFAIL",
    firstCreator: "Lovelace",
    getField(field) {
      return {
        title: "Attachment Failure Paper",
        date: "2026",
        extra: ""
      }[field] || "";
    },
    getAttachments() {
      return [];
    },
    getTags() {
      return createFailTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!createFailTags.some(entry => entry.tag === tag)) {
        createFailTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = createFailTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        createFailTags.splice(index, 1);
      }
    },
    async saveTx() {}
  });
  prefs.set("extensions.paperbridge.index", "{}");
  const originalAttachForCreate = PaperBridge.Notes.attachMarkdownNote;
  PaperBridge.Notes.attachMarkdownNote = async () => {
    throw new Error("initial attach failed");
  };
  await assert.rejects(
    () => PaperBridge.Notes.createNoteForItem(createFailItem, { collection: collectionsByID.get(7) }),
    /initial attach failed/
  );
  const createFailPath = PaperBridge.Index.get(createFailItem).note_path;
  assert.ok(createFailPath.endsWith("lovelace2026_attachment - Attachment Failure Paper.md"));
  assert.ok(fileContentsByPath.has(createFailPath));
  assert.strictEqual(linkedAttachmentPayload, null);
  assert.strictEqual(PaperBridge.Notes.getNoteState(createFailItem), PaperBridge.Constants.noteStates.missing);

  PaperBridge.Notes.attachMarkdownNote = originalAttachForCreate;
  linkedAttachmentPayload = null;
  const recoveredCreatePath = await PaperBridge.Notes.createNoteForItem(createFailItem, { collection: collectionsByID.get(7) });
  assert.strictEqual(recoveredCreatePath, createFailPath);
  assert.strictEqual(linkedAttachmentPayload.file, createFailPath);
  assert.strictEqual([...fileContentsByPath.keys()].some(filePath => filePath.includes("Attachment Failure Paper (2).md")), false);

  const moveSource = "D:\\Papers\\Old\\Move.md";
  const moveTarget = "D:\\Papers\\Target\\Move.md";
  const moveOriginal = validMarkdown
    .replace("New Collection", "Old")
    .replace("New Collection", "Old")
    .replace('zotero_key: "ABCD1234"', 'zotero_key: "MOVE01"')
    .replace('zotero: "zotero://select/library/items/ABCD1234"', 'zotero: "zotero://select/library/items/MOVE01"');
  const movingItem = Object.assign({}, mockItem, {
    key: "MOVE01",
    getAttachments() {
      return [];
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    MOVE01: { note_path: moveSource }
  }));
  pathTypes.set("D:\\Papers\\Old", "directory");
  pathTypes.set(moveSource, "regular");
  fileContentsByPath.set(moveSource, moveOriginal);
  const originalAttachMarkdownNote = PaperBridge.Notes.attachMarkdownNote;
  PaperBridge.Notes.attachMarkdownNote = async () => {
    throw new Error("attach failed");
  };
  await assert.rejects(
    () => PaperBridge.Notes.moveNoteToCollection(movingItem, { name: "Target" }),
    /attach failed/
  );
  assert.strictEqual(pathTypes.has(moveSource), true);
  assert.strictEqual(pathTypes.has(moveTarget), false);
  assert.strictEqual(fileContentsByPath.get(moveSource), moveOriginal);
  assert.strictEqual(PaperBridge.Index.get(movingItem).note_path, moveSource);
  PaperBridge.Notes.attachMarkdownNote = originalAttachMarkdownNote;

  const scanRoot = "D:\\Papers";
  const scanDir = "D:\\Papers\\Inbox";
  const scanPath = "D:\\Papers\\Inbox\\Scanned.md";
  childrenByDirectory.set(scanRoot, [scanDir, "D:\\Papers\\README.txt"]);
  childrenByDirectory.set(scanDir, [scanPath, "D:\\Papers\\Inbox\\Skip.txt"]);
  pathTypes.set(scanRoot, "directory");
  pathTypes.set(scanDir, "directory");
  pathTypes.set(scanPath, "regular");
  pathTypes.set("D:\\Papers\\README.txt", "regular");
  pathTypes.set("D:\\Papers\\Inbox\\Skip.txt", "regular");
  fileContentsByPath.set(scanPath, validMarkdown);
  context.scanMatchItem = itemWithoutAttachment;
  linkedAttachmentPayload = null;
  const scanResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(scanResult), {
    files: 1,
    matched: 1,
    legacyMatched: 0,
    relinked: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload.file, scanPath);
  assert.strictEqual(PaperBridge.Index.get(itemWithoutAttachment).note_path, scanPath);

  const duplicatePath = "D:\\Papers\\Inbox\\Duplicate.md";
  childrenByDirectory.set(scanDir, [scanPath, duplicatePath]);
  pathTypes.set(duplicatePath, "regular");
  fileContentsByPath.set(duplicatePath, validMarkdown);
  linkedAttachmentPayload = null;
  const duplicateResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(duplicateResult), {
    files: 2,
    matched: 2,
    legacyMatched: 0,
    relinked: 0,
    ambiguous: 2,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload, null);

  const originalLibraryGetAll = context.Zotero.Libraries.getAll;
  const originalGetByLibraryAndKey = context.Zotero.Items.getByLibraryAndKey;
  const originalGroupsForScanner = context.Zotero.Groups;
  const sameKeyUserItem = Object.assign({}, mockItem, {
    id: 401,
    key: "SAMEKEY",
    libraryID: 1,
    getAttachments() {
      return [];
    }
  });
  const sameKeyGroupItem = Object.assign({}, mockItem, {
    id: 402,
    key: "SAMEKEY",
    libraryID: 2,
    groupID: 22,
    getAttachments() {
      return [];
    }
  });
  context.Zotero.Libraries.getAll = () => [{ libraryID: 1 }, { libraryID: 2 }];
  context.Zotero.Groups = {
    get(groupID) {
      return Number(groupID) === 22 ? { groupID: 22, libraryID: 2 } : null;
    }
  };
  context.Zotero.Items.getByLibraryAndKey = (libraryID, key) => {
    if (key === "SAMEKEY") {
      return Number(libraryID) === 1 ? sameKeyUserItem : Number(libraryID) === 2 ? sameKeyGroupItem : null;
    }
    return originalGetByLibraryAndKey(libraryID, key);
  };
  const ambiguousKeyPath = "D:\\Papers\\Inbox\\Ambiguous Same Key.md";
  fileContentsByPath.set(ambiguousKeyPath, [
    "---",
    'title: "Ambiguous same key"',
    'zotero_key: "SAMEKEY"',
    "---",
    "",
    "Body"
  ].join("\n"));
  childrenByDirectory.set(scanRoot, [ambiguousKeyPath]);
  pathTypes.set(ambiguousKeyPath, "regular");
  linkedAttachmentPayload = null;
  const ambiguousKeyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(ambiguousKeyResult), {
    files: 1,
    matched: 0,
    legacyMatched: 0,
    relinked: 0,
    ambiguous: 1,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload, null);

  const explicitLibraryKeyPath = "D:\\Papers\\Inbox\\Explicit Library Same Key.md";
  fileContentsByPath.set(explicitLibraryKeyPath, [
    "---",
    'title: "Explicit library same key"',
    'zotero_key: "SAMEKEY"',
    'zotero: "zotero://select/library/items/SAMEKEY"',
    "---",
    "",
    "Body"
  ].join("\n"));
  childrenByDirectory.set(scanRoot, [explicitLibraryKeyPath]);
  pathTypes.set(explicitLibraryKeyPath, "regular");
  linkedAttachmentPayload = null;
  const explicitKeyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(explicitKeyResult), {
    files: 1,
    matched: 1,
    legacyMatched: 0,
    relinked: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload.parentItemID, 401);
  const explicitGroupKeyPath = "D:\\Papers\\Inbox\\Explicit Group Same Key.md";
  fileContentsByPath.set(explicitGroupKeyPath, [
    "---",
    'title: "Explicit group same key"',
    'zotero_key: "SAMEKEY"',
    'zotero: "zotero://select/groups/22/items/SAMEKEY"',
    "---",
    "",
    "Body"
  ].join("\n"));
  childrenByDirectory.set(scanRoot, [explicitGroupKeyPath]);
  pathTypes.set(explicitGroupKeyPath, "regular");
  linkedAttachmentPayload = null;
  const explicitGroupKeyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(explicitGroupKeyResult), {
    files: 1,
    matched: 1,
    legacyMatched: 0,
    relinked: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload.parentItemID, 402);
  const unresolvedGroupKeyPath = "D:\\Papers\\Inbox\\Unresolved Group Same Key.md";
  fileContentsByPath.set(unresolvedGroupKeyPath, [
    "---",
    'title: "Unresolved group same key"',
    'zotero_key: "SAMEKEY"',
    'zotero: "zotero://select/groups/999/items/SAMEKEY"',
    "---",
    "",
    "Body"
  ].join("\n"));
  childrenByDirectory.set(scanRoot, [unresolvedGroupKeyPath]);
  pathTypes.set(unresolvedGroupKeyPath, "regular");
  linkedAttachmentPayload = null;
  assert.deepStrictEqual(plain(PaperBridge.Scanner.libraryIDsForLookup({
    zotero: "zotero://select/groups/999/items/SAMEKEY"
  })), []);
  const unresolvedGroupKeyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(unresolvedGroupKeyResult), {
    files: 1,
    matched: 0,
    legacyMatched: 0,
    relinked: 0,
    ambiguous: 0,
    skipped: 1,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload, null);
  const mismatchedURIKeyPath = "D:\\Papers\\Inbox\\Mismatched URI Key.md";
  fileContentsByPath.set(mismatchedURIKeyPath, [
    "---",
    'title: "Mismatched URI key"',
    'zotero_key: "SAMEKEY"',
    'zotero: "zotero://select/library/items/OTHERKEY"',
    "---",
    "",
    "Body"
  ].join("\n"));
  childrenByDirectory.set(scanRoot, [mismatchedURIKeyPath]);
  pathTypes.set(mismatchedURIKeyPath, "regular");
  linkedAttachmentPayload = null;
  const mismatchedURIKeyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(mismatchedURIKeyResult), {
    files: 1,
    matched: 0,
    legacyMatched: 0,
    relinked: 0,
    ambiguous: 0,
    skipped: 1,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload, null);
  context.Zotero.Libraries.getAll = originalLibraryGetAll;
  context.Zotero.Items.getByLibraryAndKey = originalGetByLibraryAndKey;
  context.Zotero.Groups = originalGroupsForScanner;

  const legacyPath = "D:\\Papers\\Inbox\\smith2025_legacy - Legacy Matching Paper.md";
  const legacyMarkdown = [
    "---",
    'title: "Legacy Matching Paper"',
    'citekey: "smith2025_legacy"',
    "---",
    "",
    "Body"
  ].join("\n");
  const legacyItem = Object.assign({}, mockItem, {
    id: 77,
    key: "LEGACY01",
    firstCreator: "Smith",
    getField(field) {
      return {
        title: "Legacy Matching Paper",
        date: "2025",
        DOI: "",
        url: "",
        extra: ""
      }[field] || "";
    },
    getAttachments() {
      return [];
    }
  });
  childrenByDirectory.set(scanRoot, [legacyPath]);
  pathTypes.set(legacyPath, "regular");
  fileContentsByPath.set(legacyPath, legacyMarkdown);
  zoteroItemsByID.set(77, legacyItem);
  context.getAllItemsResult = [77];
  searchIDs = [];
  linkedAttachmentPayload = null;
  const legacyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(legacyResult), {
    files: 1,
    matched: 1,
    legacyMatched: 1,
    relinked: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload.file, legacyPath);
  assert.ok(fileContentsByPath.get(legacyPath).includes('zotero_key: "LEGACY01"'));

  fileContentsByPath.set(legacyPath, legacyMarkdown);
  context.getAllItemsResult = ["77"];
  linkedAttachmentPayload = null;
  const legacyStringIDResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(legacyStringIDResult), {
    files: 1,
    matched: 1,
    legacyMatched: 1,
    relinked: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload.file, legacyPath);

  fileContentsByPath.set(legacyPath, legacyMarkdown);
  const duplicateLegacyItem = Object.assign({}, legacyItem, {
    id: 78,
    key: "LEGACY02"
  });
  zoteroItemsByID.set(78, duplicateLegacyItem);
  context.getAllItemsResult = [77, 78];
  searchIDs = [];
  linkedAttachmentPayload = null;
  const ambiguousLegacyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(ambiguousLegacyResult), {
    files: 1,
    matched: 0,
    legacyMatched: 0,
    relinked: 0,
    ambiguous: 1,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload, null);

  const fuzzyPath = "D:\\Papers\\Inbox\\Fuzzy Matching Pper A Robust Method.md";
  const fuzzyMarkdown = [
    "---",
    'title: "Fuzzy Matching Pper A Robust Method"',
    "---",
    "",
    "Body"
  ].join("\n");
  const fuzzyItem = Object.assign({}, mockItem, {
    id: 79,
    key: "FUZZY01",
    firstCreator: "Turing",
    getField(field) {
      return {
        title: "Fuzzy Matching Paper A Robust Method",
        date: "2026",
        DOI: "",
        url: "",
        extra: ""
      }[field] || "";
    },
    getAttachments() {
      return [];
    }
  });
  childrenByDirectory.set(scanRoot, [fuzzyPath]);
  pathTypes.set(fuzzyPath, "regular");
  fileContentsByPath.set(fuzzyPath, fuzzyMarkdown);
  zoteroItemsByID.set(79, fuzzyItem);
  context.getAllItemsResult = [79];
  linkedAttachmentPayload = null;
  const fuzzyResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(fuzzyResult), {
    files: 1,
    matched: 1,
    legacyMatched: 1,
    relinked: 1,
    ambiguous: 0,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload.file, fuzzyPath);
  assert.ok(fileContentsByPath.get(fuzzyPath).includes('zotero_key: "FUZZY01"'));

  fileContentsByPath.set(fuzzyPath, fuzzyMarkdown);
  const fuzzyNearDuplicate = Object.assign({}, fuzzyItem, {
    id: 80,
    key: "FUZZY02",
    getField(field) {
      return {
        title: "Fuzzy Matching Pper A Robust Methods",
        date: "2026",
        DOI: "",
        url: "",
        extra: ""
      }[field] || "";
    }
  });
  zoteroItemsByID.set(80, fuzzyNearDuplicate);
  context.getAllItemsResult = [79, 80];
  linkedAttachmentPayload = null;
  const fuzzyAmbiguousResult = await PaperBridge.Scanner.scanDirectory(scanRoot);
  assert.deepStrictEqual(plain(fuzzyAmbiguousResult), {
    files: 1,
    matched: 0,
    legacyMatched: 0,
    relinked: 0,
    ambiguous: 1,
    skipped: 0,
    failed: 0
  });
  assert.strictEqual(linkedAttachmentPayload, null);
  context.getAllItemsResult = null;
  searchIDs = [];

  const filteredItem = {
    getCollections() {
      return [8, 7, 9];
    }
  };
  const stringCollectionIDItem = {
    getCollections() {
      return ["7", "bad", 0];
    }
  };
  prefs.set("extensions.paperbridge.autoCreateOnlyCollections", "");
  prefs.set("extensions.paperbridge.ignoreCollections", "");
  assert.strictEqual(PaperBridge.Notifications.shouldAutoCreateForCollection(collectionsByID.get(7)), true);
  assert.strictEqual(PaperBridge.Notifications.autoCreateCollectionForItem(filteredItem, null), collectionsByID.get(8));
  assert.deepStrictEqual(PaperBridge.Notifications.collectionIDsForItem(stringCollectionIDItem), [7]);
  assert.strictEqual(PaperBridge.Notifications.collectionForItem(stringCollectionIDItem, "7"), collectionsByID.get(7));

  prefs.set("extensions.paperbridge.ignoreCollections", "Ignored");
  assert.strictEqual(PaperBridge.Notifications.shouldAutoCreateForCollection(collectionsByID.get(8)), false);
  assert.strictEqual(PaperBridge.Notifications.autoCreateCollectionForItem(filteredItem, 8), null);
  assert.strictEqual(PaperBridge.Notifications.autoCreateCollectionForItem(filteredItem, null), collectionsByID.get(7));

  prefs.set("extensions.paperbridge.autoCreateOnlyCollections", "Reading Queue");
  prefs.set("extensions.paperbridge.ignoreCollections", "");
  assert.strictEqual(PaperBridge.Notifications.autoCreateCollectionForItem(filteredItem, 7), null);
  assert.strictEqual(PaperBridge.Notifications.autoCreateCollectionForItem(filteredItem, null), collectionsByID.get(9));

  prefs.set("extensions.paperbridge.ignoreCollections", "Reading Queue");
  assert.strictEqual(PaperBridge.Notifications.autoCreateCollectionForItem(filteredItem, null), null);

  prefs.set("extensions.paperbridge.autoCreateOnlyCollections", "");
  prefs.set("extensions.paperbridge.ignoreCollections", "");
  zoteroItemsByID.set(42, mockItem);
  assert.deepStrictEqual(
    plain(PaperBridge.Notifications.extractCollectionItemEvents(["collection-item-7-42"], {})),
    [{ itemID: 42, collectionID: 7 }]
  );
  assert.deepStrictEqual(
    plain(PaperBridge.Notifications.extractCollectionItemEvents([], {
      a: { itemID: "42", collectionID: null },
      b: { itemID: null, collectionID: 7 },
      c: { itemID: 0, collectionID: 7 }
    })),
    [{ itemID: 42, collectionID: null }]
  );
  PaperBridge.Notifications.scheduleItem(42, 7, 60000);
  assert.deepStrictEqual(plain(PaperBridge.Notifications.pending.get(42)), { collectionID: 7 });
  PaperBridge.Notifications.scheduleItem(42, null, 60000);
  assert.deepStrictEqual(plain(PaperBridge.Notifications.pending.get(42)), { collectionID: 7 });
  PaperBridge.Notifications.scheduleItem(0, 7, 60000);
  assert.strictEqual(PaperBridge.Notifications.pending.has(0), false);
  PaperBridge.Notifications.stop();

  const autoRetryTags = [];
  const autoRetryItem = Object.assign({}, mockItem, {
    id: 501,
    key: "AUTORTY1",
    firstCreator: "Hopper",
    getCollections() {
      return ["7"];
    },
    getAttachments() {
      return [];
    },
    getField(field) {
      return {
        title: "Auto Retry Paper",
        date: "2026",
        DOI: "",
        url: "",
        extra: ""
      }[field] || "";
    },
    getTags() {
      return autoRetryTags.map(tag => Object.assign({}, tag));
    },
    addTag(tag) {
      if (!autoRetryTags.some(entry => entry.tag === tag)) {
        autoRetryTags.push({ tag });
      }
    },
    removeTag(tag) {
      const index = autoRetryTags.findIndex(entry => entry.tag === tag);
      if (index >= 0) {
        autoRetryTags.splice(index, 1);
      }
    },
    async saveTx() {}
  });
  zoteroItemsByID.set(501, autoRetryItem);
  prefs.set("extensions.paperbridge.index", "{}");
  PaperBridge.Notifications.retryCounts.delete(501);
  const originalNotificationScheduleItem = PaperBridge.Notifications.scheduleItem;
  const scheduledAutoRetries = [];
  PaperBridge.Notifications.scheduleItem = (itemID, collectionID, delay) => {
    scheduledAutoRetries.push({ itemID, collectionID, delay });
  };
  const originalAttachForAutoRetry = PaperBridge.Notes.attachMarkdownNote;
  PaperBridge.Notes.attachMarkdownNote = async () => {
    throw new Error("auto attach failed");
  };
  linkedAttachmentPayload = null;
  await PaperBridge.Notifications.tryAutoCreate(501, "7");
  const autoRetryPath = PaperBridge.Index.get(autoRetryItem).note_path;
  assert.ok(autoRetryPath.endsWith("hopper2026_auto - Auto Retry Paper.md"));
  assert.ok(fileContentsByPath.has(autoRetryPath));
  assert.strictEqual(PaperBridge.Notes.getNoteState(autoRetryItem), PaperBridge.Constants.noteStates.missing);
  assert.deepStrictEqual(scheduledAutoRetries, [{ itemID: 501, collectionID: "7", delay: PaperBridge.Notifications.retryDelay }]);
  assert.strictEqual(PaperBridge.Notifications.retryCounts.get(501), 1);

  PaperBridge.Notes.attachMarkdownNote = originalAttachForAutoRetry;
  scheduledAutoRetries.length = 0;
  linkedAttachmentPayload = null;
  await PaperBridge.Notifications.tryAutoCreate(501, "7");
  assert.strictEqual(linkedAttachmentPayload.file, autoRetryPath);
  assert.strictEqual(scheduledAutoRetries.length, 0);
  assert.strictEqual(PaperBridge.Notifications.retryCounts.has(501), false);
  assert.strictEqual([...fileContentsByPath.keys()].some(filePath => filePath.includes("Auto Retry Paper (2).md")), false);
  PaperBridge.Notifications.scheduleItem = originalNotificationScheduleItem;

  PaperBridge.Notifications.observerID = "paperbridge-observer";
  let clearedNotificationTimer = false;
  const originalClearTimeout = context.clearTimeout;
  context.clearTimeout = () => {
    clearedNotificationTimer = true;
  };
  PaperBridge.Notifications.timers.set(1, "timer");
  context.Zotero.Notifier = {
    unregisterObserver() {
      throw new Error("notifier unregister failed");
    }
  };
  assert.doesNotThrow(() => PaperBridge.Notifications.stop());
  assert.strictEqual(PaperBridge.Notifications.observerID, null);
  assert.strictEqual(PaperBridge.Notifications.timers.size, 0);
  assert.strictEqual(clearedNotificationTimer, true);
  context.clearTimeout = originalClearTimeout;

  const originalRecycle = PaperBridge.DeleteQueue.sendFileToRecycleBin;
  const originalActivePaneForCleanup = context.Zotero.getActiveZoteroPane;
  const originalLibrariesGetAllForCleanup = context.Zotero.Libraries.getAll;
  context.Zotero.Libraries.getAll = () => [
    { libraryID: 1 },
    { id: "2" },
    { libraryID: "2" },
    { libraryID: 0 },
    { id: null }
  ];
  context.Zotero.getActiveZoteroPane = () => ({
    getSelectedLibraryID() {
      return null;
    }
  });
  assert.deepStrictEqual(plain(PaperBridge.DeleteQueue.libraryIDsForCleanup()), [1, 2]);
  context.Zotero.getActiveZoteroPane = () => ({
    getSelectedLibraryID() {
      return "2";
    }
  });
  assert.deepStrictEqual(plain(PaperBridge.DeleteQueue.libraryIDsForCleanup()), [2]);
  context.Zotero.getActiveZoteroPane = originalActivePaneForCleanup;
  context.Zotero.Libraries.getAll = originalLibrariesGetAllForCleanup;

  const findDeleteItem1 = Object.assign({}, mockItem, {
    id: 601,
    key: "FINDX01",
    deleted: false
  });
  const findDeleteItem2 = Object.assign({}, mockItem, {
    id: 602,
    key: "FINDX02",
    deleted: true
  });
  zoteroItemsByID.set(601, findDeleteItem1);
  zoteroItemsByID.set(602, findDeleteItem2);
  searchIDs = ["601", 601, "bad", 0, 602];
  assert.deepStrictEqual(plain((await PaperBridge.DeleteQueue.findDeleteRankedItems()).map(item => item.id)), [601]);
  searchIDs = [];

  const deleteOrder = [];
  const cleanableItem = Object.assign({}, mockItem, {
    key: "CLEAN01",
    deleted: false,
    getAttachments() {
      return [];
    },
    async saveTx() {
      deleteOrder.push("save");
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    CLEAN01: { note_path: "D:\\Papers\\Clean.md" }
  }));
  fileContentsByPath.set("D:\\Papers\\Clean.md", markdownForKey("CLEAN01"));
  PaperBridge.DeleteQueue.sendFileToRecycleBin = async path => {
    deleteOrder.push(`recycle:${path}`);
    pathTypes.set(path, "missing");
  };
  await PaperBridge.DeleteQueue.cleanItem(cleanableItem);
  assert.deepStrictEqual(deleteOrder, ["save", "recycle:D:\\Papers\\Clean.md"]);
  assert.strictEqual(cleanableItem.deleted, true);
  assert.strictEqual(PaperBridge.Index.get(cleanableItem), null);

  const failedCleanItem = Object.assign({}, cleanableItem, {
    key: "CLEAN02",
    deleted: false,
    async saveTx() {
      throw new Error("save failed");
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    CLEAN02: { note_path: "D:\\Papers\\Clean2.md" }
  }));
  fileContentsByPath.set("D:\\Papers\\Clean2.md", markdownForKey("CLEAN02"));
  deleteOrder.length = 0;
  await assert.rejects(() => PaperBridge.DeleteQueue.cleanItem(failedCleanItem), /save failed/);
  assert.deepStrictEqual(deleteOrder, []);
  assert.strictEqual(failedCleanItem.deleted, false);
  assert.notStrictEqual(PaperBridge.Index.get(failedCleanItem), null);
  const recycleFailItem = Object.assign({}, cleanableItem, {
    key: "CLEAN03",
    deleted: false,
    async saveTx() {
      deleteOrder.push(`save:${this.deleted}`);
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    CLEAN03: { note_path: "D:\\Papers\\Clean3.md" }
  }));
  fileContentsByPath.set("D:\\Papers\\Clean3.md", markdownForKey("CLEAN03"));
  deleteOrder.length = 0;
  PaperBridge.DeleteQueue.sendFileToRecycleBin = async path => {
    deleteOrder.push(`recycle:${path}`);
    throw new Error("recycle failed");
  };
  await assert.rejects(() => PaperBridge.DeleteQueue.cleanItem(recycleFailItem), /recycle failed/);
  assert.deepStrictEqual(deleteOrder, ["save:true", "recycle:D:\\Papers\\Clean3.md", "save:false"]);
  assert.strictEqual(recycleFailItem.deleted, false);
  assert.notStrictEqual(PaperBridge.Index.get(recycleFailItem), null);

  const recycleStillExistsItem = Object.assign({}, cleanableItem, {
    key: "CLEAN05",
    deleted: false,
    async saveTx() {
      deleteOrder.push(`save-still:${this.deleted}`);
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    CLEAN05: { note_path: "D:\\Papers\\Clean5.md" }
  }));
  fileContentsByPath.set("D:\\Papers\\Clean5.md", markdownForKey("CLEAN05"));
  deleteOrder.length = 0;
  PaperBridge.DeleteQueue.sendFileToRecycleBin = async path => {
    deleteOrder.push(`recycle-still:${path}`);
  };
  await assert.rejects(() => PaperBridge.DeleteQueue.cleanItem(recycleStillExistsItem), /did not remove Markdown note/);
  assert.deepStrictEqual(deleteOrder, ["save-still:true", "recycle-still:D:\\Papers\\Clean5.md", "save-still:false"]);
  assert.strictEqual(recycleStillExistsItem.deleted, false);
  assert.notStrictEqual(PaperBridge.Index.get(recycleStillExistsItem), null);

  const wrongCleanItem = Object.assign({}, cleanableItem, {
    key: "CLEAN04",
    deleted: false,
    async saveTx() {
      deleteOrder.push("unsafe-save");
    }
  });
  prefs.set("extensions.paperbridge.index", JSON.stringify({
    CLEAN04: { note_path: "D:\\Papers\\WrongClean.md" }
  }));
  fileContentsByPath.set("D:\\Papers\\WrongClean.md", validMarkdown);
  deleteOrder.length = 0;
  PaperBridge.DeleteQueue.sendFileToRecycleBin = async path => {
    deleteOrder.push(`unsafe-recycle:${path}`);
  };
  await assert.rejects(() => PaperBridge.DeleteQueue.cleanItem(wrongCleanItem), /belongs to another Zotero item/);
  assert.deepStrictEqual(deleteOrder, []);
  assert.strictEqual(wrongCleanItem.deleted, false);
  assert.notStrictEqual(PaperBridge.Index.get(wrongCleanItem), null);
  PaperBridge.DeleteQueue.sendFileToRecycleBin = originalRecycle;

  const originalCleanItem = PaperBridge.DeleteQueue.cleanItem;
  const originalLogError = PaperBridge.Util.logError;
  PaperBridge.Util.logError = () => {};
  PaperBridge.DeleteQueue.cleanItem = async item => {
    if (item.id === 2) {
      throw new Error("delete failed");
    }
  };
  const cleanResult = await PaperBridge.DeleteQueue.cleanItems([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepStrictEqual(plain(cleanResult), {
    total: 3,
    cleaned: 2,
    failed: 1
  });
  PaperBridge.DeleteQueue.cleanItem = originalCleanItem;
  PaperBridge.Util.logError = originalLogError;

  console.log("Offline module tests passed");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
