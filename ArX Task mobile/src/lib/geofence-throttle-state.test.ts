import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canNotify,
  emptyState,
  normalizeState,
  todayKeyLocal,
  withMuted,
  withNotified
} from "./geofence-throttle-state";

const HOUR = 60 * 60 * 1000;
const TODAY = "2026-07-27";
const NOW = 1_800_000_000_000;

test("todayKeyLocal yerel tarihi YYYY-MM-DD verir", () => {
  assert.equal(todayKeyLocal(new Date(2026, 6, 27, 9, 30)), "2026-07-27");
  assert.equal(todayKeyLocal(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("hiç kaydı olmayan bölge bildirilebilir", () => {
  assert.equal(canNotify(emptyState(TODAY), "opp:a", "task-opportunity", NOW), true);
});

test("gün değişince durum sıfırlanır", () => {
  const yesterday = withNotified(emptyState("2026-07-26"), "opp:a", NOW);
  const normalized = normalizeState(yesterday, TODAY);
  assert.deepEqual(normalized, emptyState(TODAY));
  assert.equal(canNotify(normalized, "opp:a", "task-opportunity", NOW), true);
});

test("yol üzeri fırsat günde bir kez bildirilir", () => {
  const state = withNotified(emptyState(TODAY), "opp:a", NOW);
  assert.equal(canNotify(state, "opp:a", "task-opportunity", NOW + 6 * HOUR), false);
  assert.equal(canNotify(state, "opp:a", "task-opportunity", NOW + 25 * HOUR), true);
});

test("bugünün görev firması 4 saat sonra tekrar bildirilir", () => {
  const state = withNotified(emptyState(TODAY), "company-1", NOW);
  assert.equal(canNotify(state, "company-1", "company", NOW + 3 * HOUR), false);
  assert.equal(canNotify(state, "company-1", "company", NOW + 4 * HOUR), true);
});

test("susturulan bölge süre dolsa da bildirilmez", () => {
  const state = withMuted(withNotified(emptyState(TODAY), "opp:a", NOW), "opp:a", NOW);
  assert.equal(canNotify(state, "opp:a", "task-opportunity", NOW + 48 * HOUR), false);
});

test("susturma diğer bölgeleri etkilemez", () => {
  const state = withMuted(emptyState(TODAY), "opp:a", NOW);
  assert.equal(canNotify(state, "opp:b", "task-opportunity", NOW), true);
});

test("withNotified mevcut susturmayı bozmaz", () => {
  const state = withNotified(withMuted(emptyState(TODAY), "opp:a", NOW), "opp:a", NOW + HOUR);
  assert.equal(state.entries["opp:a"]!.muted, true);
});
