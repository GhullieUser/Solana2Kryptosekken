import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE() {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const email = userData.user.email?.trim().toLowerCase();
	if (email) {
		const emailHash = crypto.createHash("sha256").update(email).digest("hex");
		const adminForGrant = createSupabaseAdminClient();
		await adminForGrant
			.from("billing_email_grants")
			.update({ user_id: null })
			.eq("email_hash", emailHash);
	}

	const admin = createSupabaseAdminClient();
	const { error } = await admin.auth.admin.deleteUser(userData.user.id);
	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	return NextResponse.json({ ok: true });
}
