import assert from "node:assert/strict";
import test from "node:test";
import { groupNameFor } from "../src/obsidian/vaultGraph";

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
  assert.equal(groupNameFor("Archive/2025/January.md", 2), "Archive/2025");
  assert.equal(groupNameFor("Archive/2026/January.md", 2), "Archive/2026");
});

test("normalizes invalid and fractional depths", () => {
  assert.equal(groupNameFor("Projects/Alpha/Ideas.md", Number.NaN), "Projects");
  assert.equal(groupNameFor("Projects/Alpha/Ideas.md", 2.9), "Projects/Alpha");
});
