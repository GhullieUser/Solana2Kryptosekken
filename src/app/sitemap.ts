import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date();
	return [
		{
			url: "https://sol2ks.no/",
			lastModified
		},
		{
			url: "https://sol2ks.no/pricing",
			lastModified
		}
	];
}
