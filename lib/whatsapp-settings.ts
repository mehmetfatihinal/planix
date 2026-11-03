import type { UserSettings } from "@/types/business";

type WhatsAppPatch = Pick<Partial<UserSettings>, "whatsAppNumber" | "whatsAppDigestEnabled" | "whatsAppDigestTime">;

// Ayarlar formundaki WhatsApp alanlarını PUT /settings gövdesine çevirir.
// Boş saat gönderilmez (API reddeder ve diğer ayarların kaydı da düşer);
// numara silinmişse özet kapatılır (API numarasız açmaya izin vermez).
export function whatsAppSettingsPatch(number: string, enabled: boolean, time: string): WhatsAppPatch {
  const whatsAppNumber = number.trim();
  const patch: WhatsAppPatch = {
    whatsAppNumber,
    whatsAppDigestEnabled: whatsAppNumber.length > 0 && enabled
  };
  if (time.trim()) patch.whatsAppDigestTime = time.trim();
  return patch;
}
