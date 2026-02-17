"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";

export default function NotFound() {
	const { tr } = useLocale();

	return (
		<div className="flex-1 flex items-center justify-center px-6 py-16">
			<div className="text-center max-w-xl">
				<p className="text-sm uppercase tracking-[0.3em] text-slate-400">
					404
				</p>
				<h1 className="mt-3 text-3xl sm:text-4xl font-semibold text-slate-900 dark:text-white">
					{tr({ no: "Fant ikke siden", en: "Page not found" })}
				</h1>
				<p className="mt-4 text-base text-slate-600 dark:text-slate-300">
					{tr({
						no: "Siden du leter etter finnes ikke eller er flyttet.",
						en: "The page you are looking for does not exist or has been moved."
					})}
				</p>
				<div className="mt-8 flex items-center justify-center">
					<Link
						href="/"
						className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-600 !text-slate-50 dark:!text-slate-50 px-6 py-3 text-base font-semibold shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:via-blue-500 hover:to-emerald-500 transition"
					>
						{tr({ no: "Tilbake til forsiden", en: "Return to home" })}
					</Link>
				</div>
			</div>
		</div>
	);
}
