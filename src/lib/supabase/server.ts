import { cookies } from "next/headers";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = {
	name: string;
	value: string;
	options?: Partial<ResponseCookie>;
};

export async function createSupabaseRouteClient() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !key) {
		throw new Error("Missing Supabase environment variables");
	}

	const cookieStore = await cookies();

	return createServerClient(url, key, {
		cookies: {
			getAll() {
				return cookieStore.getAll();
			},
			setAll(cookiesToSet: CookieToSet[]) {
				cookiesToSet.forEach(({ name, value, options }) => {
					cookieStore.set(name, value, options);
				});
			}
		}
	});
}
