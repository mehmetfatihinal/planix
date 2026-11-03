import assert from "node:assert/strict";
import { test } from "node:test";
import { whatsAppSettingsPatch } from "./whatsapp-settings";

test("dolu alanları olduğu gibi gönderir", () => {
  assert.deepEqual(whatsAppSettingsPatch(" 0532 123 45 67 ", true, "07:15"), {
    whatsAppNumber: "0532 123 45 67",
    whatsAppDigestEnabled: true,
    whatsAppDigestTime: "07:15"
  });
});

test("boş saat alanı gönderilmez (diğer ayarların kaydını engellemesin)", () => {
  const patch = whatsAppSettingsPatch("+905321234567", true, "");
  assert.equal("whatsAppDigestTime" in patch, false);
});

test("numara silinince özet kapatılır", () => {
  assert.deepEqual(whatsAppSettingsPatch("   ", true, "08:00"), {
    whatsAppNumber: "",
    whatsAppDigestEnabled: false,
    whatsAppDigestTime: "08:00"
  });
});
