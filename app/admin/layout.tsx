"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-state";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) {
      router.replace("/today");
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return null;
  }
  if (!user.isAdmin) {
    return null;
  }
  return <>{children}</>;
}
