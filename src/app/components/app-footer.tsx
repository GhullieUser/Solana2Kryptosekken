"use client";

import Link from "next/link";
import Image from "next/image";
import { useLocale } from "@/app/components/locale-provider";

export default function AppFooter() {
	const { tr } = useLocale();

	return (
		<footer className="s2ks-footer mt-auto border-t border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
			<div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
				{/* Main grid: brand on left, links on right */}
				<div className="grid gap-8 sm:gap-10 sm:grid-cols-[1fr_auto_auto]">
					{/* Brand section */}
					<div className="text-center sm:text-left">
						<div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 mb-3">
							<Image
								src="/Sol2KS_logo.svg"
								alt="Sol2KS"
								width={40}
								height={40}
								className="grayscale opacity-70 dark:opacity-60"
							/>
							<p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white">
								Sol2KS
							</p>
						</div>
						<p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto sm:mx-0">
							{tr({
								no: "Solana-transaksjoner til ryddig CSV, klar for Kryptosekken.",
								en: "Solana transactions into a clean CSV, ready for Kryptosekken."
							})}
						</p>
						<p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto sm:mx-0">
							{tr({
								no: "Bygget for presisjon, personvern og mindre manuelt arbeid.",
								en: "Built for accuracy, privacy, and less manual work."
							})}
						</p>
					</div>

					{/* Product links */}
					<div className="space-y-3 text-center sm:text-left">
						<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
							{tr({ no: "Produkt", en: "Product" })}
						</p>
						<div className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
							<Link href="/pricing" className="hover:text-slate-900 dark:hover:text-white transition">
								{tr({ no: "Priser", en: "Pricing" })}
							</Link>
							<Link href="/csvgenerator" className="hover:text-slate-900 dark:hover:text-white transition">
								{tr({ no: "CSV-generator", en: "CSV generator" })}
							</Link>
							<Link href="/user" className="hover:text-slate-900 dark:hover:text-white transition">
								{tr({ no: "Min side", en: "My account" })}
							</Link>
						</div>
					</div>

					{/* Resources links */}
					<div className="space-y-3 text-center sm:text-left sm:ml-32">
						<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
							{tr({ no: "Ressurser", en: "Resources" })}
						</p>
						<div className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
							<Link href="/personvern" className="hover:text-slate-900 dark:hover:text-white transition">
								{tr({ no: "Personvern", en: "Privacy" })}
							</Link>
							<Link href="/vilkar" className="hover:text-slate-900 dark:hover:text-white transition">
								{tr({ no: "Vilkår", en: "Terms" })}
							</Link>
							<a
								href="mailto:hello@sol2ks.no"
								className="hover:text-slate-900 dark:hover:text-white transition"
							>
								{tr({ no: "Kontakt", en: "Contact" })}
							</a>
						</div>
					</div>
				</div>

				{/* Bottom bar - centered on mobile */}
				<div className="mt-8 flex flex-col gap-2 border-t border-slate-200/70 dark:border-white/10 pt-5 text-xs text-center text-slate-500 dark:text-slate-400 sm:text-sm sm:flex-row sm:items-center sm:justify-between sm:text-left">
					<p>
						{tr({
							no: "© 2026 Sol2KS. Alle rettigheter forbeholdt.",
							en: "© 2026 Sol2KS. All rights reserved."
						})}
					</p>
					<p>
						{tr({
							no: "Laget i Norge for Kryptosekken-brukere.",
							en: "Made in Norway for Kryptosekken users."
						})}
					</p>
				</div>
			</div>
		</footer>
	);
}
