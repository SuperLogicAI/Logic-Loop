// Self-check for fan-out spawn-group lookup. Run: npm run spawn:check
import { strict as assert } from "node:assert";
import { findGroupsForTab } from "../src/lib/repo";
import type { SpawnGroup, SpawnGroupMember } from "../src/types";

const group = (id: string, parentTabId: string, createdAt = 1000): SpawnGroup => ({
  id,
  parent_tab_id: parentTabId,
  label: null,
  created_at: createdAt,
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
assert.deepEqual(
  findGroupsForTab("tab-parent", groups, members).map((g) => g.id),
  ["g1"],
  "parent lookup failed"
);

// Child tabs resolve to the same group via membership.
assert.deepEqual(findGroupsForTab("tab-child-1", groups, members).map((g) => g.id), ["g1"]);
assert.deepEqual(findGroupsForTab("tab-child-2", groups, members).map((g) => g.id), ["g1"]);

// A tab that is neither parent nor member is not in any group.
assert.deepEqual(findGroupsForTab("tab-unrelated", groups, members), []);

// Two independent groups (different parents) never bleed into each other.
const twoGroups = [group("g1", "tab-parent-1"), group("g2", "tab-parent-2")];
const twoMembers = [member("g1", "tab-child-1"), member("g2", "tab-child-2")];
assert.deepEqual(findGroupsForTab("tab-child-1", twoGroups, twoMembers).map((g) => g.id), ["g1"]);
assert.deepEqual(findGroupsForTab("tab-child-2", twoGroups, twoMembers).map((g) => g.id), ["g2"]);
assert.deepEqual(
  findGroupsForTab("tab-parent-1", twoGroups, twoMembers).map((g) => g.id),
  ["g1"],
  "wrong group returned for a parent that is also not a member of the other group"
);

// --- The bug this fix exists for: fanning out twice from the same tab. ---
// Old behavior (a single `.find()`) returned only the first-created group and
// silently hid the second until the first was fully dismissed. Both must be
// visible now, oldest first — that's the "priority to the initial fan-out,
// newer ones queue behind it" behavior asked for.
const sameParentGroups = [group("old", "tab-parent", 1000), group("new", "tab-parent", 2000)];
const sameParentMembers = [member("old", "tab-child-old"), member("new", "tab-child-new")];
assert.deepEqual(
  findGroupsForTab("tab-parent", sameParentGroups, sameParentMembers).map((g) => g.id),
  ["old", "new"],
  "a second fan-out from the same tab was hidden behind the first"
);
// Order holds regardless of DB row order — sorted by created_at, not insertion order.
const reversedInput = [group("new", "tab-parent", 2000), group("old", "tab-parent", 1000)];
assert.deepEqual(
  findGroupsForTab("tab-parent", reversedInput, sameParentMembers).map((g) => g.id),
  ["old", "new"],
  "groups were not sorted oldest-first"
);

console.log("spawn-check: all assertions passed");
