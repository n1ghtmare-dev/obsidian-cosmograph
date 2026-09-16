import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteAdjacency, focusDistances, focusedNoteCount, normalizeFocusDepth } from "../src/graph/focus";
import { performanceProfileFor, sampleEvenly } from "../src/graph/performance";
import { buildGraphLookup } from "../src/graph/lookup";
import { groupNameFor } from "../src/obsidian/vaultGraph";
import type { GraphData, GraphNode } from "../src/types";

test("keeps the current top-level grouping at depth one", () => {
  assert.equal(groupNameFor("Projects/CosmoGraph/Ideas.md"), "Projects");
});

test("splits clusters by nested folders at greater depths", () => {
  assert.equal(groupNameFor("Projects/CosmoGraph/Ideas.md", 2), "Projects/CosmoGraph");
  assert.equal(groupNameFor("Projects/CosmoGraph/Research/Ideas.md", 3), "Projects/CosmoGraph/Research");
});

test("clamps depth to available folders and handles root notes", () => {
  assert.equal(groupNameFor("Decisions/Choice.md", 3), "Decisions");
  assert.equal(groupNameFor("Inbox.md", 3), "Root");
});

test("strips ordering prefixes while preserving numeric folder names", () => {
  assert.equal(groupNameFor("10. Projects/20 Alpha/Ideas.md", 2), "Projects/Alpha");
  assert.equal(groupNameFor("10 Projects/20 Alpha/Ideas.md", 2), "Projects/Alpha");
  assert.equal(groupNameFor("10. Projects/10.20 IT Projects/Ideas.md", 2), "Projects/IT Projects");
  assert.equal(groupNameFor("10. Projects/10.40.001 Indigo Media/Ideas.md", 2), "Projects/Indigo Media");
  assert.equal(groupNameFor("Archive/2025/January.md", 2), "Archive/2025");
  assert.equal(groupNameFor("Archive/2026/January.md", 2), "Archive/2026");
});

test("normalizes invalid and fractional depths", () => {
  assert.equal(groupNameFor("Projects/Alpha/Ideas.md", Number.NaN), "Projects");
  assert.equal(groupNameFor("Projects/Alpha/Ideas.md", 2.9), "Projects/Alpha");
});

const focusGraph: GraphData = {
  nodes: [
    { id: "a", title: "A", path: "Projects/A.md", group: "Projects" },
    { id: "b", title: "B", path: "Projects/B.md", group: "Projects" },
    { id: "c", title: "C", path: "Resources/C.md", group: "Resources" },
    { id: "d", title: "D", path: "Archive/D.md", group: "Archive" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "d" },
  ],
};

test("builds a note neighborhood without expanding through its folder cluster", () => {
  const adjacency = buildNoteAdjacency(focusGraph);
  const distances = focusDistances(focusGraph, focusGraph.nodes[0], 2, adjacency);
  assert.deepEqual([...(adjacency.get("b") ?? [])].sort(), ["a", "c"]);
  assert.equal(distances.get("a"), 0);
  assert.equal(distances.get("b"), 1);
  assert.equal(distances.get("c"), 2);
  assert.equal(distances.has("d"), false);
  assert.equal(distances.get("@cluster/Projects"), 1);
  assert.equal(focusedNoteCount(focusGraph, distances), 3);
});

test("starts cluster focus from every note in that cluster", () => {
  const cluster: GraphNode = {
    id: "@cluster/Projects",
    title: "Projects",
    path: "2 заметки в кластере",
    group: "Projects",
    kind: "cluster",
  };
  const distances = focusDistances(focusGraph, cluster, 2);
  assert.equal(distances.get(cluster.id), 0);
  assert.equal(distances.get("a"), 1);
  assert.equal(distances.get("b"), 1);
  assert.equal(distances.get("c"), 2);
});

test("clamps focus depth to the supported range", () => {
  assert.equal(normalizeFocusDepth(0), 1);
  assert.equal(normalizeFocusDepth(2.8), 2);
  assert.equal(normalizeFocusDepth(99), 3);
});

test("selects an adaptive rendering profile for the vault size", () => {
  assert.equal(performanceProfileFor(800).tier, "full");
  assert.equal(performanceProfileFor(801).tier, "balanced");
  assert.equal(performanceProfileFor(5_000).tier, "balanced");
  assert.equal(performanceProfileFor(5_001).tier, "massive");
});

test("samples large edge collections deterministically", () => {
  const sampled = sampleEvenly(Array.from({ length: 10 }, (_, index) => index), 4);
  assert.deepEqual(sampled, [0, 2, 5, 7]);
  assert.deepEqual(sampleEvenly([1, 2], 4), [1, 2]);
  assert.deepEqual(sampleEvenly([1, 2], 0), []);
});

test("precomputes graph lookups used by the details panel", () => {
  const lookup = buildGraphLookup(focusGraph);
  assert.equal(lookup.incomingCounts.get("b"), 1);
  assert.equal(lookup.outgoingCounts.get("b"), 1);
  assert.deepEqual(lookup.nodesByGroup.get("Projects")?.map((node) => node.id), ["a", "b"]);
  assert.equal(lookup.incidentEdgesByGroup.get("Projects"), 2);
  assert.equal(lookup.incidentEdgesByGroup.get("Resources"), 2);
});
