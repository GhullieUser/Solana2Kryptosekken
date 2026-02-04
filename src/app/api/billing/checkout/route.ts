import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRICE_MAP = {
	"500": {
		credits: 500,
		priceId: process.env.STRIPE_PRICE_500
	},
	"1000": {
		credits: 1000,
		priceId: process.env.STRIPE_PRICE_1000
	},
	"10000": {
		credits: 10000,
		priceId: process.env.STRIPE_PRICE_10000
	},
	"test": {
		credits: 750,
		priceId: process.env.STRIPE_PRICE_TEST
	}
} as const;

type TierKey = keyof typeof PRICE_MAP;

export async function POST(req: Request) {
	const supabase = await createSupabaseRouteClient();
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError || !userData?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await req.json().catch(() => null);
	const tier = String(body?.tier ?? "").trim() as TierKey;
	if (!PRICE_MAP[tier]) {
		return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
	}

	const stripeKey = process.env.STRIPE_SECRET_KEY;
	if (!stripeKey) {
		return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
	}

	const { credits, priceId } = PRICE_MAP[tier];
	if (!priceId) {
		return NextResponse.json({ error: "Missing Stripe price" }, { status: 500 });
	}

	const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
	const origin = req.headers.get("origin") ?? "http://localhost:3000";

	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		payment_method_types: ["card", "klarna"],
		line_items: [{ price: priceId, quantity: 1 }],
		client_reference_id: userData.user.id,
		metadata: {
			user_id: userData.user.id,
			credits: String(credits)
		},
		success_url: `${origin}/user?checkout=success`,
		cancel_url: `${origin}/user?checkout=cancel`
	});

	return NextResponse.json({ url: session.url });
}