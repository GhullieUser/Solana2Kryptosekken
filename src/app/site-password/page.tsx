"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useLocale } from "@/app/components/locale-provider";

export default function SitePasswordPage() {
	const { tr } = useLocale();
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const router = useRouter();

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const res = await fetch("/api/site-access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password })
			});

			if (res.ok) {
				router.push("/");
				router.refresh();
			} else {
				setError(tr({ no: "Feil passord", en: "Incorrect password" }));
			}
		} catch {
			setError(tr({ no: "Noe gikk galt", en: "Something went wrong" }));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0b1220] px-4">
			<div className="w-full max-w-md">
				<div className="text-center mb-8">
					<div className="flex flex-col items-center gap-3 mb-4">
						<Image
							src="/Sol2KS_logo.svg"
							alt="Solana2Kryptosekken"
							width={64}
							height={64}
							className="block"
						/>
						<h1 className="text-3xl font-semibold">
							<span className="bg-gradient-to-r from-indigo-600 to-emerald-600 bg-clip-text text-transparent">
								Solana2Kryptosekken
							</span>
						</h1>
					</div>
					<p className="text-slate-600 dark:text-slate-400">
						{tr({
							no: "Siden er ikke offentlig ennå",
							en: "Site is not public yet"
						})}
					</p>
				</div>

				<div className="bg-white dark:bg-[#0e1729] rounded-2xl border border-slate-200 dark:border-white/10 shadow-xl p-8">
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="password"
								className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2"
							>
								{tr({ no: "Passord", en: "Password" })}
							</label>
							<input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoFocus
								className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-slate-800 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
								placeholder={tr({
									no: "Skriv inn passord",
									en: "Enter password"
								})}
							/>
						</div>

						{error && (
							<p className="text-sm text-rose-600 dark:text-rose-400">
								{error}
							</p>
						)}

						<button
							type="submit"
							disabled={loading}
							className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 text-white px-6 py-3 font-semibold shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:to-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{loading
								? tr({ no: "Sjekker...", en: "Checking..." })
								: tr({ no: "Åpne", en: "Open" })}
						</button>
					</form>
				</div>
			</div>
		</div>
	);
}
