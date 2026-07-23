import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_URL } from "@/lib/api";
import type { Invoice, Offer } from "@/types/business";

// Downloads an authenticated PDF from the API to the app cache, then opens the OS
// share sheet. downloadAsync carries the JWT in the Authorization header — the URL
// itself is never shared, only the local file.
export async function downloadAndSharePdf(token: string, path: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const target = `${FileSystem.cacheDirectory}${safeName}`;

  const result = await FileSystem.downloadAsync(`${API_URL}${path}`, target, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (result.status !== 200) {
    throw new Error(`PDF indirilemedi (${result.status}). Sunucuda PDF hazır olmayabilir.`);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, { mimeType: "application/pdf", dialogTitle: safeName });
  } else {
    throw new Error("Bu cihazda paylaşım desteklenmiyor.");
  }

  return result.uri;
}

export async function shareOfferPdf(token: string, offer: Pick<Offer, "id" | "offerNumber">) {
  return downloadAndSharePdf(token, `/offers/${offer.id}/pdf`, `teklif-${offer.offerNumber || offer.id}.pdf`);
}

export async function shareInvoicePdf(token: string, invoice: Pick<Invoice, "id" | "invoiceNumber">) {
  return downloadAndSharePdf(token, `/invoices/${invoice.id}/pdf`, `fatura-${invoice.invoiceNumber || invoice.id}.pdf`);
}
