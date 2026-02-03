"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

export default function ResetPasswordPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function requestReset(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setMessage(null);
		const redirectTo = `${window.location.origin}/update-password`;
		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo
		});
		if (error) {
			setMessage(error.message);
		} else {
			setMessage(
				tr({
					no: "Sjekk e-posten din for lenken til å sette nytt passord.",
					en: "Check your email for the password reset link."
				})
			);
		}
		setLoading(false);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] p-6 shadow-xl shadow-slate-900/10 dark:shadow-black/35">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Nullstill passord", en: "Reset password" })}
				</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
					{tr({
						no: "Skriv inn e-posten din for å få en lenke til å sette nytt passord.",
						en: "Enter your email to receive a reset link."
					})}
				</p>

				<form className="mt-4 space-y-3" onSubmit={requestReset}>
					<input
						type="email"
						required
						placeholder={tr({ no: "E-post", en: "Email" })}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
					/>
					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-xl bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-60"
					>
						{loading
							? tr({ no: "Sender…", en: "Sending…" })
							: tr({ no: "Send lenke", en: "Send link" })}
					</button>
				</form>

				{message && (
					<p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
						{message}
					</p>
				)}

				<div className="mt-4 text-xs text-slate-600 dark:text-slate-300">
					<Link
						href="/signin"
						className="hover:text-slate-900 dark:hover:text-white"
					>
						{tr({ no: "Tilbake til innlogging", en: "Back to sign in" })}
					</Link>
				</div>
			</div>
		</main>
	);
}
