/**
 * Vulnerability marker colours: the border of a node with vulnerabilities goes from light orange (lowest
 * severity of the scale) to pinkish red (highest).
 */
const LIGHT_ORANGE = [255, 192, 120] as const; // #ffc078
const PINKISH_RED = [230, 73, 128] as const; // #e64980

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** Position of a rank on the scale, 0 (lowest) to 1 (highest). */
export function severityPosition(rank: number, scale: Record<string, number>): number {
  const ranks = Object.values(scale);
  if (ranks.length === 0) return 1;
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  if (max === min) return 1;
  return Math.min(1, Math.max(0, (rank - min) / (max - min)));
}

export function severityColor(position: number): string {
  const t = Math.min(1, Math.max(0, position));
  const channel = (i: 0 | 1 | 2) => hex(LIGHT_ORANGE[i] + (PINKISH_RED[i] - LIGHT_ORANGE[i]) * t);
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Highest severity rank among a node's vulnerabilities, or null when it has none (or none is on the scale). */
export function maxSeverityRank(node: Record<string, unknown>, scale: Record<string, number>): number | null {
  const findings = Array.isArray(node.vulnerabilities) ? (node.vulnerabilities as { severity?: unknown }[]) : [];
  if (findings.length === 0) return null;
  let best: number | null = null;
  for (const f of findings) {
    const rank = typeof f?.severity === 'string' ? scale[f.severity.trim().toLowerCase()] : undefined;
    if (rank !== undefined && (best === null || rank > best)) best = rank;
  }
  // a node with findings whose severity is unknown to the scale is still marked, at the lowest position
  return best ?? Math.min(...Object.values(scale), 0);
}

/** Border colour for a node, or undefined when it has no vulnerabilities. */
export function vulnerabilityColor(node: Record<string, unknown>, scale: Record<string, number>): string | undefined {
  const rank = maxSeverityRank(node, scale);
  return rank === null ? undefined : severityColor(severityPosition(rank, scale));
}

/** Colour of a route that passes no vulnerable node. */
export const NO_VULNERABILITY_COLOR = '#000000';

export interface RouteSeverity {
  /** Highest severity rank on the route, or null when no node of the route has a vulnerability. */
  rank: number | null;
  /** The colour used for vulnerable nodes at that severity; black when there is none. */
  color: string;
}

/** The highest vulnerability severity among the nodes of a route, with the colour that marks it. */
export function routeSeverity(
  nodeIds: readonly string[],
  nodes: Record<string, Record<string, unknown>>,
  scale: Record<string, number>,
): RouteSeverity {
  let best: number | null = null;
  for (const id of nodeIds) {
    const node = nodes[id];
    const rank = node ? maxSeverityRank(node, scale) : null;
    if (rank !== null && (best === null || rank > best)) best = rank;
  }
  return best === null
    ? { rank: null, color: NO_VULNERABILITY_COLOR }
    : { rank: best, color: severityColor(severityPosition(best, scale)) };
}
