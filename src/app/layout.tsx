import type { Metadata } from "next";

import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
	title: "Sol2Kryptosekken",
	description: "Solana-transaksjoner gjort enklere",
	icons: {
		icon: [
			{ url: "/Sol2KS_logo_512.png", type: "image/png", sizes: "512x512" },
			// optional fallbacks:
			{ url: "/favicon.ico", sizes: "any" }
		],
		apple: [{ url: "/Sol2KS_logo_512.png", sizes: "180x180" }],
		shortcut: ["/Sol2KS_logo_512.png"]
	}
};

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="no" className={inter.variable}>
			<body className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-emerald-50 font-sans antialiased">
				{children}
			</body>
		</html>
	);
}
