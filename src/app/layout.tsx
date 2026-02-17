import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppProviders from "@/app/components/app-providers";
import AppHeader from "@/app/components/app-header";
import AppFooter from "@/app/components/app-footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
	metadataBase: new URL("https://sol2ks.no"),
	title: {
		default: "Sol2Kryptosekken",
		template: "%s | Sol2Kryptosekken"
	},
	description: "Solana-transaksjoner gjort enklere",
	alternates: {
		canonical: "/"
	},
	openGraph: {
		title: "Sol2Kryptosekken",
		description: "Solana-transaksjoner gjort enklere",
		type: "website",
		siteName: "Sol2Kryptosekken",
		url: "/",
		locale: "nb_NO",
		images: [
			{
				url: "/thumbnail.jpg",
				width: 1200,
				height: 630,
				alt: "Sol2Kryptosekken"
			}
		]
	},
	twitter: {
		card: "summary_large_image",
		title: "Sol2Kryptosekken",
		description: "Solana-transaksjoner gjort enklere",
		images: ["/thumbnail.jpg"]
	},
	robots: {
		index: false,
		follow: false
	},
	icons: {
		icon: [
			{ url: "/Sol2KS_logo_512.png", type: "image/png", sizes: "512x512" },
			{ url: "/favicon.ico", sizes: "any" }
		],
		apple: [{ url: "/Sol2KS_logo_512.png", sizes: "180x180" }],
		shortcut: ["/Sol2KS_logo_512.png"]
	}
};

export default function RootLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="no" className={inter.variable} suppressHydrationWarning>
			<head>
				{/* Set initial theme class ASAP */}
				<script
					dangerouslySetInnerHTML={{
						__html: `
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = saved ? saved === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
          `
					}}
				/>
			</head>
			{/* No gradient utilities here; globals.css controls background/gradients */}
			<body className="min-h-dvh font-sans antialiased">
				<AppProviders>
					<AppHeader />
					{children}
					<AppFooter />
				</AppProviders>
			</body>
		</html>
	);
}
