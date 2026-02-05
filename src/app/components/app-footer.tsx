"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";

export default function AppFooter() {
	const { tr } = useLocale();

	return (
		<footer className="s2ks-footer mt-auto py-3 sm:py-4 text-xs sm:text-sm text-slate-800 dark:text-slate-200 bg-white/90 dark:bg-slate-900">
			<div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 sm:flex-row">
				<p>
					{tr({
						no: "© 2026 Sol2KS. Alle rettigheter forbeholdt.",
						en: "© 2026 Sol2KS. All rights reserved."
					})}
				</p>
				<div className="flex items-center gap-4">
					<Link
						href="/personvern"
						className="hover:text-slate-900 dark:hover:text-white transition"
					>
						{tr({ no: "Personvern", en: "Privacy" })}
					</Link>
					<Link
						href="/vilkar"
						className="hover:text-slate-900 dark:hover:text-white transition"
					>
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
		</footer>
	);
}
