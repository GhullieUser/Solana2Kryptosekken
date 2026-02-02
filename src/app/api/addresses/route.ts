import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const addressSchema = z.object({
	address: z.string().min(32).max(64),
	label: z.string().trim().optional().nullable()
});

const deleteSchema = z.object({
	address: z.string().min(32).max(64).optional(),
	all: z.boolean().optional()
});

export async function GET() {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { data, error } = await supabase
		.from("search_addresses")
		.select("address,label,last_used_at,created_at")
		.order("last_used_at", { ascending: false })
		.limit(50);

	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	return NextResponse.json({ data });
}

export async function POST(req: Request) {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await req.json().catch(() => null);
	const parsed = addressSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
	}

	const { address, label } = parsed.data;
	const { error } = await supabase.from("search_addresses").upsert(
		{
			user_id: userData.user.id,
			address,
			label: label ?? null,
			last_used_at: new Date().toISOString()
		},
		{ onConflict: "user_id,address" }
	);

	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await req.json().catch(() => null);
	const parsed = deleteSchema.safeParse(body ?? {});
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
	}

	const { address, all } = parsed.data;

	if (all) {
		const { error } = await supabase
			.from("search_addresses")
			.delete()
			.eq("user_id", userData.user.id);
		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	}

	if (!address) {
		return NextResponse.json({ error: "Missing address" }, { status: 400 });
	}

	const { error } = await supabase
		.from("search_addresses")
		.delete()
		.eq("user_id", userData.user.id)
		.eq("address", address);

	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	return NextResponse.json({ ok: true });
}
