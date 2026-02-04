import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FREE_RAW_TX = 50;

export async function GET() {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const userId = userData.user.id;

	const { data: usage } = await supabase
		.from("billing_user_usage")
		.select("raw_tx_used")
		.eq("user_id", userId)
		.maybeSingle();
	const { data: credits } = await supabase
		.from("billing_user_credits")
		.select("credits_remaining")
		.eq("user_id", userId)
		.maybeSingle();

	const rawUsed = usage?.raw_tx_used ?? 0;
	const creditsRemaining = credits?.credits_remaining ?? 0;
	const freeRemaining = Math.max(0, FREE_RAW_TX - rawUsed);

	return NextResponse.json({
		rawUsed,
		freeRemaining,
		creditsRemaining
	});
}