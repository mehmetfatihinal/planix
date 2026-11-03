// WhatsApp sabah özeti ayarları: numara yoksa özet açık kalamaz.
export function whatsAppEnabledFor(number: string, enabled: boolean): boolean {
  return enabled && number.trim().length > 0;
}

// Ayarlar kaydedilirken gönderilecek WhatsApp alanları. Boş saat gönderilmez (undefined JSON'a
// yazılmaz), API mevcut saati korur; böylece ilgisiz ayarların kaydı "Geçersiz saat" ile düşmez.
export function whatsAppSettingsPayload(number: string, enabled: boolean, time: string) {
  const trimmedNumber = number.trim();
  return {
    whatsAppNumber: trimmedNumber,
    whatsAppDigestEnabled: whatsAppEnabledFor(trimmedNumber, enabled),
    whatsAppDigestTime: time.trim() || undefined
  };
}
