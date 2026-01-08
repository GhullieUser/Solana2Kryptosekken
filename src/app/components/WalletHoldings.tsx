"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { SiSolana } from "react-icons/si";
import {
	IoWalletOutline,
	IoCopyOutline,
	IoCheckmarkCircle
} from "react-icons/io5";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { useLocale } from "./locale-provider";

type Props = {
	address: string;
	includeNFT?: boolean;
	/** Render & fetch only after “Sjekk lommebok”. */
	enabled?: boolean;
};

type Holding = {
	mint: string;
	symbol: string;
	amount?: number;
	amountText?: string;
	decimals?: number;
	isNFT?: boolean;
	priceUSD?: number | string | null;
	valueUSD?: number | string | null;
	/** Optional logo URL from the API (e.g. Jupiter metadata) */
	logoURI?: string;
};

type ApiResponse = {
	holdings?: Holding[];
	updatedAt?: number | string | null;
	error?: string;
};

type SortKey = "token" | "amount" | "mint" | "usd";
type SortDir = "asc" | "desc";
type Currency = "USD" | "NOK";

export default function WalletHoldings({
	address,
	includeNFT = false,
	enabled = false
}: Props) {
	const { tr } = useLocale();
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [holdings, setHoldings] = useState<Holding[]>([]);
	const [justCopied, setJustCopied] = useState<"wallet" | string | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	// Currency toggle (USD <-> NOK)
	const [currency, setCurrency] = useState<Currency>("USD");
	const [usdToNok, setUsdToNok] = useState<number>(10.0); // safe fallback
	const [fxLoaded, setFxLoaded] = useState(false);
	const [fxErr, setFxErr] = useState<string | null>(null);

	// Sorting: default is VALUE, descending
	const [sortKey, setSortKey] = useState<SortKey>("usd");
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	// Snapshot of the last "checked" inputs (set on rising-edge of `enabled`)
	const [committed, setCommitted] = useState<{
		address: string;
		includeNFT: boolean;
	} | null>(null);
	const prevEnabled = useRef<boolean>(enabled);

	// --- refs + computed max height for 10 rows ---
	const headerRef = useRef<HTMLTableSectionElement | null>(null);
	const firstRowRef = useRef<HTMLTableRowElement | null>(null);
	const [maxTableHeightPx, setMaxTableHeightPx] = useState<number | null>(null);
	const targetRows = 10;

	const copyText = useCallback(async (txt: string, key: "wallet" | string) => {
		try {
			await navigator.clipboard.writeText(txt);
			setJustCopied(key);
			setTimeout(() => setJustCopied((k) => (k === key ? null : k)), 1500);
		} catch {
			const ta = document.createElement("textarea");
			ta.value = txt;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand("copy");
				setJustCopied(key);
				setTimeout(() => setJustCopied((k) => (k === key ? null : k)), 1500);
			} finally {
				document.body.removeChild(ta);
			}
		}
	}, []);

	/* ================== Commit (freeze) inputs on "Sjekk lommebok" ================== */
	useEffect(() => {
		const addr = address?.trim();
		const rising = enabled && !prevEnabled.current;
		const needsInitialCommit = enabled && !!addr && committed === null;

		if ((rising || needsInitialCommit) && addr) {
			setCommitted({ address: addr, includeNFT });
		}

		prevEnabled.current = enabled;
	}, [enabled, address, includeNFT, committed]);

	/* ================== Fetch when committed snapshot changes ================== */
	useEffect(() => {
		if (!committed) return;

		const { address: cAddress, includeNFT: cIncludeNFT } = committed;

		let cancelled = false;
		const ctrl = new AbortController();

		async function run() {
			setLoading(true);
			setErr(null);
			try {
				const res = await fetch("/api/kryptosekken/holdings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ address: cAddress, includeNFT: cIncludeNFT }),
					signal: ctrl.signal
				});

				if (!res.ok) {
					let msg = `HTTP ${res.status}`;
					try {
						const j = (await res.json()) as ApiResponse;
						if (j?.error) msg = j.error;
					} catch {}
					throw new Error(msg);
				}

				const j = (await res.json()) as ApiResponse;
				const list = Array.isArray(j.holdings) ? j.holdings : [];

				const filtered = (
					cIncludeNFT ? list : list.filter((h) => !h.isNFT)
				).filter((h) => {
					const n =
						typeof h.amount === "number"
							? h.amount
							: Number(h.amountText ?? "0");
					return Number.isFinite(n) && n > 0;
				});

				if (!cancelled) setHoldings(filtered);
			} catch (e: any) {
				if (!cancelled) setErr(e?.message || "Ukjent feil");
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		run();
		return () => {
			cancelled = true;
			ctrl.abort();
		};
	}, [committed]);

	// Fetch a USD->NOK rate the first time user switches to NOK (optional)
	useEffect(() => {
		if (currency !== "NOK" || fxLoaded) return;
		let cancelled = false;
		(async () => {
			try {
				const r = await fetch("/api/kryptosekken/fx?base=USD&quote=NOK");
				if (r.ok) {
					const j = await r.json();
					const rate = Number(j?.rate ?? j?.usdNok);
					if (!cancelled && Number.isFinite(rate) && rate > 0) {
						setUsdToNok(rate);
						setFxErr(null);
					}
				}
			} catch (e: any) {
				setFxErr(e?.message || null);
			} finally {
				if (!cancelled) setFxLoaded(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [currency, fxLoaded]);

	const fmt = useMemo(
		() => new Intl.NumberFormat("no-NO", { maximumFractionDigits: 12 }),
		[]
	);
	const fmtUSD = useMemo(
		() =>
			new Intl.NumberFormat("no-NO", {
				style: "currency",
				currency: "USD",
				maximumFractionDigits: 2
			}),
		[]
	);
	const fmtNOK = useMemo(
		() =>
			new Intl.NumberFormat("no-NO", {
				style: "currency",
				currency: "NOK",
				maximumFractionDigits: 2
			}),
		[]
	);
	const fmtCurrency = currency === "USD" ? fmtUSD : fmtNOK;

	const numAmount = useCallback((h: Holding) => {
		if (typeof h.amount === "number")
			return Number.isFinite(h.amount) ? h.amount : 0;
		return toNum(h.amountText);
	}, []);

	const valueNumber = useCallback(
		(h: Holding) => {
			const usd =
				toNum(h.valueUSD) ||
				(Number.isFinite(toNum(h.priceUSD))
					? toNum(h.priceUSD) * numAmount(h)
					: 0);
			if (currency === "USD") return usd;
			return (
				usd * (Number.isFinite(usdToNok) && usdToNok > 0 ? usdToNok : 10.0)
			);
		},
		[currency, usdToNok, numAmount]
	);

	const shown = useMemo(() => {
		const by = [...holdings];

		by.sort((a, b) => {
			let diff = 0;

			if (sortKey === "token") {
				const as = (a.symbol || "").toUpperCase();
				const bs = (b.symbol || "").toUpperCase();
				diff = as.localeCompare(bs, "nb", { sensitivity: "base" });
			} else if (sortKey === "amount") {
				diff = numAmount(b) - numAmount(a); // default desc
			} else if (sortKey === "usd") {
				diff = valueNumber(b) - valueNumber(a); // default desc
			} else if (sortKey === "mint") {
				diff = (a.mint || "").localeCompare(b.mint || "", "nb", {
					sensitivity: "base"
				});
			}

			if (sortDir === "asc") diff = -diff;
			if (diff === 0) {
				const as = (a.symbol || "").toUpperCase();
				const bs = (b.symbol || "").toUpperCase();
				return as.localeCompare(bs, "nb", { sensitivity: "base" });
			}
			return diff;
		});

		return by;
	}, [holdings, sortKey, sortDir, valueNumber, numAmount]);

	const totalValueNum = useMemo(
		() => shown.reduce((acc, h) => acc + valueNumber(h), 0),
		[shown, valueNumber]
	);
	const totalValueText = fmtCurrency.format(
		Number.isFinite(totalValueNum) ? totalValueNum : 0
	);

	// --- Measure header/row to cap height at ~ 10 rows when needed ---
	useEffect(() => {
		if (collapsed || loading || err || shown.length <= targetRows) {
			setMaxTableHeightPx(null);
			return;
		}
		const measure = () => {
			const headerH = headerRef.current?.getBoundingClientRect().height ?? 0;
			const rowH = firstRowRef.current?.getBoundingClientRect().height ?? 0;
			if (rowH > 0) {
				const fudge = 2;
				setMaxTableHeightPx(Math.round(headerH + rowH * targetRows + fudge));
			}
		};
		const raf = requestAnimationFrame(measure);
		return () => cancelAnimationFrame(raf);
	}, [shown.length, collapsed, loading, err, sortKey, sortDir]);

	if (!enabled || !committed || !committed.address) return null;

	const handleSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir(key === "token" || key === "mint" ? "asc" : "desc");
		}
	};

	const ariaSortFor = (key: SortKey): React.AriaAttributes["aria-sort"] => {
		if (key !== sortKey) return "none";
		return sortDir === "asc" ? "ascending" : "descending";
	};

	const SortIcon = ({ active }: { active: boolean }) =>
		active ? (
			sortDir === "asc" ? (
				<FiChevronUp className="h-4 w-4" />
			) : (
				<FiChevronDown className="h-4 w-4" />
			)
		) : (
			<span className="inline-block w-4" />
		);

	const valueHeaderLabel =
		currency === "USD"
			? tr({ no: "Verdi (USD)", en: "Value (USD)" })
			: tr({ no: "Verdi (NOK)", en: "Value (NOK)" });

	return (
		<section
			className="mt-6 rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 ring-1 ring-slate-300/80 dark:ring-white/10"
			aria-label={tr({ no: "Beholdning", en: "Holdings" })}
		>
			{/* Header */}
			<div
				className={`px-4 py-3 sm:px-10 sm:py-6 ${
					!collapsed ? "border-b border-slate-100 dark:border-slate-800" : ""
				}`}
			>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					{/* Left: icon + two-line text */}
					<div className="flex items-start gap-3 min-w-0">
						<div className="my-auto flex h-8 w-8 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
							<IoWalletOutline className="h-4 w-4 sm:h-6 sm:w-6" />
						</div>

						<div className="min-w-0">
							<h2 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-slate-100">
								{tr({ no: "Nåværende beholdning", en: "Current holdings" })}
							</h2>

							<div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
								<span
									className="truncate font-mono text-[11px] sm:text-[12px] max-w-[28ch] sm:max-w-[50ch]"
									title={committed.address}
								>
									{committed.address}
								</span>

								<button
									type="button"
									onClick={() => copyText(committed.address || "", "wallet")}
									disabled={!committed.address}
									className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
									title={tr({ no: "Kopier adresse", en: "Copy address" })}
									aria-label={tr({ no: "Kopier adresse", en: "Copy address" })}
								>
									<IoCopyOutline className="h-3.5 w-3.5" />
								</button>

								<span className="opacity-50 hidden sm:inline">•</span>
								<span className="hidden sm:inline">
									{loading
										? tr({ no: "Henter…", en: "Fetching…" })
										: tr({
												no: `${shown.length} tokens`,
												en: `${shown.length} tokens`
										  })}
								</span>
							</div>
						</div>
					</div>

					{/* Right: Total verdi + collapse toggle */}
					<div className="flex w-full sm:w-auto flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
						<div className="flex items-baseline justify-between sm:block">
							<div className="text-[11px] text-slate-500 dark:text-slate-400">
								{tr({ no: "Total verdi", en: "Total value" })}
							</div>
							<div className="text-base sm:text-lg font-semibold text-emerald-700 dark:text-emerald-400">
								{totalValueText}
							</div>
							{currency === "NOK" && fxErr && (
								<div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
									{tr({
										no: `(Bruker fallback-kurs ${usdToNok.toFixed(2)})`,
										en: `(Using fallback rate ${usdToNok.toFixed(2)})`
									})}
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={() => setCollapsed((v) => !v)}
							className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10 w-full sm:w-auto shrink-0"
							aria-expanded={!collapsed}
							aria-controls="wallet-holdings-content"
						>
							{collapsed ? (
								<>
									<FiChevronDown className="h-4 w-4" />
									{tr({ no: "Vis tokens", en: "Show tokens" })}
								</>
							) : (
								<>
									<FiChevronUp className="h-4 w-4" />
									{tr({ no: "Skjul tokens", en: "Hide tokens" })}
								</>
							)}
						</button>
					</div>
				</div>
			</div>

			{/* Collapsible content */}
			<div
				id="wallet-holdings-content"
				className={`px-4 py-4 sm:px-10 sm:py-6 ${collapsed ? "hidden" : ""}`}
			>
				{loading && (
					<div className="animate-pulse space-y-2">
						<div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
						<div className="h-4 w-72 rounded bg-slate-200 dark:bg-slate-700" />
						<div className="h-4 w-56 rounded bg-slate-200 dark:bg-slate-700" />
					</div>
				)}

				{!loading && err && (
					<div className="text-sm text-red-600 dark:text-red-400">
						{tr({
							no: "Klarte ikke å hente beholdning:",
							en: "Failed to fetch holdings:"
						})}{" "}
						{err}
					</div>
				)}

				{!loading && !err && shown.length === 0 && (
					<div className="text-sm text-slate-600 dark:text-slate-300">
						{tr({
							no: "Ingen tokens funnet for denne lommeboken.",
							en: "No tokens found for this wallet."
						})}
					</div>
				)}

				{!loading && !err && shown.length > 0 && (
					<div className="overflow-x-auto">
						<div
							className="relative"
							style={{
								overflowY:
									shown.length > targetRows ? ("auto" as const) : "visible",
								maxHeight:
									shown.length > targetRows && maxTableHeightPx
										? `${maxTableHeightPx}px`
										: undefined
							}}
						>
							<table className="min-w-full text-xs sm:text-sm whitespace-nowrap">
								<thead
									ref={headerRef}
									className="sticky top-0 bg-white dark:bg-[#0e1729] z-10 text-left text-slate-500 dark:text-slate-400"
								>
									<tr>
										<th
											scope="col"
											aria-sort={ariaSortFor("token")}
											className="py-2 pr-4 font-medium"
										>
											<button
												type="button"
												onClick={() => handleSort("token")}
												className="inline-flex items-center gap-1 hover:underline underline-offset-2"
												title={tr({
													no: "Sorter alfabetisk",
													en: "Sort alphabetically"
												})}
											>
												{tr({ no: "Token", en: "Token" })}
												<SortIcon active={sortKey === "token"} />
											</button>
										</th>

										<th
											scope="col"
											aria-sort={ariaSortFor("amount")}
											className="py-2 pr-4 font-medium"
										>
											<button
												type="button"
												onClick={() => handleSort("amount")}
												className="inline-flex items-center gap-1 hover:underline underline-offset-2"
												title={tr({
													no: "Sorter etter mengde",
													en: "Sort by amount"
												})}
											>
												{tr({ no: "Mengde", en: "Amount" })}
												<SortIcon active={sortKey === "amount"} />
											</button>
										</th>

										<th
											scope="col"
											aria-sort={ariaSortFor("mint")}
											className="py-2 pr-4 font-medium hidden sm:table-cell"
										>
											<button
												type="button"
												onClick={() => handleSort("mint")}
												className="inline-flex items-center gap-1 hover:underline underline-offset-2"
												title={tr({
													no: "Sorter etter mint",
													en: "Sort by mint"
												})}
											>
												{tr({ no: "Mint", en: "Mint" })}
												<SortIcon active={sortKey === "mint"} />
											</button>
										</th>

										{/* Value column header with the currency switch moved here */}
										<th
											scope="col"
											aria-sort={ariaSortFor("usd")}
											className="py-2 pr-0 font-medium"
										>
											<div className="flex items-center justify-end gap-2">
												<button
													type="button"
													onClick={() => handleSort("usd")}
													className="inline-flex items-center gap-1 hover:underline underline-offset-2"
													title={tr({
														no: `Sorter etter verdi (${currency})`,
														en: `Sort by value (${currency})`
													})}
												>
													{valueHeaderLabel}
													<SortIcon active={sortKey === "usd"} />
												</button>

												<CurrencyToggle
													currency={currency}
													onChange={setCurrency}
												/>
											</div>
										</th>
									</tr>
								</thead>

								<tbody>
									{shown.map((h, idx) => {
										const amountText =
											typeof h.amountText === "string" &&
											h.amountText.length > 0
												? h.amountText
												: typeof h.amount === "number"
												? fmt.format(h.amount)
												: "0";

										const vNum = valueNumber(h);
										const valueKnown = Number.isFinite(vNum) && vNum > 0;
										const valueText = valueKnown
											? fmtCurrency.format(vNum)
											: "—";

										return (
											<tr
												key={`${h.mint}-${h.symbol}`}
												ref={idx === 0 ? firstRowRef : undefined}
												className="border-t border-slate-100 dark:border-slate-800"
											>
												<td className="py-2 pr-4">
													<div className="flex items-center gap-2 min-w-0">
														<TokenAvatar
															symbol={h.symbol}
															logoURI={h.logoURI}
															mint={h.mint}
														/>
														<span className="font-medium text-slate-800 dark:text-slate-100 truncate max-w-[45vw] sm:max-w-none">
															{h.symbol || "?"}
														</span>
														{h.isNFT && (
															<span className="ml-1 rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-300">
																NFT
															</span>
														)}
													</div>
												</td>

												<td className="py-2 pr-4 text-slate-800 dark:text-slate-100 whitespace-nowrap">
													{amountText}
												</td>

												<td className="py-2 pr-4 hidden sm:table-cell text-slate-500 dark:text-slate-400">
													<div className="flex items-center gap-2">
														<a
															href={`https://solscan.io/token/${h.mint}`}
															target="_blank"
															rel="noopener noreferrer"
															className="underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:hover:text-slate-300"
															title={h.mint}
														>
															{shorten(h.mint)}
														</a>
														<button
															type="button"
															onClick={() => copyText(h.mint, h.mint)}
															className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
															title={tr({
																no: "Kopier mint-adresse",
																en: "Copy mint address"
															})}
														>
															{justCopied === h.mint ? (
																<IoCheckmarkCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
															) : (
																<IoCopyOutline className="h-4 w-4" />
															)}
														</button>
													</div>
												</td>

												<td className="py-2 pr-0 text-right whitespace-nowrap">
													<span
														className={
															valueKnown
																? "font-semibold text-emerald-700 dark:text-emerald-400"
																: "text-slate-500 dark:text-slate-400"
														}
													>
														{valueText}
													</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}

/* ===== UI bits ===== */
function CurrencyToggle({
	currency,
	onChange
}: {
	currency: "USD" | "NOK";
	onChange: (c: "USD" | "NOK") => void;
}) {
	const { tr } = useLocale();
	return (
		<div
			className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-white dark:bg-slate-900"
			role="group"
			aria-label={tr({ no: "Valuta", en: "Currency" })}
		>
			<button
				type="button"
				onClick={() => onChange("USD")}
				className={[
					"px-2.5 py-1 text-[11px] sm:text-xs rounded-md",
					currency === "USD"
						? "bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
						: "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
				].join(" ")}
				aria-pressed={currency === "USD"}
			>
				USD
			</button>
			<button
				type="button"
				onClick={() => onChange("NOK")}
				className={[
					"px-2.5 py-1 text-[11px] sm:text-xs rounded-md",
					currency === "NOK"
						? "bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
						: "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
				].join(" ")}
				aria-pressed={currency === "NOK"}
			>
				NOK
			</button>
		</div>
	);
}

/* ================= Helpers & sub-components ================= */

function shorten(s?: string, head = 5, tail = 5) {
	if (!s) return "";
	return s.length <= head + tail ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Coerce API value into a safe number (handles undefined/null/string). */
function toNum(v: unknown): number {
	if (typeof v === "number") return Number.isFinite(v) ? v : 0;
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

function normalizeLogoUrl(input?: string) {
	if (!input) return undefined;
	if (input.startsWith("ipfs://")) {
		const cid = input.replace("ipfs://", "");
		return `https://ipfs.io/ipfs/${cid}`;
	}
	return input;
}

function TokenAvatar({
	symbol,
	logoURI,
	mint
}: {
	symbol?: string;
	logoURI?: string;
	mint: string;
}) {
	const [errored, setErrored] = useState(false);

	if ((symbol || "").toUpperCase() === "SOL") {
		return (
			<span className="inline-flex h-6 w-6 items-center ml-1 justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-black dark:text-white">
				<SiSolana className="h-3.5 w-3.5" />
			</span>
		);
	}

	const url = normalizeLogoUrl(logoURI);

	if (url && !errored) {
		return (
			<Image
				src={url}
				alt={symbol || mint}
				width={24}
				height={24}
				className="h-6 w-6 rounded-full ring-1 ml-1 object-cover"
				unoptimized
				onError={() => setErrored(true)}
			/>
		);
	}

	const letter = (symbol || "?").slice(0, 1).toUpperCase();
	return (
		<span className="inline-flex h-6 w-6 ml-1 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
			{letter}
		</span>
	);
}
