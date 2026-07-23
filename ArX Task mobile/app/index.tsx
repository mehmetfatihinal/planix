import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function IndexRoute() {
  const { token, loading } = useAuth();
  if (loading) {
    return null;
  }
  return <Redirect href={token ? "/(app)" : "/(auth)/login"} />;
}
