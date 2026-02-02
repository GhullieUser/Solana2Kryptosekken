import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppProviders from "@/app/components/app-providers";
import AppHeader from "@/app/components/app-header";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
	title: "Sol2Kryptosekken",
	description: "Solana-transaksjoner gjort enklere",
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
				</AppProviders>
			</body>
		</html>
	);
}
