"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";

export default function AccountCreatedPage() {
	const { tr } = useLocale();

	return (
		<main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] p-8 shadow-xl shadow-slate-900/10 dark:shadow-black/35 text-center">
				<div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center mb-4">
					<svg
						className="w-8 h-8 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M5 13l4 4L19 7"
						/>
					</svg>
				</div>

				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Konto opprettet", en: "Account created" })}
				</h1>
				<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
					<span className="block">
						{tr({
							no: "Sjekk e-posten din for å bekrefte kontoen.",
							en: "Check your email to confirm your account."
						})}
					</span>
					<span className="block mt-1">
						{tr({
							no: "Husk å sjekke søppelpost.",
							en: "Remember to check your spam folder."
						})}
					</span>
				</p>

			</div>
		</main>
	);
}
