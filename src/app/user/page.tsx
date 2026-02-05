"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
	FiUser,
	FiInfo,
	FiAlertTriangle,
	FiTrash2,
	FiActivity,
	FiFileText,
	FiEye,
	FiDownload
} from "react-icons/fi";
import { BsXDiamondFill } from "react-icons/bs";
import { MdOutlineCleaningServices } from "react-icons/md";
import StyledSelect from "@/app/components/styled-select";
import { useLocale } from "@/app/components/locale-provider";

type AddressRow = {
	address: string;
	label: string | null;
	last_used_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

type CsvRow = {
	id: string;
	address: string;
	label?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	raw_count?: number | null;
	processed_count?: number | null;
	partial?: boolean | null;
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
	const [csvDeleteOpen, setCsvDeleteOpen] = useState(false);
	const [csvDeleting, setCsvDeleting] = useState(false);
	const [csvDeleteTarget, setCsvDeleteTarget] = useState<{
		id: string;
		address: string;
		label: string;
		rangeLabel: string;
	} | null>(null);
	const [showRawTx, setShowRawTx] = useState(true);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const params = new URLSearchParams(window.location.search);
		if (params.get("checkout") === "success") {
			window.dispatchEvent(new Event("sol2ks:billing:update"));
		}
	}, []);
	const [billingStatus, setBillingStatus] = useState<{
		rawUsed: number;
		freeRemaining: number;
		creditsRemaining: number;
	} | null>(null);

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
			const billingRes = await fetch("/api/billing/status");
			if (billingRes.ok) {
				const j = await billingRes.json();
				if (active) setBillingStatus(j);
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
					no: "Kontoen din er slettet.",
					en: "Your account has been deleted."
				})
			);
			await supabase.auth.signOut();
			window.location.href = "/";
		} else {
			setMessage(
				tr({ no: "Kunne ikke slette konto.", en: "Failed to delete account." })
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

	function getLatestCsvId(list: CsvRow[]) {
		if (list.length === 0) return null;
		const sorted = [...list].sort((a, b) => {
			const at = new Date(a.updated_at || a.created_at || 0).getTime();
			const bt = new Date(b.updated_at || b.created_at || 0).getTime();
			return bt - at;
		});
		return sorted[0]?.id ?? null;
	}

	async function deleteCsv({
		id,
		address,
		mode
	}: {
		id: string;
		address: string;
		mode: "single" | "all";
	}) {
		setMessage(null);
		setCsvDeleting(true);
		const res = await fetch("/api/csvs", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(mode === "single" ? { id } : { address })
		});
		if (res.ok) {
			setCsvs((prev) => {
				const next =
					mode === "single"
						? prev.filter((row) => row.id !== id)
						: prev.filter((row) => row.address !== address);
				const addressList = next.filter((row) => row.address === address);
				setCsvSelection((prevSel) => {
					const updated = { ...prevSel };
					if (addressList.length === 0) {
						delete updated[address];
					} else {
						const latestId = getLatestCsvId(addressList);
						if (latestId) updated[address] = latestId;
					}
					return updated;
				});
				return next;
			});
			setMessage(
				mode === "single"
					? tr({ no: "CSV slettet.", en: "CSV deleted." })
					: tr({
							no: "Alle CSV-er for adressen slettet.",
							en: "All CSVs for the address deleted."
						})
			);
		} else {
			setMessage(
				tr({ no: "Kunne ikke slette CSV.", en: "Failed to delete CSV." })
			);
		}
		setCsvDeleting(false);
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

	const shortAddress = (value?: string | null) => {
		if (!value) return "";
		if (value.length <= 10) return value;
		return `${value.slice(0, 5)}…${value.slice(-5)}`;
	};

	return (
		<main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="mx-auto max-w-6xl px-4 pt-28 sm:pt-32 pb-10 sm:pb-16">
				<div className="rounded-3xl bg-white/95 dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 ring-1 ring-slate-300/70 dark:ring-white/10 overflow-visible">
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
							<div className="grid w-full sm:w-auto grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
								<Link
									href="/update-password"
									className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500 whitespace-nowrap"
									style={{ color: "#ffffff" }}
								>
									{tr({ no: "Endre passord", en: "Change password" })}
								</Link>
								<button
									onClick={signOut}
									className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5 whitespace-nowrap"
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
										aria-label={tr({
											no: "Etter støvbehandling",
											en: "Processed"
										})}
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

						<div className="mt-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-50/80 dark:bg-white/5 p-4">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
											{tr({ no: "TX Credits", en: "TX Credits" })}
										</p>
										<div className="relative group">
											<button
												type="button"
												aria-label={tr({
													no: "Hvordan fungerer TX Credits?",
													en: "How do TX Credits work?"
												})}
												className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 focus:outline-none"
											>
												<FiInfo className="h-4 w-4" />
											</button>
											<div
												role="tooltip"
												className="pointer-events-none absolute left-0 top-7 z-30 hidden w-[min(92vw,22rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 shadow-xl group-hover:block group-focus-within:block sm:left-auto sm:right-0"
											>
												<p className="mb-1 font-medium">
													{tr({
														no: "Slik fungerer TX Credits",
														en: "How TX Credits work"
													})}
												</p>
												<ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
													<li>
														{tr({
															no: "1 TX Credit brukes per 1 rå transaksjon.",
															en: "1 TX Credit is spent per 1 raw transaction."
														})}
													</li>
													<li>
														{tr({
															no: "Rå transaksjoner = transaksjoner som ikke er støvbehandlet.",
															en: "Raw transactions are transactions that are not dust-processed."
														})}
													</li>
													<li>
														{tr({
															no: "Alle brukere får 50 gratis TX Credits ved registrering.",
															en: "Every user gets 50 free TX Credits on sign up."
														})}
													</li>
												</ul>
											</div>
										</div>
									</div>
									{billingStatus ? (
										<div className="mt-2 flex items-center justify-between gap-3">
											<div className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
												<BsXDiamondFill className="h-4 w-4 text-amber-500" />
												<span className="tabular-nums">
													{billingStatus.freeRemaining +
														billingStatus.creditsRemaining}
												</span>
											</div>
											<Link
												href="/pricing"
												className="inline-flex sm:hidden items-center rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500 whitespace-nowrap"
												style={{ color: "#ffffff" }}
											>
												{tr({ no: "Kjøp flere", en: "Buy more" })}
											</Link>
										</div>
									) : (
										<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
											{tr({ no: "Laster…", en: "Loading…" })}
										</p>
									)}
								</div>
								{billingStatus && (
									<div className="hidden sm:flex items-center gap-3 sm:ml-6 sm:justify-end">
										<Link
											href="/pricing"
											className="inline-flex items-center rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500 whitespace-nowrap"
											style={{ color: "#ffffff" }}
										>
											{tr({ no: "Kjøp flere", en: "Buy more" })}
										</Link>
									</div>
								)}
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
											group.list.find((r) => r.id === selectedId) ||
											group.latest;
										if (!selected) return null;
										const options = group.list.map((opt) => {
											const baseLabel =
												formatDateRange(opt.from_iso, opt.to_iso) ||
												tr({ no: "Uten tidsrom", en: "No range" });
											return {
												value: opt.id,
												label: opt.partial
													? `${baseLabel} · ${tr({
															no: "Ufullstendig",
															en: "Incomplete"
														})}`
													: baseLabel
											};
										});
										return (
											<li
												key={group.address}
												className="relative rounded-2xl border border-slate-200 dark:border-white/10 p-4 text-sm"
											>
												<div className="absolute right-4 top-4 md:hidden">
													<span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200 px-2 py-0.5 text-xs">
														<FiActivity className="h-3 w-3" />
														<span>
															{tr({ no: "TX", en: "TX" })}: {selected.raw_count ?? 0}
															{selected.processed_count !== null &&
															selected.processed_count !== selected.raw_count
																? ` → ${selected.processed_count}`
																: ""}
														</span>
													</span>
												</div>
												<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
													<div className="flex items-start gap-3">
														<div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
															<FiFileText className="h-4 w-4" />
														</div>
														<div>
															<div className="pr-14 md:pr-0 max-w-[55vw] sm:max-w-[320px] truncate font-medium text-slate-800 dark:text-slate-100" title={selected.label || selected.address}>
																{selected.label || selected.address}
															</div>
															<div className="mt-0.5 pr-14 md:pr-0 text-xs text-slate-500 dark:text-slate-400 md:hidden">
																{shortAddress(selected.address)}
															</div>
															<div className="mt-0.5 pr-0 text-xs text-slate-500 dark:text-slate-400 hidden md:block">
																{selected.address}
															</div>
															<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
																<span className="hidden md:inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200 px-2 py-0.5">
																	<FiActivity className="h-3 w-3" />
																	<span>
																		{tr({ no: "TX", en: "TX" })}: {selected.raw_count ?? 0}
																		{selected.processed_count !== null &&
																		selected.processed_count !== selected.raw_count
																			? ` → ${selected.processed_count}`
																			: ""}
																	</span>
																</span>
																{selected.partial && (
																	<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 px-2 py-0.5">
																		<FiAlertTriangle className="h-3 w-3" />
																		<span>
																			{tr({
																				no: "Ufullstendig skann",
																				en: "Incomplete scan"
																			})}
																		</span>
																	</span>
																)}
															</div>
														</div>
													</div>
													<div className="mt-2 flex w-full flex-col gap-2 sm:mt-0 sm:w-auto sm:flex-row sm:items-center sm:gap-2 sm:ml-auto">
														<StyledSelect
															value={selected.id}
															onChange={(next) =>
																setCsvSelection((prev) => ({
																	...prev,
																	[group.address]: next
																}))
															}
															options={options}
															buttonClassName="inline-flex w-full sm:w-auto items-center justify-between gap-2 rounded-lg bg-white/90 ring-1 ring-black/10 px-3 py-1 text-xs text-slate-700 shadow-sm transition hover:bg-white dark:bg-white/5 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-white/10"
															menuClassName="w-full sm:w-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden"
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
														<div className="flex flex-wrap items-center justify-center sm:justify-end gap-2">
															<button
																onClick={() => {
																	setCsvDeleteTarget({
																		id: selected.id,
																		address: selected.address,
																		label: selected.label || selected.address,
																		rangeLabel:
																			formatDateRange(
																				selected.from_iso,
																				selected.to_iso
																			) ||
																			tr({ no: "Uten tidsrom", en: "No range" })
																	});
																setCsvDeleteOpen(true);
															}}
															className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
															title={tr({ no: "Slett CSV", en: "Delete CSV" })}
															aria-label={tr({
																no: "Slett CSV",
																en: "Delete CSV"
															})}
															>
															<FiTrash2 className="h-5 w-5" />
														</button>
														<Link
															href={`/csvgenerator?csvId=${encodeURIComponent(selected.id)}`}
															className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
															title={tr({ no: "Åpne", en: "Open" })}
															aria-label={tr({ no: "Åpne", en: "Open" })}
														>
															<FiEye className="h-5 w-5" />
														</Link>
														<button
															onClick={() =>
																downloadCsv(selected.id, selected.address)
															}
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
							<div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
								<button
									onClick={exportData}
									className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-500 whitespace-nowrap"
								>
									{tr({ no: "Eksporter data", en: "Export my data" })}
								</button>
								<button
									onClick={() => setDeleteOpen(true)}
									className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 px-4 py-2 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-500/10 whitespace-nowrap"
								>
									{tr({ no: "Slett kontoen min", en: "Delete my account" })}
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
							{tr({ no: "Slette konto?", en: "Delete account?" })}
						</h3>
						<p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
							{tr({
								no: "Dette sletter kontoen din og alle lagrede adresser og CSV-er. Handlingen kan ikke angres.",
								en: "This deletes your account and all saved addresses and CSVs. This action cannot be undone."
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

			{csvDeleteOpen && csvDeleteTarget && (
				<div className="fixed inset-0 z-50 flex items-center justify-center px-4">
					<button
						type="button"
						className="absolute inset-0 bg-slate-900/50"
						onClick={() => !csvDeleting && setCsvDeleteOpen(false)}
						aria-label={tr({ no: "Lukk", en: "Close" })}
					/>
					<div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-[#0e1729] border border-slate-200 dark:border-white/10 shadow-xl p-6">
						<h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
							{tr({ no: "Slette CSV?", en: "Delete CSV?" })}
						</h3>
						<div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
							<p>
								{tr({ no: "Adresse:", en: "Address:" })} {csvDeleteTarget.label}
							</p>
							<p>
								{tr({ no: "Tidsrom:", en: "Timeframe:" })}{" "}
								{csvDeleteTarget.rangeLabel}
							</p>
							<p className="pt-1">
								{tr({
									no: "Velg om du vil slette bare dette tidsrommet eller alle CSV-er for adressen.",
									en: "Choose whether to delete only this timeframe or all CSVs for the address."
								})}
							</p>
							<p className="text-rose-600 dark:text-rose-300">
								{tr({
									no: "Denne handlingen kan ikke angres.",
									en: "There is no way back from this action."
								})}
							</p>
						</div>
						<div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
							<button
								type="button"
								onClick={() => setCsvDeleteOpen(false)}
								disabled={csvDeleting}
								className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
							>
								{tr({ no: "Avbryt", en: "Cancel" })}
							</button>
							<button
								type="button"
								onClick={async () => {
									await deleteCsv({
										id: csvDeleteTarget.id,
										address: csvDeleteTarget.address,
										mode: "all"
									});
									setCsvDeleteOpen(false);
								}}
								disabled={csvDeleting}
								className="rounded-xl border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 px-4 py-2 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50"
							>
								{csvDeleting
									? tr({ no: "Sletter...", en: "Deleting..." })
									: tr({ no: "Slett alle", en: "Delete all" })}
							</button>
							<button
								type="button"
								onClick={async () => {
									await deleteCsv({
										id: csvDeleteTarget.id,
										address: csvDeleteTarget.address,
										mode: "single"
									});
									setCsvDeleteOpen(false);
								}}
								disabled={csvDeleting}
								className="rounded-xl bg-rose-600 text-white px-4 py-2 text-sm font-medium hover:bg-rose-500 disabled:opacity-50"
							>
								{csvDeleting
									? tr({ no: "Sletter...", en: "Deleting..." })
									: tr({ no: "Slett valgt", en: "Delete selected" })}
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}
