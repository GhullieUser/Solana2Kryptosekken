import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = {
	name: string;
	value: string;
	options?: Partial<ResponseCookie>;
};

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	const isStaticAsset =
		/\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?|ttf|otf)$/i.test(pathname) ||
		pathname.startsWith("/logos/");
	if (isStaticAsset) {
		return NextResponse.next();
	}

	// Password protection - skip for password page, API routes, and static files
	if (pathname !== "/site-password" && !pathname.startsWith("/api/")) {
		const accessToken = request.cookies.get("site-access")?.value;
		const sitePassword = process.env.SITE_PASSWORD;

		console.log("Password check:", { pathname, sitePassword: !!sitePassword, accessToken: !!accessToken });

		if (sitePassword && accessToken !== sitePassword) {
			console.log("Redirecting to password page");
			return NextResponse.redirect(new URL("/site-password", request.url));
		}
	}

	const response = NextResponse.next();

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !key) {
		return response;
	}

	const supabase = createServerClient(url, key, {
		cookies: {
			getAll() {
				return request.cookies.getAll();
			},
			setAll(cookiesToSet: CookieToSet[]) {
				cookiesToSet.forEach(({ name, value, options }) => {
					response.cookies.set(name, value, options);
				});
			}
		}
	});

	await supabase.auth.getUser();

	return response;
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
