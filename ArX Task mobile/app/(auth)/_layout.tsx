import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function AuthLayout() {
  const { token, loading } = useAuth();
  if (!loading && token) {
    return <Redirect href="/(app)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
