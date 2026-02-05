import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DEFAULT_FREE_GRANT = 50;

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function sha256Hex(value: string) {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function isEmailVerified(user: any) {
	return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

async function ensureFreeGrant(
	admin: ReturnType<typeof createSupabaseAdminClient>,
	user: any
) {
	const email = user?.email as string | undefined;
	if (!email || !isEmailVerified(user)) {
		return { grant: 0, rawUsed: 0, emailHash: null as string | null };
	}
	const emailHash = sha256Hex(normalizeEmail(email));
	const { data: existing } = await admin
		.from("billing_email_grants")
		.select("credits_granted, raw_used")
		.eq("email_hash", emailHash)
		.maybeSingle();
	if (existing) {
		return {
			grant: existing.credits_granted ?? DEFAULT_FREE_GRANT,
			rawUsed: existing.raw_used ?? 0,
			emailHash
		};
	}
	const { error: insertError } = await admin
		.from("billing_email_grants")
		.insert({
			email_hash: emailHash,
			raw_used: 0,
			credits_granted: DEFAULT_FREE_GRANT
		});
	if (insertError) {
		if (insertError.code === "23505") {
			const { data: retry } = await admin
				.from("billing_email_grants")
				.select("credits_granted, raw_used")
				.eq("email_hash", emailHash)
				.maybeSingle();
			return {
				grant: retry?.credits_granted ?? DEFAULT_FREE_GRANT,
				rawUsed: retry?.raw_used ?? 0,
				emailHash
			};
		}
		return { grant: 0, rawUsed: 0, emailHash };
	}
	return { grant: DEFAULT_FREE_GRANT, rawUsed: 0, emailHash };
}

export async function GET() {
	const supabase = await createSupabaseRouteClient();
	const admin = createSupabaseAdminClient();
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
	const { data: usageEvents } = await supabase
		.from("billing_usage_events")
		.select("raw_count")
		.eq("user_id", userId);
	const { data: credits } = await supabase
		.from("billing_user_credits")
		.select("credits_remaining")
		.eq("user_id", userId)
		.maybeSingle();

	const rawUsed = usage?.raw_tx_used ?? 0;
	const totalBilled = Array.isArray(usageEvents)
		? usageEvents.reduce((sum, row) => sum + (row.raw_count ?? 0), 0)
		: 0;
	const effectiveRawUsed = Math.max(rawUsed, totalBilled);
	const creditsRemaining = credits?.credits_remaining ?? 0;
	const { grant: freeGrant, rawUsed: freeUsed, emailHash } =
		await ensureFreeGrant(admin, userData.user);
	const syncedFreeUsed = Math.max(freeUsed, effectiveRawUsed);
	if (emailHash && syncedFreeUsed > freeUsed) {
		await admin
			.from("billing_email_grants")
			.update({ raw_used: syncedFreeUsed })
			.eq("email_hash", emailHash);
	}
	const freeRemaining = Math.max(0, freeGrant - syncedFreeUsed);

	return NextResponse.json({
		rawUsed: effectiveRawUsed,
		freeRemaining,
		creditsRemaining
	});
}
