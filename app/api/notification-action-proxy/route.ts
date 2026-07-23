import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/api-client";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const response = await fetch(`${API_URL}/notifications/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" }
  });
}
