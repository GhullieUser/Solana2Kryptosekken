// src/app/api/env/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ensure Node (not Edge) so process.env is available

export async function GET() {
	const key = process.env.HELIUS_API_KEY;
	const has = Boolean(key && key.trim());
	return NextResponse.json({
		hasKey: has,
		// never return the key itself; show only a tiny preview
		preview: has ? key!.slice(0, 6) + "…" : null,
		runtime: "nodejs"
	});
}
