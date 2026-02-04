"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
	FiActivity,
	FiFileText,
	FiEye,
	FiDownload,
	FiUser
} from "react-icons/fi";
import { MdOutlineCleaningServices } from "react-icons/md";
import StyledSelect from "@/app/components/styled-select";
import { useLocale } from "@/app/components/locale-provider";

type AddressRow = {
	address: string;
	label: string | null;
	last_used_at: string | null;
	created_at: string | null;
};

type CsvRow = {
	id: string;
	address: string;
	label: string | null;
	created_at: string | null;
	updated_at: string | null;
	raw_count: number | null;
	processed_count: number | null;
	from_iso?: string | null;
	to_iso?: string | null;
};

export default function UserPage() {
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const { tr } = useLocale();
	const [email, setEmail] = useState<string | null>(null);
	const [phone, setPhone] = useState<string | null>(null);
	const [addresses, setAddresses] = useState<AddressRow[]>([]);
	const [csvs, setCsvs] = useState<CsvRow[]>([]);
	const [csvSelection, setCsvSelection] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [showRawTx, setShowRawTx] = useState(true);

	useEffect(() => {
		let active = true;
		(async () => {
			const { data: userData } = await supabase.auth.getUser();
			if (!userData?.user) {
				window.location.href = "/signin";
				return;
			}
			if (active) {
				setEmail(userData.user.email ?? null);
				setPhone((userData.user.user_metadata as any)?.phone ?? null);
			}
			const res = await fetch("/api/addresses");
			if (res.ok) {
				const j = await res.json();
				if (active) setAddresses(j.data || []);
			}
			const csvRes = await fetch("/api/csvs");
			if (csvRes.ok) {
				const j = await csvRes.json();
				if (active) setCsvs(j.data || []);
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
			setMessage(
				tr({ no: "Kunne ikke eksportere data.", en: "Failed to export data." })
			);
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
		setDeleting(true);
		const res = await fetch("/api/account/delete", { method: "DELETE" });
		if (res.ok) {
			setAddresses([]);
			setCsvs([]);
			setMessage(
				tr({
					no: "Alle lagrede adresser og CSV-er slettet.",
					en: "All saved addresses and CSVs deleted."
				})
			);
		} else {
			setMessage(
				tr({ no: "Kunne ikke slette data.", en: "Failed to delete data." })
			);
		}
		setDeleting(false);
	}

	async function downloadCsv(csvId: string, address: string) {
		const res = await fetch(`/api/csvs?id=${encodeURIComponent(csvId)}`);
		if (!res.ok) {
			setMessage(
				tr({
					no: "Kunne ikke laste ned CSV.",
					en: "Failed to download CSV."
				})
			);
			return;
		}
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `sol2ks_${address}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}


	function formatDateRange(from?: string | null, to?: string | null) {
		if (!from && !to) return null;
		const fmt = (v?: string | null) => {
			if (!v) return "";
			const d = new Date(v);
			if (Number.isNaN(d.getTime())) return v;
			return d.toLocaleDateString("no-NO", {
				year: "numeric",
				month: "short",
				day: "2-digit"
			});
		};
		const a = fmt(from);
		const b = fmt(to);
		if (a && b) return `${a} – ${b}`;
		return a || b;
	}

	const csvGroups = useMemo(() => {
		const map = new Map<string, CsvRow[]>();
		for (const row of csvs) {
			const list = map.get(row.address) ?? [];
			list.push(row);
			map.set(row.address, list);
		}
		return Array.from(map.entries()).map(([address, list]) => {
			const sorted = [...list].sort((a, b) => {
				const at = new Date(a.updated_at || a.created_at || 0).getTime();
				const bt = new Date(b.updated_at || b.created_at || 0).getTime();
				return bt - at;
			});
			return { address, list: sorted, latest: sorted[0] };
		});
	}, [csvs]);

	const stats = useMemo(() => {
		const txRawTotal = csvs.reduce((sum, row) => {
			const count = row.raw_count ?? row.processed_count ?? 0;
			return sum + count;
		}, 0);
		const txProcessedTotal = csvs.reduce((sum, row) => {
			const count = row.processed_count ?? row.raw_count ?? 0;
			return sum + count;
		}, 0);
		return {
			csvCount: csvs.length,
			addressCount: addresses.length,
			txRawTotal,
			txProcessedTotal
		};
	}, [addresses.length, csvs]);


	return (
		<main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="mx-auto max-w-6xl px-4 pt-28 sm:pt-32 pb-10 sm:pb-16">
				<div className="rounded-3xl bg-white/95 dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 ring-1 ring-slate-300/70 dark:ring-white/10 overflow-hidden">
					<div className="border-b border-slate-200/70 dark:border-white/10 px-6 py-5 sm:px-10">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-center gap-4">
								<div className="h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-700 text-lg font-semibold flex items-center justify-center border border-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/30">
									<FiUser className="h-6 w-6" />
								</div>
								<div>
									<h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
										{tr({ no: "Bruker", en: "User" })}
									</h1>
									<p className="text-sm text-slate-600 dark:text-slate-300">
										{email ?? ""}
									</p>
									{phone && (
										<p className="text-sm text-slate-600 dark:text-slate-300">
											{phone}
										</p>
									)}
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Link
									href="/update-password"
									className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500"
									style={{ color: "#ffffff" }}
								>
									{tr({ no: "Endre passord", en: "Change password" })}
								</Link>
								<button
									onClick={signOut}
									className="rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5"
								>
									{tr({ no: "Logg ut", en: "Sign out" })}
								</button>
							</div>
						</div>
					</div>

					<div className="p-6 sm:p-10">
						<div className="grid gap-3 sm:grid-cols-3">
							<div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-50/80 dark:bg-white/5 p-3">
								<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
									{tr({ no: "CSV-er", en: "CSVs" })}
								</p>
								<p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
									{stats.csvCount}
								</p>
							</div>
							<div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-50/80 dark:bg-white/5 p-3">
								<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
									{tr({ no: "Adresser", en: "Addresses" })}
								</p>
								<p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
									{stats.addressCount}
								</p>
							</div>
							<div className="relative rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-50/80 dark:bg-white/5 p-3">
								<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
									{tr({ no: "Totale TX", en: "Total TX" })}
								</p>
								<p className="mt-1 text-xl font-semibold">
									{showRawTx ? (
										<span className="text-slate-900 dark:text-slate-100">
											{stats.txRawTotal}
										</span>
									) : (
										<span className="text-emerald-600 dark:text-emerald-400">
											{stats.txProcessedTotal}
										</span>
									)}
								</p>
								<div className="absolute right-2 top-2 inline-flex items-center rounded-full border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 p-0.5">
									<button
										type="button"
										onClick={() => setShowRawTx(false)}
										className={`inline-flex items-center px-2 py-1 text-[11px] font-semibold rounded-full transition ${
											!showRawTx
												? "bg-indigo-600 text-white"
												: "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
										}`}
										title={tr({ no: "Etter støvbehandling", en: "Processed" })}
										aria-label={tr({ no: "Etter støvbehandling", en: "Processed" })}
									>
										<MdOutlineCleaningServices className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() => setShowRawTx(true)}
										className={`inline-flex items-center px-2 py-1 text-[11px] font-semibold rounded-full transition ${
											showRawTx
												? "bg-indigo-600 text-white"
												: "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
										}`}
										title={tr({ no: "Rå", en: "Raw" })}
										aria-label={tr({ no: "Rå", en: "Raw" })}
									>
										<FiActivity className="h-3.5 w-3.5" />
									</button>
								</div>
							</div>
						</div>

						<div className="mt-6">
							<h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
								{tr({ no: "Genererte CSV-er", en: "Generated CSVs" })}
							</h2>
							{loading ? (
								<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
									{tr({ no: "Laster…", en: "Loading…" })}
								</p>
							) : csvs.length === 0 ? (
								<div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3">
									<p className="text-sm text-slate-600 dark:text-slate-300">
										{tr({
											no: "Ingen CSV-er lagret ennå.",
											en: "No saved CSVs yet."
										})}
									</p>
									<Link
										href="/csvgenerator"
										className="inline-flex items-center justify-center rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500"
										style={{ color: "#ffffff" }}
									>
										{tr({ no: "Kom i gang", en: "Get started" })}
									</Link>
								</div>
							) : (
								<ul className="mt-3 space-y-3">
									{csvGroups.map((group) => {
										const selectedId =
											csvSelection[group.address] || group.latest?.id;
										const selected =
											group.list.find((r) => r.id === selectedId) || group.latest;
										if (!selected) return null;
										const options = group.list.map((opt) => ({
											value: opt.id,
											label:
												formatDateRange(opt.from_iso, opt.to_iso) ||
												tr({ no: "Uten tidsrom", en: "No range" })
										}));
										return (
											<li
												key={group.address}
												className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 text-sm"
											>
												<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
													<div className="flex items-start gap-3">
														<div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
															<FiFileText className="h-4 w-4" />
														</div>
														<div>
															<div className="font-medium text-slate-800 dark:text-slate-100">
																{selected.label || selected.address}
															</div>
															<div className="text-slate-500 dark:text-slate-400">
																{selected.address}
															</div>
															<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
																<span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200 px-2 py-0.5">
																	<FiActivity className="h-3 w-3" />
																	<span>
																		{tr({ no: "TX", en: "TX" })}: {" "}
																		{selected.raw_count ?? 0}
																		{selected.processed_count !== null &&
																		selected.processed_count !== selected.raw_count
																			? ` → ${selected.processed_count}`
																			: ""}
																	</span>
																</span>
															</div>
														</div>
													</div>
													<div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
														<StyledSelect
															value={selected.id}
															onChange={(next) =>
																setCsvSelection((prev) => ({
																	...prev,
																	[group.address]: next
																}))
															}
															options={options}
															buttonClassName="inline-flex items-center gap-2 rounded-lg bg-white/90 ring-1 ring-black/10 px-3 py-1 text-xs text-slate-700 shadow-sm transition hover:bg-white dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
															menuClassName="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden"
															optionClassName="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 whitespace-nowrap"
															labelClassName="truncate whitespace-nowrap"
															ariaLabel={tr({
																no: "Velg tidsrom",
																en: "Select timeframe"
															})}
															minWidthLabel={
																options[0]?.label ||
																tr({ no: "Uten tidsrom", en: "No range" })
															}
														/>
														<Link
															href={`/csvgenerator?csvId=${encodeURIComponent(selected.id)}`}
															className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
															title={tr({ no: "Åpne", en: "Open" })}
															aria-label={tr({ no: "Åpne", en: "Open" })}
														>
															<FiEye className="h-5 w-5" />
														</Link>
														<button
															onClick={() => downloadCsv(selected.id, selected.address)}
															className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
															title={tr({
																no: "Last ned CSV",
																en: "Download CSV"
															})}
															aria-label={tr({
																no: "Last ned CSV",
																en: "Download CSV"
															})}
														>
															<FiDownload className="h-5 w-5" />
														</button>
													</div>
												</div>
											</li>
										);
									})}
								</ul>
							)}
							</div>

							<div className="mt-8">
								<h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
									{tr({ no: "Data og personvern", en: "Data & privacy" })}
								</h2>
								<div className="flex flex-wrap gap-3">
									<button
										onClick={exportData}
										className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500"
									>
										{tr({ no: "Eksporter data", en: "Export my data" })}
									</button>
									<button
										onClick={() => setDeleteOpen(true)}
										className="rounded-xl border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 px-4 py-2 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-500/10"
									>
										{tr({ no: "Slett mine data", en: "Delete my data" })}
									</button>
								</div>
							</div>

						{message && (
							<p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
								{message}
							</p>
						)}
					</div>
				</div>
			</div>

			{deleteOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center px-4">
					<button
						type="button"
						className="absolute inset-0 bg-slate-900/50"
						onClick={() => !deleting && setDeleteOpen(false)}
						aria-label={tr({ no: "Lukk", en: "Close" })}
					/>
					<div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-[#0e1729] border border-slate-200 dark:border-white/10 shadow-xl p-6">
						<h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
							{tr({ no: "Slette data?", en: "Delete data?" })}
						</h3>
						<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
							{tr({
								no: "Dette sletter alle lagrede adresser og CSV-er. Handlingen kan ikke angres.",
								en: "This deletes all saved addresses and CSVs. This action cannot be undone."
							})}
						</p>
						<div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
							<button
								type="button"
								onClick={() => setDeleteOpen(false)}
								disabled={deleting}
								className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
							>
								{tr({ no: "Avbryt", en: "Cancel" })}
							</button>
							<button
								type="button"
								onClick={async () => {
									await deleteData();
									setDeleteOpen(false);
								}}
								disabled={deleting}
								className="rounded-xl bg-rose-600 text-white px-4 py-2 text-sm font-medium hover:bg-rose-500 disabled:opacity-50"
							>
								{deleting
									? tr({ no: "Sletter...", en: "Deleting..." })
									: tr({ no: "Slett", en: "Delete" })}
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
