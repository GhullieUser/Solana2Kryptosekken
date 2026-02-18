"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

export default function UpdatePasswordPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState<string | null>(null);
	const [currentPassword, setCurrentPassword] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showCurrentPassword, setShowCurrentPassword] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [messageType, setMessageType] = useState<"error" | "success" | null>(
		null
	);
	const [hasSession, setHasSession] = useState<boolean | null>(null);
	const [success, setSuccess] = useState(false);
	const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);

	useEffect(() => {
		let active = true;
		const hash = typeof window !== "undefined" ? window.location.hash : "";
		const search = typeof window !== "undefined" ? window.location.search : "";
		const isRecoveryQuery = /(^|[?&#])recovery=(1|true)(&|$)/.test(search);
		setIsRecoveryFlow(
			hash.includes("type=recovery") ||
				search.includes("type=recovery") ||
				hash.includes("access_token") ||
				search.includes("access_token") ||
				isRecoveryQuery
		);
		(async () => {
			const [{ data: sessionData }, { data: userData }] = await Promise.all([
				supabase.auth.getSession(),
				supabase.auth.getUser()
			]);
			if (!active) return;
			setHasSession(Boolean(sessionData.session));
			setEmail(userData.user?.email ?? null);
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
		if (!email) {
			setMessage(
				tr({
					no: "Fant ikke e-post for brukeren.",
					en: "User email not found."
				})
			);
			setMessageType("error");
			return;
		}
		if (!isRecoveryFlow && currentPassword.trim().length === 0) {
			setMessage(
				tr({
					no: "Skriv inn ditt gamle passord.",
					en: "Enter your current password."
				})
			);
			setMessageType("error");
			return;
		}
		if (password !== confirmPassword) {
			setMessage(
				tr({ no: "Passordene matcher ikke.", en: "Passwords do not match." })
			);
			setMessageType("error");
			return;
		}
		setLoading(true);
		if (!isRecoveryFlow) {
			const { error: signInError } = await supabase.auth.signInWithPassword({
				email,
				password: currentPassword
			});
			if (signInError) {
				setMessage(
					tr({
						no: "Gammelt passord er feil.",
						en: "Current password is incorrect."
					})
				);
				setMessageType("error");
				setLoading(false);
				return;
			}
		}
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
				<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-8 shadow-xl shadow-slate-900/10 dark:shadow-black/50 text-center">
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
							no: "Ditt passord har blitt oppdatert. Bruk det nye passordet neste gang du logger inn.",
							en: "Your password has been updated. Use the new password next time you log in."
						})}
					</p>

					<div className="mt-6">
						<Link
							href="/user"
							style={{ color: "#ffffff" }}
							className="block w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white py-2 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500"
						>
							{tr({ no: "Gå til profil", en: "Go to profile" })}
						</Link>
					</div>
				</div>
			</main>
		);
	}

	return (
		<main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-6 shadow-xl shadow-slate-900/10 dark:shadow-black/50">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
					{tr({ no: "Oppdater passord", en: "Update password" })}
				</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
					{isRecoveryFlow
						? tr({
								no: "Velg et nytt passord.",
								en: "Choose a new password."
							})
						: tr({
								no: "Skriv inn ditt gamle passord og velg et nytt.",
								en: "Enter your current password and choose a new one."
							})}
				</p>

				{hasSession === false && !isRecoveryFlow && (
					<p className="mt-4 text-sm text-rose-600">
						{tr({
							no: "Ugyldig eller utløpt lenke. Be om en ny tilbakestilling.",
							en: "Invalid or expired link. Request a new reset email."
						})}
					</p>
				)}

				<form className="mt-4 space-y-3" onSubmit={updatePassword}>
					{!isRecoveryFlow && (
						<div className="relative">
							<input
								type={showCurrentPassword ? "text" : "password"}
								required
								placeholder={tr({
									no: "Gammelt passord",
									en: "Current password"
								})}
								value={currentPassword}
								onChange={(e) => setCurrentPassword(e.target.value)}
								autoComplete="current-password"
								className="block w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 pr-10 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
							/>
							<button
								type="button"
								onClick={() => setShowCurrentPassword((v) => !v)}
								className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
								aria-label={tr({
									no: showCurrentPassword ? "Skjul passord" : "Vis passord",
									en: showCurrentPassword ? "Hide password" : "Show password"
								})}
							>
								{showCurrentPassword ? (
									<FiEyeOff className="h-4 w-4" />
								) : (
									<FiEye className="h-4 w-4" />
								)}
							</button>
						</div>
					)}
					<div className="relative">
						<input
							type={showPassword ? "text" : "password"}
							required
							placeholder={tr({ no: "Nytt passord", en: "New password" })}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="block w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 pr-10 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
						/>
						<button
							type="button"
							onClick={() => setShowPassword((v) => !v)}
							className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
							aria-label={tr({
								no: showPassword ? "Skjul passord" : "Vis passord",
								en: showPassword ? "Hide password" : "Show password"
							})}
						>
							{showPassword ? (
								<FiEyeOff className="h-4 w-4" />
							) : (
								<FiEye className="h-4 w-4" />
							)}
						</button>
					</div>
					<div className="relative">
						<input
							type={showConfirmPassword ? "text" : "password"}
							required
							placeholder={tr({
								no: "Bekreft passord",
								en: "Confirm password"
							})}
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							className="block w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 pr-10 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm"
						/>
						<button
							type="button"
							onClick={() => setShowConfirmPassword((v) => !v)}
							className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
							aria-label={tr({
								no: showConfirmPassword ? "Skjul passord" : "Vis passord",
								en: showConfirmPassword ? "Hide password" : "Show password"
							})}
						>
							{showConfirmPassword ? (
								<FiEyeOff className="h-4 w-4" />
							) : (
								<FiEye className="h-4 w-4" />
							)}
						</button>
					</div>
					<button
						type="submit"
						disabled={loading || (hasSession === false && !isRecoveryFlow)}
						className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white py-2 text-sm font-medium hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
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

				<div className="mt-4 text-xs text-slate-600 dark:text-slate-300 text-center">
					<Link
						href="/user"
						className="hover:text-slate-900 dark:hover:text-white"
					>
						{tr({ no: "Tilbake til brukerprofil", en: "Back to profile" })}
					</Link>
				</div>
			</div>
		</main>
	);
}
