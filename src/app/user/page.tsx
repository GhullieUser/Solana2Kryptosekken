"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale } from "@/app/components/locale-provider";

type AddressRow = {
	address: string;
	label: string | null;
	last_used_at: string | null;
	created_at: string | null;
};

export default function UserPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState<string | null>(null);
	const [addresses, setAddresses] = useState<AddressRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		(async () => {
			const { data: userData } = await supabase.auth.getUser();
			if (!userData?.user) {
				window.location.href = "/signin";
				return;
			}
			if (active) setEmail(userData.user.email ?? null);
			const res = await fetch("/api/addresses");
			if (res.ok) {
				const j = await res.json();
				if (active) setAddresses(j.data || []);
			}
			if (active) setLoading(false);
		})();

		return () => {
			active = false;
		};
	}, [supabase]);

	async function signOut() {
		await supabase.auth.signOut();
		window.location.href = "/";
	}

	async function exportData() {
		setMessage(null);
		const res = await fetch("/api/account/export");
		if (!res.ok) {
			setMessage(tr({ no: "Kunne ikke eksportere data.", en: "Failed to export data." }));
			return;
		}
		const data = await res.json();
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: "application/json"
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "sol2ks_export.json";
		a.click();
		URL.revokeObjectURL(url);
	}

	async function deleteData() {
		setMessage(null);
		const ok = window.confirm(
			tr({
				no: "Slett alle lagrede adresser? Dette kan ikke angres.",
				en: "Delete all saved addresses? This cannot be undone."
			})
		);
		if (!ok) return;
		const res = await fetch("/api/account/delete", { method: "DELETE" });
		if (res.ok) {
			setAddresses([]);
			setMessage(
				tr({
					no: "Alle lagrede adresser slettet.",
					en: "All saved addresses deleted."
				})
			);
		} else {
			setMessage(tr({ no: "Kunne ikke slette data.", en: "Failed to delete data." }));
		}
	}

	return (
		<main className="min-h-screen">
			<div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
				<div className="rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 ring-1 ring-slate-300/80 dark:ring-white/10 p-6 sm:p-10">
					<div className="flex items-center justify-between gap-4">
						<div>
							<h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
								{tr({ no: "Bruker", en: "User" })}
							</h1>
							<p className="text-sm text-slate-600 dark:text-slate-300">
								{email ?? ""}
							</p>
						</div>
						<button
							onClick={signOut}
							className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
						>
							{tr({ no: "Logg ut", en: "Sign out" })}
						</button>
					</div>

					<div className="mt-6">
						<h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
							{tr({ no: "Lagrede adresser", en: "Saved addresses" })}
						</h2>
						{loading ? (
							<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
								{tr({ no: "Laster…", en: "Loading…" })}
							</p>
						) : addresses.length === 0 ? (
							<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
								{tr({
									no: "Ingen lagrede adresser ennå.",
									en: "No saved addresses yet."
								})}
							</p>
						) : (
							<ul className="mt-3 space-y-2">
								{addresses.map((row) => (
									<li
										key={row.address}
										className="rounded-xl border border-slate-200 dark:border-white/10 p-3 text-sm"
									>
										<div className="font-medium text-slate-800 dark:text-slate-100">
											{row.label || row.address}
										</div>
										<div className="text-slate-500 dark:text-slate-400">
											{row.address}
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					<div className="mt-8 flex flex-wrap gap-3">
						<button
							onClick={exportData}
							className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500"
						>
							{tr({ no: "Eksporter data", en: "Export my data" })}
						</button>
						<button
							onClick={deleteData}
							className="rounded-xl border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 px-4 py-2 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-500/10"
						>
							{tr({ no: "Slett mine data", en: "Delete my data" })}
						</button>
						<Link
							href="/"
							className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
						>
							{tr({ no: "Tilbake til app", en: "Back to app" })}
						</Link>
					</div>

					{message && (
						<p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
							{message}
						</p>
					)}
				</div>
			</div>
		</main>
	);
}
