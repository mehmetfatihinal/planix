import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { uploadFile } from "@/lib/api";

// R17 — photo-proof completion. Asks the user for a photo (camera first, gallery as
// fallback when camera permission is denied), uploads it via POST /files and returns
// the server file id. Returns null when the user cancels — callers must then abort
// the completion request instead of submitting without proof.

function confirmPhotoPrompt(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Fotoğraf kanıtı gerekli",
      "Bu görev fotoğraf kanıtı istiyor. Tamamlamak için bir fotoğraf ekleyin.",
      [
        { text: "Vazgeç", style: "cancel", onPress: () => resolve(false) },
        { text: "Fotoğraf çek", onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

async function pickPhoto(): Promise<{ uri: string; mimeType: string } | null> {
  // Camera first — proof photos should be taken on the spot.
  const cameraPermission = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
  if (cameraPermission?.granted) {
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (!shot.canceled && shot.assets?.[0]?.uri) {
      const asset = shot.assets[0];
      return { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" };
    }
    if (shot.canceled) return null;
  }

  // Camera unavailable/denied → fall back to the photo library.
  const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);
  if (!libraryPermission?.granted) {
    Alert.alert("İzin gerekli", "Fotoğraf kanıtı için kamera veya galeri izni vermeniz gerekiyor.");
    return null;
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.7,
    allowsEditing: false
  });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;
  const asset = picked.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" };
}

// Full flow: prompt → capture → upload. Returns the uploaded photo file id or null on cancel.
export async function captureAndUploadTaskPhoto(token: string, taskId: string): Promise<string | null> {
  const confirmed = await confirmPhotoPrompt();
  if (!confirmed) return null;

  const photo = await pickPhoto();
  if (!photo) return null;

  const uploaded = await uploadFile(token, photo.uri, photo.mimeType, "photo", taskId);
  return uploaded.id;
}
