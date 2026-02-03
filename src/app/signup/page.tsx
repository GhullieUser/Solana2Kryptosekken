"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

export default function SignUpPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState("");
	const [areaCode, setAreaCode] = useState("+47");
	const [phoneNumber, setPhoneNumber] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [messageType, setMessageType] = useState<"error" | "success" | null>(
		null
	);

	async function signUp(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setMessage(null);
		setMessageType(null);
		if (password !== confirmPassword) {
			setLoading(false);
			setMessage(
				tr({
					no: "Passordene er ikke like.",
					en: "Passwords do not match."
				})
			);
			setMessageType("error");
			return;
		}
		const fullPhone = [areaCode.trim(), phoneNumber.trim()]
			.filter(Boolean)
			.join(" ");
		const { error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: {
					phone: fullPhone
				}
			}
		});
		if (error) {
			setMessage(error.message);
			setMessageType("error");
		} else
			setMessage(
				tr({
					no: "Sjekk e-posten din for å bekrefte kontoen. Husk å sjekke søppelpost.",
					en: "Check your email to confirm your account. Remember to check your spam folder."
				})
			);
		setMessageType(error ? "error" : "success");
		setLoading(false);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
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
					<div className="grid grid-cols-[140px_1fr] gap-3">
						<input
							type="tel"
							required
							placeholder={tr({ no: "Landskode", en: "Area code" })}
							value={areaCode}
							onChange={(e) => setAreaCode(e.target.value)}
							className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
						/>
						<input
							type="tel"
							required
							placeholder={tr({ no: "Telefonnummer", en: "Phone number" })}
							value={phoneNumber}
							onChange={(e) => setPhoneNumber(e.target.value)}
							className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
						/>
					</div>
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
						className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white py-2 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
					>
						{loading
							? tr({ no: "Oppretter…", en: "Creating…" })
							: tr({ no: "Opprett konto", en: "Create account" })}
					</button>
				</form>

				<div className="mt-4 text-xs text-slate-600 dark:text-slate-300 text-center">
					<Link
						href="/signin"
						className="hover:text-slate-900 dark:hover:text-white"
					>
						{tr({ no: "Tilbake til innlogging", en: "Back to sign in" })}
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
