PaperBridge = PaperBridge || {};

PaperBridge.Annotations = {
  beginMarker: "<!-- PaperBridge Annotations: BEGIN -->",
  endMarker: "<!-- PaperBridge Annotations: END -->",

  async exportForSelected() {
    const items = PaperBridge.Util.getSelectedRegularItems();
    if (!items.length) {
      PaperBridge.Util.alert("No regular Zotero items are selected.");
      return;
    }

    const result = {
      total: 0,
      updated: 0,
      annotations: 0,
      failed: 0
    };
    for (const item of items) {
      result.total++;
      try {
        const count = await this.exportForItem(item);
        result.annotations += count;
        result.updated++;
      }
      catch (error) {
        result.failed++;
        PaperBridge.Util.logError(error);
      }
    }

    PaperBridge.Util.alert(
      `Processed ${result.total} item(s).\n` +
      `Updated notes: ${result.updated}\n` +
      `Exported annotations: ${result.annotations}\n` +
      `Failed: ${result.failed}`
    );
  },

  async exportForItem(item) {
    if (!PaperBridge.Notes.isRegularItem(item)) {
      throw new Error("PaperBridge can export annotations only for regular Zotero items.");
    }
    const path = await PaperBridge.Notes.createNoteForItem(item);
    const annotations = await this.annotationsForItem(item);
    const content = await Zotero.File.getContentsAsync(path);
    const nextContent = this.updateAnnotationSection(content, this.renderAnnotationSection(item, annotations));
    await Zotero.File.putContentsAsync(path, nextContent);
    return annotations.length;
  },

  async annotationsForItem(item) {
    const annotations = [];
    const attachments = this.pdfAttachments(item);
    for (let attachmentIndex = 0; attachmentIndex < attachments.length; attachmentIndex++) {
      const attachment = attachments[attachmentIndex];
      for (const annotation of await this.annotationsForAttachment(attachment)) {
        annotations.push({ attachment, attachmentIndex, annotation });
      }
    }
    return annotations.sort((left, right) => this.annotationSortKey(left).localeCompare(this.annotationSortKey(right)));
  },

  pdfAttachments(item) {
    if (!item || typeof item.getAttachments !== "function") {
      return [];
    }
    return item.getAttachments()
      .map(id => Zotero.Items.get(id))
      .filter(attachment => {
        const path = PaperBridge.Notes.getAttachmentPath(attachment);
        return attachment && (attachment.attachmentContentType === "application/pdf" || path.toLowerCase().endsWith(".pdf"));
      });
  },

  async annotationsForAttachment(attachment) {
    if (!attachment) {
      return [];
    }

    if (typeof attachment.getAnnotations === "function") {
      const annotations = await attachment.getAnnotations();
      return this.resolveAnnotationItems(annotations);
    }

    if (typeof attachment.getChildItems === "function") {
      return this.resolveAnnotationItems(await attachment.getChildItems());
    }

    return this.searchAnnotationsForAttachment(attachment);
  },

  async searchAnnotationsForAttachment(attachment) {
    if (typeof Zotero.Search !== "function" || typeof Zotero.Items?.getAsync !== "function") {
      return [];
    }

    try {
      const search = new Zotero.Search();
      search.libraryID = attachment.libraryID || Zotero.Libraries.userLibraryID;
      search.addCondition("itemType", "is", "annotation");
      const ids = await search.search();
      const annotations = await Zotero.Items.getAsync(ids);
      return (await this.resolveAnnotationItems(annotations))
        .filter(annotation => this.annotationBelongsToAttachment(annotation, attachment));
    }
    catch (error) {
      PaperBridge.Util.logError(error);
      return [];
    }
  },

  annotationBelongsToAttachment(annotation, attachment) {
    const parentID = annotation.parentID
      || annotation.parentItemID
      || annotation.parentItem?.id
      || this.annotationField(annotation, "parentID")
      || this.annotationField(annotation, "parentItemID");
    if (Number.isFinite(Number(parentID)) && Number(parentID) === Number(attachment.id)) {
      return true;
    }
    const parentKey = annotation.parentKey
      || annotation.parentItemKey
      || annotation.parentItem?.key
      || this.annotationField(annotation, "parentKey")
      || this.annotationField(annotation, "parentItemKey");
    return Boolean(parentKey && attachment.key && parentKey === attachment.key);
  },

  async resolveAnnotationItems(values) {
    const entries = Array.isArray(values) ? values : [];
    const annotationIDs = entries
      .filter(value => Number.isInteger(Number(value)) && Number(value) > 0)
      .map(Number);
    let resolvedByID = new Map();
    if (annotationIDs.length) {
      const resolved = typeof Zotero.Items?.getAsync === "function"
        ? await Zotero.Items.getAsync(annotationIDs)
        : annotationIDs.map(id => Zotero.Items.get(id));
      resolvedByID = new Map((resolved || [])
        .filter(Boolean)
        .map(annotation => [Number(annotation.id), annotation]));
    }

    return entries
      .map(value => {
        const id = Number(value);
        return Number.isInteger(id) && id > 0
          ? resolvedByID.get(id) || Zotero.Items.get(id)
          : value;
      })
      .filter(annotation => this.isAnnotation(annotation));
  },

  isAnnotation(item) {
    return Boolean(item && (
      item.itemType === "annotation"
      || item.itemTypeName === "annotation"
      || item.annotationType
      || typeof item.isAnnotation === "function" && item.isAnnotation()
    ));
  },

  annotationSortKey(entry) {
    const annotation = entry.annotation;
    return [
      String(entry.attachmentIndex ?? ""),
      String(this.annotationField(annotation, "annotationSortIndex") || ""),
      String(this.annotationField(annotation, "annotationPageLabel") || ""),
      String(this.annotationKey(annotation) || annotation.id || "")
    ].join("|");
  },

  renderAnnotationSection(item, entries) {
    const lines = [
      this.beginMarker,
      "## Zotero PDF Annotations",
      "",
      `Updated: ${PaperBridge.Util.todayISO()}`,
      ""
    ];

    if (!entries.length) {
      lines.push("_No Zotero PDF annotations found._", "", this.endMarker);
      return lines.join("\n");
    }

    let currentAttachmentID = null;
    for (const entry of entries) {
      if (entry.attachment.id !== currentAttachmentID) {
        currentAttachmentID = entry.attachment.id;
        lines.push(`### ${this.escapeMarkdown(this.attachmentTitle(entry.attachment))}`, "");
      }
      lines.push(this.renderAnnotation(entry));
      lines.push("");
    }

    lines.push(this.endMarker);
    return lines.join("\n");
  },

  renderAnnotation(entry) {
    const { annotation } = entry;
    const parts = [];
    const pageLabel = this.annotationField(annotation, "annotationPageLabel");
    const page = pageLabel ? `p. ${pageLabel}` : "page ?";
    const type = this.annotationField(annotation, "annotationType") || "annotation";
    const color = this.annotationField(annotation, "annotationColor") || "";
    const link = this.annotationURI(entry);
    parts.push(`- **${this.escapeMarkdown(type)}** [${this.escapeMarkdown(page)}](${link})${color ? ` ${this.escapeMarkdown(color)}` : ""}`);

    const text = String(this.annotationField(annotation, "annotationText") || "").trim();
    if (text) {
      parts.push(this.blockquote(text));
    }

    const comment = String(this.annotationField(annotation, "annotationComment") || "").trim();
    if (comment) {
      parts.push(this.renderNestedText("Note", comment));
    }

    const tags = this.annotationTags(annotation);
    if (tags.length) {
      parts.push(`  - Tags: ${tags.map(tag => `#${this.escapeMarkdown(tag)}`).join(" ")}`);
    }

    return parts.join("\n");
  },

  updateAnnotationSection(content, section) {
    const text = String(content || "").trimEnd();
    const begin = text.indexOf(this.beginMarker);
    if (begin >= 0) {
      const end = text.indexOf(this.endMarker, begin + this.beginMarker.length);
      const suffix = end >= 0 ? text.slice(end + this.endMarker.length) : "";
      return this.joinAnnotationSection(text.slice(0, begin), section, suffix);
    }

    const orphanEnd = text.indexOf(this.endMarker);
    if (orphanEnd >= 0) {
      const header = "## Zotero PDF Annotations";
      const headerBeforeEnd = text.lastIndexOf(header, orphanEnd);
      if (headerBeforeEnd >= 0) {
        const headerLineStart = text.lastIndexOf("\n", headerBeforeEnd);
        const sectionStart = headerLineStart >= 0 ? headerLineStart + 1 : headerBeforeEnd;
        return this.joinAnnotationSection(text.slice(0, sectionStart), section, text.slice(orphanEnd + this.endMarker.length));
      }

      const cleaned = `${text.slice(0, orphanEnd).trimEnd()}\n\n${text.slice(orphanEnd + this.endMarker.length).trimStart()}`.trimEnd();
      return this.joinAnnotationSection(cleaned, section);
    }
    return this.joinAnnotationSection(text, section);
  },

  joinAnnotationSection(prefix, section, suffix = "") {
    const parts = [];
    const before = String(prefix || "").trimEnd();
    const middle = String(section || "").trim();
    const after = String(suffix || "").trimStart();
    if (before) {
      parts.push(before);
    }
    if (middle) {
      parts.push(middle);
    }
    if (after) {
      parts.push(after);
    }
    return `${parts.join("\n\n")}\n`;
  },

  annotationURI(entry) {
    const { attachment, annotation } = entry;
    const params = [];
    const pageLabel = this.annotationField(annotation, "annotationPageLabel");
    const key = this.annotationKey(annotation);
    if (pageLabel) {
      params.push(`page=${encodeURIComponent(pageLabel)}`);
    }
    if (key) {
      params.push(`annotation=${encodeURIComponent(key)}`);
    }
    const query = params.length ? `?${params.join("&")}` : "";
    return `zotero://open-pdf/${PaperBridge.Util.libraryURIPath(attachment)}/items/${encodeURIComponent(attachment.key || "")}${query}`;
  },

  annotationKey(annotation) {
    return this.annotationField(annotation, "key")
      || this.annotationField(annotation, "itemKey")
      || this.annotationField(annotation, "annotationKey")
      || "";
  },

  annotationField(annotation, name) {
    const value = annotation?.[name];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
    try {
      const fieldValue = annotation?.getField?.(name);
      return fieldValue === undefined || fieldValue === null ? "" : fieldValue;
    }
    catch (error) {
      return "";
    }
  },

  attachmentTitle(attachment) {
    return attachment.getField?.("title") || PaperBridge.Util.pathBasename(PaperBridge.Notes.getAttachmentPath(attachment)) || "PDF Attachment";
  },

  annotationTags(annotation) {
    return (annotation.getTags?.() || [])
      .map(entry => typeof entry === "string" ? entry : entry?.tag || entry?.name || "")
      .map(tag => String(tag).trim())
      .filter(Boolean);
  },

  blockquote(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(line => `  > ${this.escapeMarkdown(line)}`)
      .join("\n");
  },

  renderNestedText(label, text) {
    const lines = String(text || "").trim().split(/\r?\n/).map(line => this.escapeMarkdown(line));
    const first = lines.shift() || "";
    return [
      `  - ${label}: ${first}`,
      ...lines.map(line => `    ${line}`)
    ].join("\n");
  },

  escapeMarkdown(value) {
    return String(value ?? "").replace(/([\\[\]`*_{}])/g, "\\$1");
  }
};
