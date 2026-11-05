/** Contract v1. Adapters read DOM and execute named capabilities; core owns input and selection. */
export type RegionKind = "list" | "grid" | "tree" | "article" | "form";
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}
export interface Item {
  /** Stable domain identity scoped to a region, never an array index. */
  id: string;
  label: string;
  element: Element;
  rect?: Rect;
  actions: string[];
  primaryAction?: string;
  parentId?: string;
  collapsed?: boolean;
  href?: string | null;
  link?: HTMLAnchorElement | null;
}
export interface Region {
  id: string;
  label?: string;
  kind: RegionKind;
  items: Item[];
}
export interface Snapshot {
  version: 1;
  pageKey: string;
  regions: Region[];
}
export type ActionResult =
  | { status: "confirmed"; evidence: string }
  | { status: "executed" }
  | { status: "unavailable" | "stale" | "failed"; reason?: string };
export interface Adapter {
  id: string;
  matches(): boolean;
  read(): Snapshot;
  execute(
    action: string,
    item: Item | null,
    context: { guard(): boolean },
  ): ActionResult | Promise<ActionResult>;
  /** Page actions work without an item; execute receives the current item, if any. */
  pageActions?: string[];
  /** Pure route policy. The core performs the redirect, never read(). */
  redirect?(): string | null;
  shortcuts?: {
    keys: string;
    action?: string;
    label: string;
    scope?: "page";
    region?: string;
  }[];
}

/** Native mode enables only explicit additions; passthrough disables every binding. */
export interface KeyboardPolicy {
  defaultMode: "normal" | "native" | "passthrough";
  supplementalKeys?: string[];
  reason?: string;
}
