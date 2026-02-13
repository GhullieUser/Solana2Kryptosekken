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
	const [messageType, setMessageType] = useState<"error" | "success" | null>(
		null
	);

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
		setMessageType(null);
		const { error } = await supabase.auth.signInWithPassword({
			email,
			password
		});
		if (error) {
			setMessage(error.message);
			setMessageType("error");
			setLoading(false);
		}
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] p-6 shadow-xl shadow-slate-900/10 dark:shadow-black/35">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Logg inn", en: "Sign in" })}
				</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
					{tr({
						no: "Logg inn for å bruke Sol2KS verktøyet",
						en: "Sign in to use the Sol2KS tool."
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
					<div className="flex justify-end">
						<Link
							href={`/reset-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
							className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
						>
							{tr({ no: "Glemt passord?", en: "Forgot password?" })}
						</Link>
					</div>
					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white py-2 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
					>
						{loading
							? tr({ no: "Logger inn…", en: "Signing in…" })
							: tr({ no: "Logg inn", en: "Sign in" })}
					</button>
				</form>

				<div className="mt-4 text-xs text-slate-600 dark:text-slate-300 text-center">
					<Link
						href="/signup"
						className="hover:text-slate-900 dark:hover:text-white"
					>
						{tr({ no: "Opprett konto", en: "Create account" })}
					</Link>
				</div>

				{message && (
					<div className="mt-4 border-t border-slate-200 dark:border-white/10 pt-3 text-center">
						<div
							className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
								messageType === "success"
									? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
									: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
							}`}
						>
							{message}
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
