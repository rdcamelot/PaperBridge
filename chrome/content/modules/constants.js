PaperBridge = PaperBridge || {};

PaperBridge.Constants = Object.freeze({
  addonID: "paperbridge@example.com",
  prefBranch: "extensions.paperbridge.",
  noteAttachmentTitle: "Markdown Reading Note",
  rankValues: ["1", "2", "3", "4", "x"],
  emptyRank: "",
  noteStates: Object.freeze({
    create: "+",
    ready: "M",
    missing: "!"
  }),
  markdownContentType: "text/markdown",
  unfiledDirectoryName: "Unfiled",
  statusUnread: "unread",
  statusValues: ["unread", "reading", "read"],
  requiredFrontmatterKeys: Object.freeze([
    "title",
    "citekey",
    "zotero_key",
    "collection",
    "primary_collection",
    "status",
    "zotero",
    "created",
    "updated"
  ])
});
