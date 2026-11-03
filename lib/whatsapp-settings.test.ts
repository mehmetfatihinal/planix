import assert from "node:assert/strict";
import test from "node:test";
import { whatsAppEnabledFor, whatsAppSettingsPayload } from "./whatsapp-settings.ts";

test("boş saat gönderilmez, API mevcut saati korur", () => {
  const payload = whatsAppSettingsPayload("+905321234567", true, "");
  assert.equal(payload.whatsAppDigestTime, undefined);
  assert.equal("whatsAppDigestTime" in JSON.parse(JSON.stringify(payload)), false);
});

test("dolu saat kırpılarak gönderilir", () => {
  assert.equal(whatsAppSettingsPayload("+905321234567", true, " 07:30 ").whatsAppDigestTime, "07:30");
});

test("numara boşsa özet kapalı gönderilir", () => {
  const payload = whatsAppSettingsPayload("   ", true, "08:00");
  assert.equal(payload.whatsAppNumber, "");
  assert.equal(payload.whatsAppDigestEnabled, false);
});

test("numara silinince anahtar kapanır, numara varken dokunulmaz", () => {
  assert.equal(whatsAppEnabledFor("", true), false);
  assert.equal(whatsAppEnabledFor("  ", true), false);
  assert.equal(whatsAppEnabledFor("+90532", true), true);
  assert.equal(whatsAppEnabledFor("+90532", false), false);
});
