import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: ["/", "/pricing"],
			disallow: [
				"/api",
				"/account",
				"/account-created",
				"/auth",
				"/csvgenerator",
				"/email-confirmed",
				"/reset-password",
				"/reset-new-password",
				"/signin",
				"/signup",
				"/site-password",
				"/update-password",
				"/user"
			]
		},
		sitemap: "https://sol2ks.no/sitemap.xml"
	};
}
