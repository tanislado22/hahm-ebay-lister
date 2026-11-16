(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function fieldIsFillable(field) {
    const height = Number(field?.height) || 0;
    const width = Number(field?.width) || 0;
    if (width <= 0 || height <= 0) return false;
    const tag = String(field.tag || "").toLowerCase();
    if (tag === "textarea" || field.editable) return height < 600;
    return height < 120;
  }

  function matchesAlias(field, alias) {
    const wanted = String(alias || "").toLowerCase();
    if (!wanted) return false;
    const placeholder = String(field.placeholder || "").toLowerCase();
    const aria = String(field.aria || "").toLowerCase();
    const name = String(field.name || "").toLowerCase();
    const testId = String(field.testId || "").toLowerCase();
    if (placeholder.includes(wanted) || aria.includes(wanted) || name === wanted || testId.includes(wanted)) return true;
    const text = clean(field.label).toLowerCase();
    return text === wanted || text.startsWith(`${wanted} `);
  }

  function matchFillableField(fields, aliases) {
    for (const alias of aliases) {
      const match = (fields || []).find((field) => {
        const type = String(field.type || "").toLowerCase();
        if (type === "file" || type === "radio" || type === "checkbox" || type === "hidden") return false;
        return fieldIsFillable(field) && matchesAlias(field, alias);
      });
      if (match) return match;
    }
    return null;
  }

  return { fieldIsFillable, matchFillableField };
});
