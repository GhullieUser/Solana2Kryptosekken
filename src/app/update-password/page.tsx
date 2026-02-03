"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

export default function UpdatePasswordPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [messageType, setMessageType] = useState<"error" | "success" | null>(
		null
	);
	const [hasSession, setHasSession] = useState<boolean | null>(null);
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		let active = true;
		(async () => {
			const { data } = await supabase.auth.getSession();
			if (!active) return;
			setHasSession(Boolean(data.session));
		})().catch(() => {
			if (active) setHasSession(false);
		});
		return () => {
			active = false;
		};
	}, [supabase]);

	async function updatePassword(e: React.FormEvent) {
		e.preventDefault();
		setMessage(null);
		setMessageType(null);
		if (password !== confirmPassword) {
			setMessage(
				tr({ no: "Passordene matcher ikke.", en: "Passwords do not match." })
			);
			setMessageType("error");
			return;
		}
		setLoading(true);
		const { error } = await supabase.auth.updateUser({ password });
		if (error) {
			setMessage(error.message);
			setMessageType("error");
		} else {
			setSuccess(true);
		}
		setLoading(false);
	}

	if (success) {
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
						{tr({ no: "Passord oppdatert!", en: "Password updated!" })}
					</h1>
					<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
						{tr({
							no: "Ditt passord har blitt oppdatert. Du kan nå logge inn med det nye passordet.",
							en: "Your password has been updated. You can now sign in with your new password."
						})}
					</p>

					<div className="mt-6">
						<Link
							href="/signin"
							style={{ color: "#ffffff" }}
							className="block w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 py-3 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 transition-all shadow-lg shadow-indigo-500/30"
						>
							{tr({ no: "Gå til innlogging", en: "Go to sign in" })}
						</Link>
					</div>
				</div>
			</main>
		);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] p-6 shadow-xl shadow-slate-900/10 dark:shadow-black/35">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Sett nytt passord", en: "Set new password" })}
				</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
					{tr({
						no: "Skriv inn et nytt passord for kontoen din.",
						en: "Enter a new password for your account."
					})}
				</p>

				{hasSession === false && (
					<p className="mt-4 text-sm text-rose-600">
						{tr({
							no: "Ugyldig eller utløpt lenke. Be om en ny tilbakestilling.",
							en: "Invalid or expired link. Request a new reset email."
						})}
					</p>
				)}

				<form className="mt-4 space-y-3" onSubmit={updatePassword}>
					<input
						type="password"
						required
						placeholder={tr({ no: "Nytt passord", en: "New password" })}
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
						disabled={loading || hasSession === false}
						className="w-full rounded-xl bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-60"
					>
						{loading
							? tr({ no: "Lagrer…", en: "Saving…" })
							: tr({ no: "Oppdater passord", en: "Update password" })}
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
