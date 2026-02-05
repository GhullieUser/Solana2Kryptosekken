import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
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

export async function POST() {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const email = userData.user.email;
	if (!email || !isEmailVerified(userData.user)) {
		return NextResponse.json({ error: "Email not verified" }, { status: 400 });
	}

	const emailHash = sha256Hex(normalizeEmail(email));
	const admin = createSupabaseAdminClient();

	const { data: existing } = await admin
		.from("billing_email_grants")
		.select("credits_granted")
		.eq("email_hash", emailHash)
		.maybeSingle();

	if (existing) {
		return NextResponse.json({
			granted: false,
			creditsGranted: existing.credits_granted ?? 0
		});
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
			return NextResponse.json({
				granted: false,
				creditsGranted: DEFAULT_FREE_GRANT
			});
		}
		return NextResponse.json({ error: insertError.message }, { status: 500 });
	}

	return NextResponse.json({
		granted: true,
		creditsGranted: DEFAULT_FREE_GRANT
	});
}
