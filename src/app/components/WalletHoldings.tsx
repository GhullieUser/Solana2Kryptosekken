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

export default function WalletHoldings({
	address,
	includeNFT = false,
	enabled = false
}: Props) {
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [holdings, setHoldings] = useState<Holding[]>([]);
	const [justCopied, setJustCopied] = useState<"wallet" | string | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	// --- NEW: refs + computed max height for 10 rows ---
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
			// Fallback for older browsers
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

	useEffect(() => {
		const addr = address?.trim();
		if (!enabled || !addr) return;

		let cancelled = false;
		const ctrl = new AbortController();

		async function run() {
			setLoading(true);
			setErr(null);
			try {
				const res = await fetch("/api/kryptosekken/holdings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ address: addr, includeNFT }),
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

				// Client-side safety filter
				const filtered = (
					includeNFT ? list : list.filter((h) => !h.isNFT)
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
	}, [address, includeNFT, enabled]);

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

	const shown = useMemo(() => {
		const byValue = [...holdings].sort((a, b) => {
			const av = toNum(b.valueUSD); // sort desc; compare b-a (we’ll swap below)
			const bv = toNum(a.valueUSD);
			if (av !== bv) return av - bv; // because we flipped a/b
			return (a.symbol || "").localeCompare(b.symbol || "");
		});
		return byValue;
	}, [holdings]);

	const totalValueUsdNum = useMemo(
		() => shown.reduce((acc, h) => acc + toNum(h.valueUSD), 0),
		[shown]
	);
	const totalValueText = fmtUSD.format(
		Number.isFinite(totalValueUsdNum) ? totalValueUsdNum : 0
	);

	// --- NEW: Measure header/row to cap height at ~ 10 rows when needed ---
	useEffect(() => {
		// Only calculate when visible (not collapsed), not loading, no error, and there are more than targetRows.
		if (collapsed || loading || err || shown.length <= targetRows) {
			setMaxTableHeightPx(null);
			return;
		}
		const measure = () => {
			const headerH = headerRef.current?.getBoundingClientRect().height ?? 0;
			const rowH = firstRowRef.current?.getBoundingClientRect().height ?? 0;
			if (rowH > 0) {
				// A small extra padding to account for borders
				const fudge = 2;
				setMaxTableHeightPx(Math.round(headerH + rowH * targetRows + fudge));
			}
		};
		// Wait a frame to ensure layout has settled
		const raf = requestAnimationFrame(measure);
		return () => cancelAnimationFrame(raf);
	}, [shown.length, collapsed, loading, err]);

	// Only gate on "enabled" and address. We still render the card even if empty/error.
	if (!enabled || !address?.trim()) return null;

	return (
		<section
			className="mt-6 rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/60 dark:ring-slate-800/60"
			aria-label="Beholdning"
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

						{/* Two-line text */}
						<div className="min-w-0">
							{/* Row 1: title */}
							<h2 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-slate-100">
								Nåværende beholdning
							</h2>

							{/* Row 2: address + copy (+ token count on sm+) */}
							<div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
								<span
									className="truncate font-mono text-[11px] sm:text-[12px] max-w-[28ch] sm:max-w-[50ch]"
									title={address}
								>
									{address}
								</span>

								{/* Copy button */}
								<button
									type="button"
									onClick={() => copyText(address || "", "wallet")}
									disabled={!address}
									className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
									title="Kopier adresse"
									aria-label="Kopier adresse"
								>
									<IoCopyOutline className="h-3.5 w-3.5" />
								</button>

								<span className="opacity-50 hidden sm:inline">•</span>
								<span className="hidden sm:inline">
									{loading ? "Henter…" : `${shown.length} tokens`}
								</span>
							</div>
						</div>
					</div>

					{/* Right: Total verdi + collapse toggle */}
					<div className="flex w-full sm:w-auto flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
						<div className="flex items-baseline justify-between sm:block">
							<div className="text-[11px] text-slate-500 dark:text-slate-400">
								Total verdi
							</div>
							<div className="text-base sm:text-lg font-semibold text-emerald-700 dark:text-emerald-400">
								{totalValueText}
							</div>
						</div>

						<button
							type="button"
							onClick={() => setCollapsed((v) => !v)}
							className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-white/10 w-full sm:w-auto shrink-0"
							aria-expanded={!collapsed}
							aria-controls="wallet-holdings-content"
						>
							{collapsed ? (
								<>
									<FiChevronDown className="h-4 w-4" />
									Vis tokens
								</>
							) : (
								<>
									<FiChevronUp className="h-4 w-4" />
									Skjul tokens
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
				{/* Loading state */}
				{loading && (
					<div className="animate-pulse space-y-2">
						<div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
						<div className="h-4 w-72 rounded bg-slate-200 dark:bg-slate-700" />
						<div className="h-4 w-56 rounded bg-slate-200 dark:bg-slate-700" />
					</div>
				)}

				{/* Error state */}
				{!loading && err && (
					<div className="text-sm text-red-600 dark:text-red-400">
						Klarte ikke å hente beholdning: {err}
					</div>
				)}

				{/* Empty state */}
				{!loading && !err && shown.length === 0 && (
					<div className="text-sm text-slate-600 dark:text-slate-300">
						Ingen tokens funnet for denne lommeboken.
					</div>
				)}

				{/* Table */}
				{!loading && !err && shown.length > 0 && (
					<div className="overflow-x-auto">
						{/* Inner wrapper controls vertical scrolling once > 10 rows */}
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
										<th className="py-2 pr-4 font-medium">Token</th>
										<th className="py-2 pr-4 font-medium">Mengde</th>
										<th className="py-2 pr-4 font-medium hidden sm:table-cell">
											Mint
										</th>
										<th className="py-2 pr-0 font-medium text-right">Verdi</th>
									</tr>
								</thead>
								<tbody>
									{shown.map((h, idx) => {
										const amount =
											typeof h.amountText === "string" &&
											h.amountText.length > 0
												? h.amountText
												: typeof h.amount === "number"
												? fmt.format(h.amount)
												: "0";

										const v = toNum(h.valueUSD);
										const valueKnown = Number.isFinite(v) && v > 0;
										const value = valueKnown ? fmtUSD.format(v) : "—";

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
													{amount}
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
															title="Kopier mint-adresse"
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
														{value}
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

	// SOL special badge
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
				// Remove `unoptimized` if you add remotePatterns in next.config.js
				unoptimized
				onError={() => setErrored(true)}
			/>
		);
	}

	// Fallback: letter avatar
	const letter = (symbol || "?").slice(0, 1).toUpperCase();
	return (
		<span className="inline-flex h-6 w-6 ml-1 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
			{letter}
		</span>
	);
}
