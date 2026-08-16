// Self-check for fan-out spawn-group lookup. Run: npm run spawn:check
import { strict as assert } from "node:assert";
import { findGroupForTab } from "../src/lib/repo";
import type { SpawnGroup, SpawnGroupMember } from "../src/types";

const group = (id: string, parentTabId: string): SpawnGroup => ({
  id,
  parent_tab_id: parentTabId,
  label: null,
  created_at: 1000,
});

const member = (groupId: string, childTabId: string): SpawnGroupMember => ({
  group_id: groupId,
  child_tab_id: childTabId,
  cmd: null,
  created_at: 1000,
});

const groups = [group("g1", "tab-parent")];
const members = [member("g1", "tab-child-1"), member("g1", "tab-child-2")];

// Parent tab resolves to the group it owns.
assert.equal(findGroupForTab("tab-parent", groups, members)?.id, "g1", "parent lookup failed");

// Child tabs resolve to the same group via membership.
assert.equal(findGroupForTab("tab-child-1", groups, members)?.id, "g1", "child lookup failed");
assert.equal(findGroupForTab("tab-child-2", groups, members)?.id, "g1", "child lookup failed");

// A tab that is neither parent nor member is not in any group.
assert.equal(findGroupForTab("tab-unrelated", groups, members), null, "unrelated tab matched a group");

// Two independent groups never bleed into each other.
const twoGroups = [group("g1", "tab-parent-1"), group("g2", "tab-parent-2")];
const twoMembers = [member("g1", "tab-child-1"), member("g2", "tab-child-2")];
assert.equal(findGroupForTab("tab-child-1", twoGroups, twoMembers)?.id, "g1");
assert.equal(findGroupForTab("tab-child-2", twoGroups, twoMembers)?.id, "g2");
assert.equal(
  findGroupForTab("tab-parent-1", twoGroups, twoMembers)?.id,
  "g1",
  "wrong group returned for a parent that is also not a member of the other group"
);

console.log("spawn-check: all assertions passed");
