import { useEffect } from "react";
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { ensureMobilePushRegistration } from "@/lib/notifications";
import { requestGeofencePermissions } from "@/lib/geofencing";

export default function AppLayout() {
  const { token, loading } = useAuth();

  useEffect(() => {
    if (!token) return;
    // First authenticated entry: ask for notification permission (via push registration) and
    // location permission (foreground + background) so proximity task reminders can work.
    // Safe to call repeatedly — backend de-dupes by ExpoPushToken and OS de-dupes permissions.
    ensureMobilePushRegistration(token).catch(() => undefined);
    requestGeofencePermissions().catch(() => undefined);
  }, [token]);

  if (!loading && !token) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
