import { Stack, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { AppDataProvider } from "@/lib/app-data-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n";
import { LocationProvider } from "@/lib/location-context";
import {
  addNotificationResponseReceivedListener,
  configureNotificationCategories,
  handleNotificationActionResponse,
  initializeNotifications
} from "@/lib/notifications";
// Side-effect import: registers the background geofencing TaskManager task at startup so the
// OS can invoke it (even when the app is launched headlessly for a geofence event).
import "@/lib/geofencing";

function useImmersiveNavigationBar() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    // Hide the system navigation bar and let it return on swipe-up.
    NavigationBar.setVisibilityAsync("hidden").catch(() => undefined);
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => undefined);
  }, []);
}

function NotificationBridge() {
  const router = useRouter();
  const { token } = useAuth();
  // Tracked via ref so the listener (registered once) always sees the latest token
  // without re-subscribing on every login/logout cycle.
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    initializeNotifications();
    configureNotificationCategories().catch(() => undefined);

    const subscription = addNotificationResponseReceivedListener((response) => {
      handleNotificationActionResponse(response, tokenRef.current).catch(() => undefined);
      const data = response.notification.request.content.data as { url?: string; taskId?: string; habit?: string };
      const actionIdentifier = response?.actionIdentifier;
      // Inline approve/reject — don't navigate; user stays where they were.
      if (actionIdentifier === "approve" || actionIdentifier === "reject") {
        return;
      }
      if (data?.url === "/habits") {
        // Alışkanlık dürtüsü / günlük hatırlatma → Alışkanlıklar ekranı (habit id ile vurgula).
        router.push({ pathname: "/(app)/habits", params: data?.habit ? { habit: String(data.habit) } : {} } as never);
      } else if (data?.url === "/admin/approvals") {
        router.push("/admin/approvals" as never);
      } else if (data?.url === "/route-planner") {
        // Home-exit auto-route notification → straight into the prepared route.
        router.push("/route-planner" as never);
      } else if (data?.url === "/shopping") {
        // Seller-proximity shopping reminder.
        router.push("/shopping" as never);
      } else if (data?.taskId) {
        router.push({ pathname: "/today", params: { task: data.taskId } });
      } else if (data?.url) {
        router.push("/today");
      }
    });

    return () => subscription.remove();
  }, [router]);

  return null;
}

export default function RootLayout() {
  useImmersiveNavigationBar();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <AuthProvider>
            <LocationProvider>
              <AppDataProvider>
                <NotificationBridge />
                <StatusBar style="light" />
                <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
              </AppDataProvider>
            </LocationProvider>
          </AuthProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
