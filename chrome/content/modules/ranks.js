PaperBridge = PaperBridge || {};

PaperBridge.Ranks = {
  rankTag(rank) {
    return PaperBridge.Settings.rankTagPrefix() + rank;
  },

  statusTag(status) {
    return PaperBridge.Settings.statusTagPrefix() + status;
  },

  getRank(item) {
    if (!item?.getTags) {
      return "";
    }
    const prefix = PaperBridge.Settings.rankTagPrefix();
    return this.firstValidTagValue(item, prefix, PaperBridge.Constants.rankValues);
  },

  getStatus(item) {
    if (!item?.getTags) {
      return "";
    }
    const prefix = PaperBridge.Settings.statusTagPrefix();
    return this.firstValidTagValue(item, prefix, PaperBridge.Constants.statusValues);
  },

  firstValidTagValue(item, prefix, allowedValues) {
    for (const tag of item.getTags()) {
      const name = tag.tag || "";
      if (!name.startsWith(prefix)) {
        continue;
      }
      const value = name.slice(prefix.length);
      if (allowedValues.includes(value)) {
        return value;
      }
    }
    return "";
  },

  async setRankForItemID(itemID, rank) {
    const item = Zotero.Items.get(Number(itemID));
    if (!item || !PaperBridge.Notes.isRegularItem(item)) {
      return;
    }
    await this.setRank(item, rank);
  },

  async setRankForSelected(rank) {
    const items = PaperBridge.Util.getSelectedRegularItems();
    for (const item of items) {
      await this.setRank(item, rank);
    }
  },

  async setRank(item, rank) {
    const normalized = PaperBridge.Constants.rankValues.includes(rank) ? rank : "";
    const prefix = PaperBridge.Settings.rankTagPrefix();
    const existing = item.getTags ? item.getTags() : [];
    const previousRankTags = this.tagNamesWithPrefix(existing, prefix);

    try {
      for (const tag of existing) {
        if (tag.tag?.startsWith(prefix)) {
          this.removeTag(item, tag.tag);
        }
      }

      if (normalized) {
        item.addTag(this.rankTag(normalized), 0);
      }

      await item.saveTx();
    }
    catch (error) {
      this.restoreTagsWithPrefix(item, prefix, previousRankTags);
      throw error;
    }
    PaperBridge.Index.set(item, { rank: normalized });
    await PaperBridge.Notes.updateLinkedNoteRank(item, normalized).catch(error => {
      PaperBridge.Util.logError(error);
    });
    PaperBridge.Util.refreshItemTreeColumns();
  },

  async applyFrontmatterState(item, fields) {
    if (!item?.getTags || !item.addTag || !item.saveTx || !fields) {
      return false;
    }

    const rankPrefix = PaperBridge.Settings.rankTagPrefix();
    const statusPrefix = PaperBridge.Settings.statusTagPrefix();
    const previousRankTags = this.tagNamesWithPrefix(item.getTags(), rankPrefix);
    const previousStatusTags = this.tagNamesWithPrefix(item.getTags(), statusPrefix);
    let changed = false;
    let rankChanged = false;
    let nextRank = null;
    if (Object.prototype.hasOwnProperty.call(fields, "rank")) {
      const rawRank = String(fields.rank || "").trim();
      const rank = this.normalizeRank(rawRank);
      if (!rawRank || rank) {
        rankChanged = this.syncSingleTag(item, rankPrefix, rank ? this.rankTag(rank) : "");
        changed = rankChanged || changed;
        nextRank = rank;
      }
    }

    if (Object.prototype.hasOwnProperty.call(fields, "status")) {
      const status = this.normalizeStatus(fields.status);
      if (status) {
        changed = this.syncSingleTag(item, statusPrefix, this.statusTag(status)) || changed;
      }
    }

    try {
      if (changed) {
        await item.saveTx({ skipDateModifiedUpdate: true });
        if (rankChanged) {
          PaperBridge.Index.set(item, { rank: nextRank || "" });
        }
        PaperBridge.Util.refreshItemTreeColumns();
      }
    }
    catch (error) {
      this.restoreTagsWithPrefix(item, rankPrefix, previousRankTags);
      this.restoreTagsWithPrefix(item, statusPrefix, previousStatusTags);
      throw error;
    }
    return changed;
  },

  normalizeRank(rank) {
    const normalized = String(rank || "").trim();
    return PaperBridge.Constants.rankValues.includes(normalized) ? normalized : "";
  },

  normalizeStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    return PaperBridge.Constants.statusValues.includes(normalized) ? normalized : "";
  },

  syncSingleTag(item, prefix, nextTag) {
    const existing = item.getTags ? item.getTags() : [];
    let changed = false;

    for (const tag of existing) {
      if (tag.tag?.startsWith(prefix) && tag.tag !== nextTag) {
        this.removeTag(item, tag.tag);
        changed = true;
      }
    }

    const tags = item.getTags ? item.getTags().map(entry => entry.tag) : [];
    if (nextTag && !tags.includes(nextTag)) {
      item.addTag(nextTag, 0);
      changed = true;
    }
    return changed;
  },

  async ensureUnreadStatus(item) {
    if (this.getStatus(item)) {
      return;
    }
    const statusPrefix = PaperBridge.Settings.statusTagPrefix();
    const previousStatusTags = this.tagNamesWithPrefix(item.getTags ? item.getTags() : [], statusPrefix);
    if (this.syncSingleTag(item, statusPrefix, this.statusTag(PaperBridge.Constants.statusUnread))) {
      try {
        await item.saveTx({ skipDateModifiedUpdate: true });
      }
      catch (error) {
        this.restoreTagsWithPrefix(item, statusPrefix, previousStatusTags);
        throw error;
      }
    }
  },

  removeTag(item, tagName) {
    if (typeof item.removeTag === "function") {
      item.removeTag(tagName);
      return;
    }

    if (typeof item.setTags === "function") {
      const remaining = item.getTags().filter(tag => tag.tag !== tagName);
      item.setTags(remaining);
    }
  },

  tagNamesWithPrefix(tags, prefix) {
    return [...new Set((tags || [])
      .map(tag => tag?.tag || "")
      .filter(tagName => tagName.startsWith(prefix)))];
  },

  restoreTagsWithPrefix(item, prefix, tagNames) {
    try {
      for (const tagName of this.tagNamesWithPrefix(item.getTags ? item.getTags() : [], prefix)) {
        if (!tagNames.includes(tagName)) {
          this.removeTag(item, tagName);
        }
      }

      const current = new Set((item.getTags ? item.getTags() : []).map(tag => tag?.tag || ""));
      for (const tagName of tagNames) {
        if (tagName && !current.has(tagName)) {
          item.addTag(tagName, 0);
        }
      }
    }
    catch (restoreError) {
      PaperBridge.Util.safeLogError(restoreError);
    }
  }
};
