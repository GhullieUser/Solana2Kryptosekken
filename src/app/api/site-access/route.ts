import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
	try {
		const { password } = await request.json();
		const sitePassword = process.env.SITE_PASSWORD;

		if (!sitePassword) {
			return NextResponse.json({ error: "No password configured" }, { status: 500 });
		}

		if (password === sitePassword) {
			const cookieStore = await cookies();
			cookieStore.set("site-access", password, {
				httpOnly: true,
				secure: process.env.NODE_ENV === "production",
				sameSite: "lax",
				maxAge: 60 * 60 * 24 * 7 // 7 days
			});

			return NextResponse.json({ success: true });
		}

		return NextResponse.json({ error: "Invalid password" }, { status: 401 });
	} catch {
		return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
	}
}
