import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const csvSchema = z.object({
	address: z.string().min(32).max(64),
	label: z.string().trim().optional().nullable(),
	csv: z.string().min(1),
	rawCount: z.number().int().nonnegative().optional(),
	processedCount: z.number().int().nonnegative().optional(),
	partial: z.boolean().optional(),
	scanSessionId: z.string().optional().nullable(),
	fromISO: z.string().optional().nullable(),
	toISO: z.string().optional().nullable(),
	includeNFT: z.boolean().optional(),
	useOslo: z.boolean().optional(),
	dustMode: z.string().optional().nullable(),
	dustThreshold: z.union([z.string(), z.number()]).optional().nullable(),
	dustInterval: z.string().optional().nullable(),
	txMeta: z.array(z.unknown()).optional().nullable()
});

function isMissingTxMetaColumnError(
	error: { code?: string; message?: string } | null
) {
	if (!error) return false;
	if (error.code === "42703") return true;
	const msg = String(error.message ?? "").toLowerCase();
	return (
		msg.includes("tx_meta") &&
		(msg.includes("column") || msg.includes("does not exist"))
	);
}

function normalizeTxMeta(raw: unknown): unknown[] | null {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed;
			if (parsed && typeof parsed === "object") {
				const values = Object.values(parsed as Record<string, unknown>);
				return values.length > 0 ? values : null;
			}
		} catch {
			return null;
		}
		return null;
	}
	if (raw && typeof raw === "object") {
		const values = Object.values(raw as Record<string, unknown>);
		return values.length > 0 ? values : null;
	}
	return null;
}

export async function GET(req: Request) {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(req.url);
	const address = url.searchParams.get("address");
	const id = url.searchParams.get("id");
	const format = url.searchParams.get("format");

	if (id || address) {
		if (address && format === "list") {
			const { data, error } = await supabase
				.from("generated_csvs")
				.select(
					"id,address,label,created_at,updated_at,raw_count,processed_count,partial,scan_session_id,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval"
				)
				.eq("address", address)
				.order("updated_at", { ascending: false });
			if (error) {
				return NextResponse.json({ error: error.message }, { status: 500 });
			}
			return NextResponse.json({ data: data ?? [] });
		}

		let { data, error } = await supabase
			.from("generated_csvs")
			.select(
				"id,csv_text,address,label,raw_count,processed_count,partial,scan_session_id,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval,tx_meta,created_at,updated_at"
			)
			.eq(id ? "id" : "address", id ?? address)
			.single();

		if (isMissingTxMetaColumnError(error)) {
			const fallback = await supabase
				.from("generated_csvs")
				.select(
					"id,csv_text,address,label,raw_count,processed_count,partial,scan_session_id,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval,created_at,updated_at"
				)
				.eq(id ? "id" : "address", id ?? address)
				.single();
			data = fallback.data as typeof data;
			error = fallback.error;
		}

		if (error || !data?.csv_text) {
			return NextResponse.json(
				{ error: error?.message || "Not found" },
				{ status: 404 }
			);
		}

		const txMetaBlob = normalizeTxMeta(data.tx_meta);

		if (format === "json") {
			return NextResponse.json({
				csv: data.csv_text,
				txMeta: txMetaBlob ?? null,
				meta: {
					address: data.address,
					label: data.label,
					raw_count: data.raw_count,
					processed_count: data.processed_count,
					partial: data.partial,
					scan_session_id: data.scan_session_id,
					from_iso: data.from_iso,
					to_iso: data.to_iso,
					include_nft: data.include_nft,
					use_oslo: data.use_oslo,
					dust_mode: data.dust_mode,
					dust_threshold: data.dust_threshold,
					dust_interval: data.dust_interval,
					created_at: data.created_at,
					updated_at: data.updated_at
				}
			});
		}

		return new Response(data.csv_text, {
			headers: {
				"Content-Type": "text/csv;charset=utf-8",
				"Content-Disposition": `attachment; filename=\"sol2ks_${data.address}.csv\"`
			}
		});
	}

	const { data, error } = await supabase
		.from("generated_csvs")
		.select(
			"id,address,label,created_at,updated_at,raw_count,processed_count,partial,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval"
		)
		.order("updated_at", { ascending: false });

	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: Request) {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await req.json().catch(() => null);
	const parsed = csvSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
	}

	const data = parsed.data;
	const baseUpsertPayload = {
		user_id: userData.user.id,
		address: data.address,
		label: data.label ?? null,
		csv_text: data.csv,
		raw_count: data.rawCount ?? null,
		processed_count: data.processedCount ?? null,
		partial: data.partial ?? false,
		scan_session_id: data.scanSessionId ?? null,
		from_iso: data.fromISO ?? null,
		to_iso: data.toISO ?? null,
		include_nft: data.includeNFT ?? null,
		use_oslo: data.useOslo ?? null,
		dust_mode: data.dustMode ?? null,
		dust_threshold:
			data.dustThreshold !== undefined && data.dustThreshold !== null
				? Number(data.dustThreshold)
				: null,
		dust_interval: data.dustInterval ?? null,
		updated_at: new Date().toISOString()
	};

	const upsertResult = await supabase
		.from("generated_csvs")
		.upsert(
			{
				...baseUpsertPayload,
				tx_meta: data.txMeta ?? null
			},
			{
				onConflict:
					"user_id,address,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval"
			}
		)
		.select("id")
		.single();
	let error = upsertResult.error;

	if (isMissingTxMetaColumnError(error)) {
		const fallback = await supabase
			.from("generated_csvs")
			.upsert(baseUpsertPayload, {
				onConflict:
					"user_id,address,from_iso,to_iso,include_nft,use_oslo,dust_mode,dust_threshold,dust_interval"
			})
			.select("id")
			.single();
		error = fallback.error;
	}

	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}

	await supabase.from("search_addresses").upsert(
		{
			user_id: userData.user.id,
			address: data.address,
			label: data.label ?? null,
			last_used_at: new Date().toISOString()
		},
		{ onConflict: "user_id,address" }
	);

	return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await req.json().catch(() => null);
	const id = typeof body?.id === "string" ? body.id : null;
	const address = typeof body?.address === "string" ? body.address : null;

	if (!id && !address) {
		return NextResponse.json(
			{ error: "Missing id or address" },
			{ status: 400 }
		);
	}

	if (id) {
		const { error } = await supabase
			.from("generated_csvs")
			.delete()
			.eq("id", id)
			.eq("user_id", userData.user.id);
		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	}

	const { error } = await supabase
		.from("generated_csvs")
		.delete()
		.eq("address", address)
		.eq("user_id", userData.user.id);
	if (error) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
	return NextResponse.json({ ok: true });
}
