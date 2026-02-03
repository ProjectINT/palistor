// This file exists to prevent Next.js from picking up the parent project's proxy.ts
// The demo app doesn't need proxy/middleware functionality

import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  // No-op: just continue without any middleware logic
  return NextResponse.next();
}
