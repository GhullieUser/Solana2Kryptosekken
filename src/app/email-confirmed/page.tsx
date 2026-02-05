"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { BsXDiamondFill } from "react-icons/bs";

export default function EmailConfirmedPage() {
	const { tr } = useLocale();
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	useEffect(() => {
		const supabase = createSupabaseBrowserClient();
		supabase.auth.getSession().then(({ data: { session } }) => {
			setIsAuthenticated(!!session);
		});
	}, []);

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
					{tr({ no: "E-post bekreftet!", en: "Email confirmed!" })}
				</h1>
				<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
					{tr({
						no: "Din konto er nå aktivert og klar til bruk.",
						en: "Your account is now activated and ready to use."
					})}
				</p>
				<div className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 px-3 py-1 text-xs font-medium">
					<BsXDiamondFill className="h-3.5 w-3.5 text-amber-500" />
					<span>
						{tr({
							no: "Du har fått 50 gratis TX Credits for testing.",
							en: "You’ve been granted 50 free TX Credits for testing."
						})}
					</span>
				</div>

				<div className="mt-6 space-y-3">
					{isAuthenticated ? (
						<Link
							href="/csvgenerator"
							className="block w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white !text-white py-3 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 transition-all shadow-lg shadow-indigo-500/30"
						>
							{tr({ no: "Gå til appen", en: "Go to app" })}
						</Link>
					) : (
						<Link
							href="/signin"
							className="block w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white !text-white py-3 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 transition-all shadow-lg shadow-indigo-500/30"
						>
							{tr({ no: "Logg inn", en: "Sign in" })}
						</Link>
					)}
				</div>
			</div>
		</main>
	);
}
