/**
 * A REST API's resources, which GetResources lists flat, as the tree of paths
 * they form.
 */
import type { RestApiResource } from "@faws/contracts";

export interface ResourceNode {
  readonly resource: RestApiResource;
  readonly children: ReadonlyArray<ResourceNode>;
}

/** One line of the tree as it is drawn: a resource, how deep it sits, and why it is shown. */
export interface ResourceRow {
  readonly resource: RestApiResource;
  readonly depth: number;
  /** False for a row shown only because something under it matched the filter. */
  readonly matched: boolean;
}

function byPath(a: ResourceNode, b: ResourceNode): number {
  // Code point order, so a `{param}` sibling sorts after the literal paths.
  return a.resource.path < b.resource.path ? -1 : a.resource.path > b.resource.path ? 1 : 0;
}

/**
 * Nests each resource under its parent, siblings sorted by path.
 *
 * A resource whose parent is not in the list becomes a root of its own rather
 * than being dropped, so a listing that stopped short still shows everything
 * it reached.
 */
export function buildResourceTree(resources: ReadonlyArray<RestApiResource>): ResourceNode[] {
  const ids = new Set(resources.map((resource) => resource.id));
  const childrenOf = new Map<string, RestApiResource[]>();
  const roots: RestApiResource[] = [];
  for (const resource of resources) {
    const parent = resource.parentId;
    if (parent === null || parent === resource.id || !ids.has(parent)) {
      roots.push(resource);
      continue;
    }
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(resource);
    else childrenOf.set(parent, [resource]);
  }

  const visited = new Set<string>();
  const nodeFor = (resource: RestApiResource): ResourceNode => {
    visited.add(resource.id);
    const children = (childrenOf.get(resource.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .map(nodeFor)
      .toSorted(byPath);
    return { resource, children };
  };
  return roots.map(nodeFor).toSorted(byPath);
}

/** Whether a resource's path, a method on it, or where a method sends requests contains `needle`. */
export function resourceMatches(resource: RestApiResource, needle: string): boolean {
  const lower = needle.trim().toLowerCase();
  if (lower === "") return true;
  if (resource.path.toLowerCase().includes(lower)) return true;
  return resource.methods.some(
    (method) =>
      method.httpMethod.toLowerCase() === lower ||
      (method.operationName?.toLowerCase().includes(lower) ?? false) ||
      (method.integration?.uri?.toLowerCase().includes(lower) ?? false),
  );
}

/**
 * The tree drawn depth first, narrowed to the resources matching `filter` and
 * the paths leading down to them.
 */
export function resourceRows(tree: ReadonlyArray<ResourceNode>, filter: string): ResourceRow[] {
  const rows: ResourceRow[] = [];
  const walk = (node: ResourceNode, depth: number): boolean => {
    const matched = resourceMatches(node.resource, filter);
    const at = rows.length;
    let below = false;
    for (const child of node.children) {
      if (walk(child, depth + 1)) below = true;
    }
    if (matched || below) {
      rows.splice(at, 0, { resource: node.resource, depth, matched });
      return true;
    }
    return false;
  };
  for (const node of tree) walk(node, 0);
  return rows;
}
