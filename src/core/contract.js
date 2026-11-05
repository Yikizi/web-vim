export const CONTRACT_VERSION = 1;
const kinds = new Set(["list", "grid", "tree", "article", "form"]);
const statuses = new Set(["executed", "confirmed", "unavailable", "stale", "failed"]);

// Validate structural claims independently of the adapter implementation.
export function validateSnapshot(snapshot) {
  const errors = [];
  if (snapshot?.version !== CONTRACT_VERSION) errors.push("Unsupported contract version");
  if (typeof snapshot?.pageKey !== "string" || !snapshot.pageKey)
    errors.push("Missing pageKey");
  if (!Array.isArray(snapshot?.regions)) return [...errors, "regions must be an array"];
  const regionIds = new Set();
  for (const region of snapshot.regions) {
    const prefix = `Region ${region.id}: `;
    if (typeof region.id !== "string" || !region.id || regionIds.has(region.id))
      errors.push(prefix + "missing/duplicate id");
    regionIds.add(region.id);
    if (!kinds.has(region.kind)) errors.push(prefix + "invalid kind");
    if (!Array.isArray(region.items)) {
      errors.push(prefix + "items must be an array");
      continue;
    }
    const ids = new Map();
    const elements = new Set();
    for (const item of region.items) {
      if (typeof item.id !== "string" || !item.id || ids.has(item.id))
        errors.push(prefix + "missing/duplicate item id " + item.id);
      ids.set(item.id, item);
      if (elements.has(item.element))
        errors.push(prefix + item.id + ": duplicate element");
      elements.add(item.element);
      if (
        region.kind === "grid" &&
        (!item.rect ||
          !["top", "bottom", "left", "right", "width", "height"].every((k) =>
            Number.isFinite(item.rect[k]),
          ))
      )
        errors.push(prefix + item.id + ": invalid grid geometry");
      if (typeof item.label !== "string")
        errors.push(prefix + item.id + ": missing label");
      if (!item.element || item.element.nodeType !== 1 || !item.element.isConnected)
        errors.push(prefix + item.id + ": disconnected element");
      if (!Array.isArray(item.actions) || item.actions.some((a) => typeof a !== "string"))
        errors.push(prefix + item.id + ": invalid actions");
      if (item.primaryAction && !item.actions?.includes(item.primaryAction))
        errors.push(prefix + item.id + ": primary action not advertised");
      if (item.parentId && region.kind !== "tree")
        errors.push(prefix + item.id + ": parent outside tree");
    }
    for (const item of region.items) {
      const seen = new Set([item.id]);
      let parent = item.parentId;
      while (parent) {
        if (!ids.has(parent)) {
          errors.push(prefix + item.id + ": missing parent " + parent);
          break;
        }
        if (seen.has(parent)) {
          errors.push(prefix + item.id + ": parent cycle");
          break;
        }
        seen.add(parent);
        parent = ids.get(parent).parentId;
      }
    }
  }
  return errors;
}
export function validateResult(result) {
  return Boolean(
    result &&
    statuses.has(result.status) &&
    (result.status !== "confirmed" ||
      (typeof result.evidence === "string" && result.evidence.length)),
  );
}
export const unavailable = (reason) => ({ status: "unavailable", reason });
