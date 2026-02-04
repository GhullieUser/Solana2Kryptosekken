import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
	const stripeKey = process.env.STRIPE_SECRET_KEY;
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!stripeKey || !webhookSecret) {
		return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
	}

	const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
	const signature = req.headers.get("stripe-signature") ?? "";
	const payload = await req.text();

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
	} catch (err: any) {
		return NextResponse.json({ error: err?.message ?? "Invalid signature" }, { status: 400 });
	}

	const admin = createSupabaseAdminClient();
	const { data: seen } = await admin
		.from("billing_webhook_events")
		.select("id")
		.eq("id", event.id)
		.maybeSingle();
	if (seen) {
		return NextResponse.json({ received: true });
	}

	await admin.from("billing_webhook_events").insert({
		id: event.id,
		event_type: event.type
	});

	if (event.type === "checkout.session.completed") {
		const session = event.data.object as Stripe.Checkout.Session;
		const userId = session.metadata?.user_id;
		const creditsRaw = session.metadata?.credits;
		const credits = creditsRaw ? Number(creditsRaw) : 0;
		if (userId && Number.isFinite(credits) && credits > 0) {
			const { data: current } = await admin
				.from("billing_user_credits")
				.select("credits_remaining")
				.eq("user_id", userId)
				.maybeSingle();
			const now = new Date().toISOString();
			if (current) {
				await admin
					.from("billing_user_credits")
					.update({
						credits_remaining: (current.credits_remaining ?? 0) + credits,
						updated_at: now
					})
					.eq("user_id", userId);
			} else {
				await admin.from("billing_user_credits").insert({
					user_id: userId,
					credits_remaining: credits,
					updated_at: now
				});
			}
		}
	}

	return NextResponse.json({ received: true });
}