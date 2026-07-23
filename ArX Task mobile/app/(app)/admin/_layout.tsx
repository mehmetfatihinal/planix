import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function AdminLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user?.isAdmin) {
    return <Redirect href="/(app)" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
