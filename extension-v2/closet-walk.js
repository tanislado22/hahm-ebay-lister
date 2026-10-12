(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VINTED_SYNC_LIMIT = 30;

  function emptyProgress() {
    return { order: [], committed: [] };
  }

  function mergeClosetOrder(stored, visible) {
    const order = [];
    const seen = new Set();
    for (const id of stored || []) {
      const key = String(id || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
    const index = new Map(order.map((id, position) => [id, position]));
    let lastKnown = -1;
    let pending = [];
    const insertions = [];
    const flush = () => {
      if (!pending.length) return;
      insertions.push({ after: lastKnown, ids: pending });
      pending = [];
    };
    for (const id of visible || []) {
      const key = String(id || "").trim();
      if (!key) continue;
      if (index.has(key)) {
        flush();
        lastKnown = index.get(key);
        continue;
      }
      if (!pending.includes(key)) pending.push(key);
    }
    flush();
    insertions.sort((left, right) => right.after - left.after);
    for (const insertion of insertions) {
      const fresh = insertion.ids.filter((id) => !index.has(id));
      if (!fresh.length) continue;
      const at = insertion.after + 1;
      order.splice(at, 0, ...fresh);
      fresh.forEach((id, offset) => index.set(id, at + offset));
    }
    return order;
  }

  function nextBatchItems(order, committed, payloads, limit) {
    const done = new Set(committed || []);
    const batch = [];
    let blocked = false;
    const cap = limit || VINTED_SYNC_LIMIT;
    for (const id of order || []) {
      if (done.has(id)) continue;
      const item = payloads ? payloads[id] : null;
      if (!item) {
        blocked = true;
        break;
      }
      batch.push(item);
      if (batch.length >= cap) break;
    }
    return { batch, blocked };
  }

  function commitSynced(progress, ids) {
    const done = new Set(progress.committed || []);
    for (const id of ids || []) {
      const key = String(id || "").trim();
      if (key) done.add(key);
    }
    return { order: progress.order || [], committed: Array.from(done) };
  }

  function summarizeKnownIds(existingIds, batchIds) {
    const existing = new Set(existingIds || []);
    const seen = new Set();
    let inserted = 0;
    let already = 0;
    for (const id of batchIds || []) {
      const key = String(id || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (existing.has(key)) already += 1;
      else inserted += 1;
    }
    return { received: seen.size, inserted, existing: already };
  }

  return {
    VINTED_SYNC_LIMIT,
    emptyProgress,
    mergeClosetOrder,
    nextBatchItems,
    commitSynced,
    summarizeKnownIds,
  };
});
