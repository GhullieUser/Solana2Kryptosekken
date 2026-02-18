"use client";

import { Suspense, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

function ResetPasswordInner() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const searchParams = useSearchParams();
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [messageType, setMessageType] = useState<"error" | "success" | null>(
		null
	);
	const [cooldown, setCooldown] = useState(0);

	useEffect(() => {
		const emailParam = searchParams.get("email");
		if (emailParam) {
			setEmail(emailParam);
		}
	}, [searchParams]);

	useEffect(() => {
		if (cooldown > 0) {
			const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
			return () => clearTimeout(timer);
		}
	}, [cooldown]);

	async function requestReset(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setMessage(null);
		setMessageType(null);

		// Check if email exists in the system (best-effort, no user-visible signal)
		const { error: lookupError } = await supabase.rpc("check_user_exists", {
			user_email: email
		});
		if (lookupError) {
			// ignore lookup errors to avoid user enumeration
		}

		// Even if user doesn't exist, we don't reveal that for security reasons
		// But we still send the reset email which Supabase handles gracefully
		const redirectTo = `${window.location.origin}/reset-new-password?recovery=1`;
		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo
		});
		if (error) {
			setMessage(error.message);
			setMessageType("error");
		} else {
			// Always show success message for security (don't reveal if user exists)
			setMessage(
				tr({
					no: "Hvis denne e-posten er registrert, vil du motta en lenke til å sette nytt passord. Husk å sjekke søppelpost.",
					en: "If this email is registered, you will receive a password reset link. Remember to check your spam folder."
				})
			);
			setMessageType("success");
			setCooldown(60);
		}
		setLoading(false);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="w-full max-w-md rounded-2xl border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 p-6 shadow-md shadow-slate-300/80 dark:shadow-black/50">
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
						className="block w-full rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-md shadow-slate-300/80 dark:shadow-black/50"
					/>
					<button
						type="submit"
						disabled={loading || cooldown > 0}
						className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white py-2 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
					>
						{loading
							? tr({ no: "Sender…", en: "Sending…" })
							: cooldown > 0
								? tr({
										no: `Vent ${cooldown}s`,
										en: `Wait ${cooldown}s`
									})
								: tr({ no: "Send lenke", en: "Send link" })}
					</button>
				</form>

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

				<div className="mt-4 text-xs text-slate-600 dark:text-slate-300 text-center">
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

export default function ResetPasswordPage() {
	return (
		<Suspense>
			<ResetPasswordInner />
		</Suspense>
	);
}
