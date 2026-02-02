import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function createSupabaseRouteClient() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !key) {
		throw new Error("Missing Supabase environment variables");
	}

	const cookieStore = cookies();

	return createServerClient(url, key, {
		cookies: {
			getAll() {
				return cookieStore.getAll();
			},
			setAll(cookiesToSet) {
				cookiesToSet.forEach(({ name, value, options }) => {
					cookieStore.set(name, value, options);
				});
			}
		}
	});
}
