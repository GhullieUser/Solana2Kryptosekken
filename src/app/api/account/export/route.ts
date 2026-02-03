import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { data, error } = await supabase
		.from("search_addresses")
		.select("address,label,last_used_at,created_at")
		.order("last_used_at", { ascending: false });

	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	const { data: csvs, error: csvError } = await supabase
		.from("generated_csvs")
		.select(
			"address,label,raw_count,processed_count,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval,created_at,updated_at"
		)
		.order("updated_at", { ascending: false });

	if (csvError) {
		return NextResponse.json({ error: csvError.message }, { status: 500 });
	}

	return NextResponse.json({
		user: {
			id: userData.user.id,
			email: userData.user.email
		},
		addresses: data ?? [],
		generated_csvs: csvs ?? []
	});
}
