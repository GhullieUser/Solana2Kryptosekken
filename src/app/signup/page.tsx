"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

export default function SignUpPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function signUp(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setMessage(null);
		if (password !== confirmPassword) {
			setLoading(false);
			setMessage(
				tr({
					no: "Passordene er ikke like.",
					en: "Passwords do not match."
				})
			);
			return;
		}
		const { error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: {
					phone
				}
			}
		});
		if (error) setMessage(error.message);
		else
			setMessage(
				tr({
					no: "Sjekk e-posten din for å bekrefte kontoen.",
					en: "Check your email to confirm your account."
				})
			);
		setLoading(false);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] p-6 shadow-xl shadow-slate-900/10 dark:shadow-black/35">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Opprett konto", en: "Create account" })}
				</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
					{tr({
						no: "Opprett konto for å lagre adressehistorikk.",
						en: "Create an account to save address history."
					})}
				</p>

				<form className="mt-4 space-y-3" onSubmit={signUp}>
					<input
						type="email"
						required
						placeholder={tr({ no: "E-post", en: "Email" })}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
					/>
					<input
						type="tel"
						required
						placeholder={tr({ no: "Telefonnummer", en: "Phone number" })}
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
					/>
					<input
						type="password"
						required
						placeholder={tr({ no: "Passord", en: "Password" })}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
					/>
					<input
						type="password"
						required
						placeholder={tr({ no: "Bekreft passord", en: "Confirm password" })}
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
						className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
					/>
					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-xl bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-60"
					>
						{loading
							? tr({ no: "Oppretter…", en: "Creating…" })
							: tr({ no: "Opprett konto", en: "Create account" })}
					</button>
				</form>

				<div className="mt-3 text-center">
					<Link
						href="/signin"
						className="text-sm text-indigo-600 hover:text-indigo-500"
					>
						{tr({ no: "Tilbake til innlogging", en: "Back to sign in" })}
					</Link>
				</div>

				{message && (
					<p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
						{message}
					</p>
				)}
			</div>
		</main>
	);
}
