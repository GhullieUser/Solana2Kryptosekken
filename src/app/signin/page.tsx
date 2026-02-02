"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export default function SignInPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange(
			(_event: AuthChangeEvent, session: Session | null) => {
				if (session) {
					window.location.href = "/csvgenerator";
				}
			}
		);
		return () => subscription.unsubscribe();
	}, [supabase]);

	async function signIn(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setMessage(null);
		const { error } = await supabase.auth.signInWithPassword({
			email,
			password
		});
		if (error) setMessage(error.message);
		setLoading(false);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] p-6 shadow-xl shadow-slate-900/10 dark:shadow-black/35">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Logg inn", en: "Sign in" })}
				</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
					{tr({
						no: "Logg inn for å bruke CSV Generator verktøyet",
						en: "Sign in to use the CSV Generator tool."
					})}
				</p>

				<form className="mt-4 space-y-3" onSubmit={signIn}>
					<input
						type="email"
						required
						placeholder={tr({ no: "E-post", en: "Email" })}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
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
					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-xl bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-60"
					>
						{loading
							? tr({ no: "Logger inn…", en: "Signing in…" })
							: tr({ no: "Logg inn", en: "Sign in" })}
					</button>
				</form>

				<div className="mt-3 text-center">
					<Link
						href="/signup"
						className="text-sm text-indigo-600 hover:text-indigo-500"
					>
						{tr({ no: "Opprett konto", en: "Create account" })}
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
