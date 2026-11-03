import assert from "node:assert/strict";
import { test } from "node:test";
import { shiftDigestTime } from "./whatsapp-time";

test("15 dakika ileri ve geri kaydırır", () => {
  assert.equal(shiftDigestTime("08:00", 15), "08:15");
  assert.equal(shiftDigestTime("08:00", -15), "07:45");
});

test("gün sınırında döner", () => {
  assert.equal(shiftDigestTime("23:45", 15), "00:00");
  assert.equal(shiftDigestTime("00:00", -15), "23:45");
});

test("15'in katı olmayan saati en yakın 15'e oturtur", () => {
  assert.equal(shiftDigestTime("08:07", 15), "08:15");
  assert.equal(shiftDigestTime("08:07", -15), "08:00");
});

test("bozuk değerde 08:00'dan başlar", () => {
  assert.equal(shiftDigestTime("", 15), "08:15");
  assert.equal(shiftDigestTime("bozuk", -15), "07:45");
});
