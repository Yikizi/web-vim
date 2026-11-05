// Pure navigation: no site names, selectors, DOM writes or keyboard handlers.
export class Navigation {
  constructor() {
    this.regionId = null;
    this.itemId = null;
    this.preferredX = null;
    this.snapshot = null;
    this.memory = new Map();
    this.restoring = false;
  }
  region() {
    return this.snapshot?.regions.find((r) => r.id === this.regionId);
  }
  item() {
    return this.region()?.items.find((i) => i.id === this.itemId);
  }
  save() {
    if (this.snapshot && this.itemId)
      this.memory.set(this.snapshot.pageKey, {
        regionId: this.regionId,
        itemId: this.itemId,
      });
    while (this.memory.size > 100) this.memory.delete(this.memory.keys().next().value);
  }
  update(snapshot) {
    const oldRegion = this.region(),
      oldItem = this.item();
    const index = oldRegion?.items.indexOf(oldItem) ?? -1;
    const pageChanged = snapshot.pageKey !== this.snapshot?.pageKey;
    this.save();
    this.snapshot = snapshot;
    if (pageChanged) {
      const saved = this.memory.get(snapshot.pageKey);
      this.regionId = saved?.regionId ?? snapshot.regions[0]?.id ?? null;
      this.itemId = saved?.itemId ?? null;
      this.restoring = Boolean(saved);
      this.preferredX = null;
    }
    if (!this.region() && !this.restoring) {
      this.regionId = snapshot.regions[0]?.id ?? null;
      this.itemId = null;
    }
    if (this.item()) this.restoring = false;
    if (this.itemId && !this.item() && !this.restoring) {
      // Collapsed descendants return to their surviving parent; deleted rows to next/previous.
      const items = this.region()?.items ?? [];
      let parent = oldItem?.parentId;
      while (!pageChanged && parent && !items.some((i) => i.id === parent))
        parent = oldRegion?.items.find((i) => i.id === parent)?.parentId;
      if (!pageChanged)
        this.itemId =
          parent || items[Math.max(0, Math.min(index, items.length - 1))]?.id || null;
      // On a new SPA route retain a saved ID until its asynchronously loaded item arrives.
    }
    return this.item();
  }
  select(id, regionId = this.regionId, preserveX = false) {
    const region = this.snapshot?.regions.find((r) => r.id === regionId);
    if (!region?.items.some((i) => i.id === id)) return null;
    this.regionId = regionId;
    this.itemId = id;
    this.restoring = false;
    if (!preserveX) this.preferredX = null;
    this.save();
    return this.item();
  }
  clear() {
    this.restoring = false;
    this.itemId = null;
    this.preferredX = null;
    if (this.snapshot) this.memory.delete(this.snapshot.pageKey);
  }
  switchRegion(delta) {
    const regions = this.snapshot?.regions ?? [];
    if (!regions.length) return null;
    const index = regions.findIndex((r) => r.id === this.regionId);
    const next = regions[(index + delta + regions.length) % regions.length];
    this.regionId = next.id;
    this.itemId = null;
    this.preferredX = null;
    return next.items.length ? this.select(next.items[0].id) : null;
  }
  move(direction, count = 1) {
    // Explicit user input abandons a restore whose region has not arrived.
    if (!this.region() && this.snapshot?.regions.length) {
      this.regionId = this.snapshot.regions[0].id;
      this.itemId = null;
      this.restoring = false;
    }
    const region = this.region(),
      items = region?.items ?? [];
    if (!items.length) return null;
    count = Math.max(1, Math.min(999, count));
    let current = this.item();
    if (!current)
      return this.select(
        items.find((i) => !i.rect || i.rect.bottom > 64)?.id ?? items[0].id,
      );
    if (region.kind === "grid") {
      const rect = current.rect;
      if (!rect) return current;
      const vertical = direction === "down" || direction === "up";
      if (vertical && this.preferredX === null)
        this.preferredX = (rect.left + rect.right) / 2;
      for (let n = 0; n < count; n++) {
        const r = current.rect;
        const cx = (r.left + r.right) / 2,
          cy = (r.top + r.bottom) / 2;
        if (vertical) {
          const sign = direction === "down" ? 1 : -1;
          const candidates = items.filter(
            (i) =>
              i.rect &&
              ((i.rect.top + i.rect.bottom) / 2 - cy) * sign >
                Math.max(8, Math.min(r.height, i.rect.height) * 0.4),
          );
          if (!candidates.length) break;
          const nearest = Math.min(
            ...candidates.map((i) => Math.abs((i.rect.top + i.rect.bottom) / 2 - cy)),
          );
          const row = candidates.filter(
            (i) =>
              Math.abs((i.rect.top + i.rect.bottom) / 2 - cy) <
              nearest + Math.max(12, r.height * 0.3),
          );
          current = row.sort(
            (a, b) =>
              Math.abs((a.rect.left + a.rect.right) / 2 - this.preferredX) -
              Math.abs((b.rect.left + b.rect.right) / 2 - this.preferredX),
          )[0];
        } else {
          const ordered = [...items].sort((a, b) =>
            Math.abs(a.rect.top - b.rect.top) <
            Math.min(a.rect.height, b.rect.height) * 0.4
              ? a.rect.left - b.rect.left
              : a.rect.top - b.rect.top,
          );
          current =
            ordered[
              Math.max(
                0,
                Math.min(
                  ordered.length - 1,
                  ordered.indexOf(current) + (direction === "right" ? 1 : -1),
                ),
              )
            ];
        }
      }
      return this.select(current.id, region.id, vertical);
    }
    for (let n = 0; n < count; n++) {
      let next;
      if (direction === "parent") next = items.find((i) => i.id === current.parentId);
      else if (direction === "child") next = items.find((i) => i.parentId === current.id);
      else if (direction === "siblingNext" || direction === "siblingPrev") {
        const siblings = items.filter((i) => i.parentId === current.parentId);
        next =
          siblings[siblings.indexOf(current) + (direction === "siblingNext" ? 1 : -1)];
      } else next = items[items.indexOf(current) + (direction === "down" ? 1 : -1)];
      if (!next) break;
      current = next;
    }
    return this.select(current.id);
  }
}
