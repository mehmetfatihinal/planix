import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { LanguageCode } from "@/types/business";

export const AUTH_TOKEN_KEY = "arx-task-mobile.auth-token";
export const LANGUAGE_KEY = "arx-task-mobile.language";

export async function setToken(token: string) {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

export async function getToken() {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function removeToken() {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}

export async function setLanguage(language: LanguageCode) {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
}

export async function getLanguage() {
  return AsyncStorage.getItem(LANGUAGE_KEY);
}
