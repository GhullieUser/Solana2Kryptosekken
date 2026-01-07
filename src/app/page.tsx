"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { z } from "zod";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import {
	FiCalendar,
	FiLoader,
	FiEye,
	//FiExternalLink,
	FiClock,
	FiTrash2,
	FiSliders,
	FiChevronDown,
	FiX,
	FiTag,
	FiInfo,
	FiActivity,
	FiSun,
	FiMoon
} from "react-icons/fi";
import { IoWalletOutline, IoOpenOutline } from "react-icons/io5";
import { SiSolana } from "react-icons/si";

import Image from "next/image";
import Link from "next/link";

// ⬇️ Preview card
import Preview from "@/app/components/preview";
import WalletHoldings from "@/app/components/WalletHoldings";
import KryptosekkenImportCard from "@/app/components/KryptosekkenImportCard";
import StyledSelect from "@/app/components/styled-select";

/* ================= Client-only guard ================= */
function ClientOnly({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return <div suppressHydrationWarning />;
	return <>{children}</>;
}

/* ================= Theme toggle (pill button) ================= */
function useTheme() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		// Initialize from localStorage or system
		const saved =
			typeof window !== "undefined" ? localStorage.getItem("theme") : null;
		const systemPrefersDark =
			typeof window !== "undefined" &&
			window.matchMedia &&
			window.matchMedia("(prefers-color-scheme: dark)").matches;

		const dark = saved ? saved === "dark" : systemPrefersDark;
		document.documentElement.classList.toggle("dark", dark);
		setIsDark(dark);
	}, []);

	const toggle = () => {
		setIsDark((prev) => {
			const next = !prev;
			document.documentElement.classList.toggle("dark", next);
			try {
				localStorage.setItem("theme", next ? "dark" : "light");
			} catch {}
			return next;
		});
	};

	return { isDark, toggle };
}

function ThemePill() {
	const { isDark, toggle } = useTheme();
	return (
		<button
			type="button"
			onClick={toggle}
			className="self-end sm:self-auto inline-flex h-[24px] items-center gap-2 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition "
			title="Bytt lys/mørk"
			aria-label="Bytt lys/mørk"
		>
			{isDark ? (
				<>
					<FiMoon className="h-4 w-4" />
					Mørk
				</>
			) : (
				<>
					<FiSun className="h-4 w-4" />
					Lys
				</>
			)}
		</button>
	);
}

/* ================= Types ================= */
export type KSType =
	| "Handel"
	| "Erverv"
	| "Inntekt"
	| "Tap"
	| "Forbruk"
	| "Renteinntekt"
	| "Overføring-Inn"
	| "Overføring-Ut"
	| "Gave-Inn"
	| "Gave-Ut"
	| "Tap-uten-fradrag"
	| "Forvaltningskostnad";

export type KSRow = {
	Tidspunkt: string;
	Type: KSType;
	Inn: string;
	"Inn-Valuta": string;
	Ut: string;
	"Ut-Valuta": string;
	Gebyr: string;
	"Gebyr-Valuta": string;
	Marked: string;
	Notat: string;
};
export type KSPreviewRow = KSRow & {
	/** derived */
	signature?: string;
	signer?: string;
	sender?: string;
	programId?: string;
	programName?: string;
	rowId?: string;
	/** hidden; used for “Alle med samme mottaker-adresse” */
	recipient?: string;
};

export type OverrideMaps = {
	symbols: Record<string, string>;
	markets: Record<string, string>;
};

const PLACEHOLDER_RE = /^TOKEN-[0-9A-Z]{6}$/i;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isPlaceholderSymbol(s?: string) {
	return !!s && (PLACEHOLDER_RE.test(s) || s.toUpperCase() === "UNKNOWN");
}
const KNOWN_MARKETS = new Set([
	"solana",
	"spl",
	"solana dex",
	"airdrop",
	"stake",
	"aggregert",
	"pump.fun"
]);
function isUnknownMarket(m?: string) {
	if (!m) return true;
	const lc = m.trim().toLowerCase();
	if (KNOWN_MARKETS.has(lc)) return false;
	if (BASE58_RE.test(m)) return true;
	if (m.toUpperCase() === "UNKNOWN") return true;
	return false;
}

type DustMode = "off" | "remove" | "aggregate-signer" | "aggregate-period";
type DustInterval = "day" | "week" | "month" | "year";

/* Validation for payload sent to API */
const schema = z.object({
	address: z.string().min(32, "Ugyldig adresse"),
	fromISO: z.string().optional(),
	toISO: z.string().optional(),
	walletName: z.string().optional(),
	includeNFT: z.boolean().optional(),
	dustMode: z
		.enum(["off", "remove", "aggregate-signer", "aggregate-period"])
		.optional(),
	dustThreshold: z.union([z.string(), z.number()]).optional(),
	dustInterval: z.enum(["day", "week", "month", "year"]).optional(),
	useOslo: z.boolean().optional()
});
type Payload = z.infer<typeof schema>;

/* ================= Helpers ================= */
function startOfDayISO(d: Date) {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x.toISOString();
}
function endOfDayISO(d: Date) {
	const x = new Date(d);
	x.setHours(23, 59, 59, 999);
	return x.toISOString();
}
function isProbablySolanaAddress(s: string) {
	const len = s.length;
	return len >= 32 && len <= 44 && BASE58_RE.test(s);
}

/* ================= Reusable switch (controlled) ================= */
function Switch({
	checked,
	onChange,
	label
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={[
				"relative inline-flex h-5 w-10 items-center rounded-full transition-colors",
				"focus:outline-none focus:ring-2 focus:ring-indigo-400/60 dark:focus:ring-indigo-400/40",
				checked
					? "bg-indigo-600 dark:bg-indigo-500"
					: "bg-slate-300 dark:bg-slate-600"
			].join(" ")}
			title={label}
		>
			<span
				className={[
					"absolute top-[2px] h-4 w-4 rounded-full shadow transition-[left,background-color]",
					checked ? "left-[22px]" : "left-[2px]",
					"bg-white dark:bg-slate-100"
				].join(" ")}
			/>
			<span className="sr-only">{label}</span>
		</button>
	);
}

/* ================= Page ================= */
const HISTORY_KEY = "sol2ks.addressHistory";
const HISTORY_MAX = 10;
const NAMES_KEY = "sol2ks.walletNames";

export default function Home() {
	const formRef = useRef<HTMLFormElement | null>(null);
	const lastPayloadRef = useRef<Payload | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const cacheKeyRef = useRef<string | null>(null);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [ok, setOk] = useState(false);

	// Default range = last 30 days
	const [range, setRange] = useState<DateRange | undefined>();
	useEffect(() => {
		const now = new Date();
		const from = new Date(now);
		from.setDate(from.getDate() - 29);
		setRange({ from, to: now });
	}, []);

	const [rows, setRows] = useState<KSPreviewRow[] | null>(null);

	// Address + history state
	const [address, setAddress] = useState("");
	const [walletName, setWalletName] = useState("");
	const [addrHistory, setAddrHistory] = useState<string[]>([]);
	const [addrMenuOpen, setAddrMenuOpen] = useState(false);

	// Settings
	const [includeNFT, setIncludeNFT] = useState(false);
	const [useOslo, setUseOslo] = useState(false);

	// Dust controls
	const [dustMode, setDustMode] = useState<DustMode>("off");
	const [dustThreshold, setDustThreshold] = useState<string>("0.001");
	const [dustInterval, setDustInterval] = useState<DustInterval>("week");

	// Overrides
	const [overrides, setOverrides] = useState<OverrideMaps>({
		symbols: {},
		markets: {}
	});

	const previewContainerRef = useRef<HTMLDivElement | null>(null);

	const addrInputRef = useRef<HTMLInputElement | null>(null);
	const canOpenExplorer = address.trim().length > 0;
	const explorerHref = canOpenExplorer
		? `https://solscan.io/address/${address.trim()}`
		: "#";
	const hasAddressInput = address.trim().length > 0;

	// Apply overrides only for the “N transactions found” chip
	const effectiveRows: KSPreviewRow[] = useMemo(() => {
		if (!rows) return [];
		const mapSym = overrides.symbols;
		const mapMkt = overrides.markets;
		return rows.map((r) => ({
			...r,
			"Inn-Valuta": mapSym[r["Inn-Valuta"]] ?? r["Inn-Valuta"],
			"Ut-Valuta": mapSym[r["Ut-Valuta"]] ?? r["Ut-Valuta"],
			Marked: mapMkt[r.Marked] ?? r.Marked
		}));
	}, [rows, overrides]);

	// Live log
	const [logOpen, setLogOpen] = useState(false);
	const [logLines, setLogLines] = useState<string[]>([]);
	const logRef = useRef<HTMLDivElement | null>(null);

	const pushLog = useCallback((s: string) => {
		setLogLines((prev) => [
			...prev,
			`${new Date().toLocaleTimeString()}  ${s}`
		]);
	}, []);

	const clearLog = useCallback(() => setLogLines([]), []);

	useEffect(() => {
		if (logRef.current) {
			logRef.current.scrollTop = logRef.current.scrollHeight;
		}
	}, [logLines]);

	useEffect(() => {
		const onStart = (e: any) => {
			pushLog(
				e?.detail?.address
					? `Henter beholdning for ${e.detail.address} …`
					: "Henter beholdning …"
			);
		};
		const onSuccess = (e: any) => {
			const n = e?.detail?.count ?? 0;
			pushLog(`Beholdning oppdatert: ${n} aktiva.`);
		};
		const onError = (e: any) => {
			const msg = e?.detail?.error || "Ukjent feil";
			pushLog(`❌ Beholdning-feil: ${msg}`);
		};

		window.addEventListener("sol2ks:holdings:start", onStart as EventListener);
		window.addEventListener(
			"sol2ks:holdings:success",
			onSuccess as EventListener
		);
		window.addEventListener("sol2ks:holdings:error", onError as EventListener);

		return () => {
			window.removeEventListener(
				"sol2ks:holdings:start",
				onStart as EventListener
			);
			window.removeEventListener(
				"sol2ks:holdings:success",
				onSuccess as EventListener
			);
			window.removeEventListener(
				"sol2ks:holdings:error",
				onError as EventListener
			);
		};
	}, [pushLog]);

	// Calendar popover
	const [calOpen, setCalOpen] = useState(false);
	const [calMonth, setCalMonth] = useState<Date | undefined>(undefined);
	const today = new Date();

	// Load history + names on mount
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const raw = localStorage.getItem(HISTORY_KEY);
			if (raw) {
				const list = JSON.parse(raw) as string[];
				if (Array.isArray(list)) setAddrHistory(list);
			}
		} catch {}
	}, []);
	function readNamesMap(): Record<string, string> {
		try {
			const raw = localStorage.getItem(NAMES_KEY);
			if (!raw) return {};
			const obj = JSON.parse(raw);
			return obj && typeof obj === "object"
				? (obj as Record<string, string>)
				: {};
		} catch {
			return {};
		}
	}
	function writeNamesMap(next: Record<string, string>) {
		try {
			localStorage.setItem(NAMES_KEY, JSON.stringify(next));
		} catch {}
	}
	function saveHistory(list: string[]) {
		setAddrHistory(list);
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
		} catch {}
	}
	function rememberAddress(addr: string) {
		const a = addr.trim();
		if (!isProbablySolanaAddress(a)) return; // avoid garbage
		const next = [a, ...addrHistory.filter((x) => x !== a)].slice(
			0,
			HISTORY_MAX
		);
		saveHistory(next);
		// also remember name (if provided)
		if (walletName.trim()) {
			const names = readNamesMap();
			names[a] = walletName.trim();
			writeNamesMap(names);
		}
	}
	function pickAddress(addr: string) {
		setAddress(addr);
		const names = readNamesMap();
		setWalletName(names[addr] ?? "");
		setAddrMenuOpen(false);
	}
	function removeAddress(addr: string) {
		saveHistory(addrHistory.filter((x) => x !== addr));
	}
	function clearHistory() {
		saveHistory([]);
	}

	const filteredHistory = useMemo(() => {
		const q = address.trim().toLowerCase();
		if (!q) return addrHistory;
		const starts = addrHistory.filter((a) => a.toLowerCase().startsWith(q));
		const contains = addrHistory.filter(
			(a) => !starts.includes(a) && a.toLowerCase().includes(q)
		);
		const rest = addrHistory.filter(
			(a) => !starts.includes(a) && !contains.includes(a)
		);
		return [...starts, ...contains, ...rest];
	}, [addrHistory, address]);

	// Presets
	function presetDays(days: number) {
		const now = new Date();
		const from = new Date(now);
		from.setDate(from.getDate() - (days - 1));
		setRange({ from, to: now });
		setCalOpen(false);
	}
	function ytd() {
		const now = new Date();
		const from = new Date(now.getFullYear(), 0, 1);
		setRange({ from, to: now });
		setCalOpen(false);
	}
	function lastYearWhole() {
		const now = new Date();
		const year = now.getFullYear() - 1;
		const from = new Date(year, 0, 1);
		const to = new Date(year, 11, 31);
		setRange({ from, to });
		setCalOpen(false);
	}
	function clearDates() {
		setRange(undefined);
		setCalOpen(false);
	}

	function buildPayload(): Payload {
		return {
			address: address.trim(),
			walletName: walletName.trim() || undefined,
			fromISO: range?.from ? startOfDayISO(range.from) : undefined,
			toISO: range?.to ? endOfDayISO(range.to) : undefined,
			includeNFT,
			dustMode,
			dustThreshold,
			dustInterval,
			useOslo
		};
	}
	function q(s?: string) {
		return `"${String(s ?? "").replace(/"/g, '\\"')}"`;
	}

	/* ========== Streamed preview with progress + cancel ========== */
	async function onCheckWallet(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setOk(false);
		setRows(null);
		cacheKeyRef.current = null;

		clearLog();

		const payload = buildPayload();
		const parsed = schema.safeParse(payload);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Ugyldig input");
			pushLog("❌ Ugyldig input");
			setLogOpen(true);
			return;
		}

		pushLog(`Ny sjekk ${q(payload.walletName)} ${q(payload.address)}`);
		setLogOpen(true);

		rememberAddress(parsed.data.address);

		const ctrl = new AbortController();
		abortRef.current = ctrl;

		setLoading(true);
		try {
			pushLog(
				"Starter sjekk… dette kan ta noen minutter for store lommebøker."
			);
			const res = await fetch("/api/kryptosekken?format=ndjson", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(parsed.data),
				signal: ctrl.signal
			});

			if (!res.ok || !res.body) {
				const j = await res.json().catch(() => ({ error: "Feil" }));
				pushLog(`❌ API-feil: ${j.error || res.statusText}`);
				throw new Error(j.error || res.statusText);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nlIndex: number;
				// eslint-disable-next-line no-cond-assign
				while ((nlIndex = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, nlIndex).trim();
					buf = buf.slice(nlIndex + 1);
					if (!line) continue;
					try {
						const evt = JSON.parse(line);
						if (evt.type === "log") {
							pushLog(evt.message);
						} else if (evt.type === "page") {
							const prefix =
								evt.kind === "main"
									? "Hovedadresse"
									: `ATA ${evt.idx + 1}/${evt.totalATAs}`;
							pushLog(`${prefix}: side ${evt.page}`);
						} else if (evt.type === "addrDone") {
							const prefix =
								evt.kind === "main"
									? "Hovedadresse"
									: `ATA ${evt.idx + 1}/${evt.totalATAs}`;
							pushLog(
								`Ferdig — ${prefix}: ${evt.pages} sider (${evt.addressShort})`
							);
						} else if (evt.type === "done") {
							const j = evt.data as {
								rowsPreview: KSPreviewRow[];
								count: number;
								rawCount: number;
								cacheKey: string;
							};
							cacheKeyRef.current = j.cacheKey;
							setRows(j.rowsPreview || []);
							lastPayloadRef.current = parsed.data;
							setOk(true);
							if (dustMode !== "off" && j.rawCount !== j.count) {
								pushLog(
									`Transaksjoner funnet (rå): ${j.rawCount}. Etter støvbehandling: ${j.count}.`
								);
							} else {
								pushLog(`Transaksjoner funnet: ${j.count}.`);
							}
							pushLog(`✅ ${j.count} transaksjoner loggført.`);
						}
					} catch {
						// ignore bad chunk
					}
				}
			}
		} catch (err: any) {
			if (err?.name === "AbortError") {
				pushLog("⏹️ Avbrutt av bruker.");
			} else {
				const message =
					err instanceof Error
						? err.message
						: typeof err === "string"
						? err
						: "Noe gikk galt";
				setError(message);
			}
		} finally {
			setLoading(false);
			abortRef.current = null;
		}
	}

	function onCancel() {
		if (abortRef.current) {
			abortRef.current.abort();
		}
	}

	/* ========== Download CSV ========== */
	async function downloadCSV(currentOverrides: OverrideMaps) {
		if (!lastPayloadRef.current) return;
		setError(null);
		try {
			// Build a map of rowId -> full row fields (server will selectively merge)
			const clientEdits: Record<string, Partial<KSRow>> = {};
			for (const r of rows ?? []) {
				if (!r?.rowId) continue;
				clientEdits[r.rowId] = {
					Tidspunkt: r.Tidspunkt,
					Type: r.Type,
					Inn: r.Inn,
					"Inn-Valuta": r["Inn-Valuta"],
					Ut: r.Ut,
					"Ut-Valuta": r["Ut-Valuta"],
					Gebyr: r.Gebyr,
					"Gebyr-Valuta": r["Gebyr-Valuta"],
					Marked: r.Marked,
					Notat: r.Notat
				};
			}

			const url = "/api/kryptosekken?useCache=1";
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "text/csv" },
				body: JSON.stringify({
					...lastPayloadRef.current,
					overrides: currentOverrides,
					clientEdits // NEW
				})
			});

			if (!res.ok) {
				// If server replies 412 it means no cached preview exists.
				if (res.status === 412) {
					const j = await res.json().catch(() => ({} as any));
					const cacheKey = j?.cacheKey;
					if (cacheKey) {
						// Generate preview first, then retry CSV fetch using the returned cacheKey
						pushLog("ℹ️ Ingen bufret forhåndsvisning — lager forhåndsvisning nå...");
						const previewRes = await fetch("/api/kryptosekken", {
							method: "POST",
							headers: { "Content-Type": "application/json", Accept: "application/json" },
							body: JSON.stringify({ ...lastPayloadRef.current, overrides: currentOverrides, clientEdits })
						});
						if (!previewRes.ok) {
							const pj = await previewRes.json().catch(() => ({ error: previewRes.statusText }));
							throw new Error(pj.error || previewRes.statusText);
						}
						const pj = await previewRes.json();
						const newKey = pj.cacheKey || cacheKey;
						// Retry CSV download with cacheKey param
						const csvUrl = `/api/kryptosekken?useCache=1&cacheKey=${encodeURIComponent(newKey)}`;
						const csvRes = await fetch(csvUrl, {
							method: "POST",
							headers: { "Content-Type": "application/json", Accept: "text/csv" },
							body: JSON.stringify({ ...lastPayloadRef.current, overrides: currentOverrides, clientEdits })
						});
						if (!csvRes.ok) {
							const cj = await csvRes.json().catch(() => ({ error: csvRes.statusText }));
							throw new Error(cj.error || csvRes.statusText);
						}
						const blob2 = await csvRes.blob();
						const a2 = document.createElement("a");
						const dlUrl2 = URL.createObjectURL(blob2);
						a2.href = dlUrl2;
						a2.download = `sol2ks_${lastPayloadRef.current.address}.csv`;
						document.body.appendChild(a2);
						a2.click();
						a2.remove();
						URL.revokeObjectURL(dlUrl2);
						pushLog("✅ CSV klar (med redigeringer).");
						return;
					}
				}
				const j = await res.json().catch(() => ({ error: "Feil" }));
				throw new Error(j.error || res.statusText);
			}
			const blob = await res.blob();
			const a = document.createElement("a");
			const dlUrl = URL.createObjectURL(blob);
			a.href = dlUrl;
			a.download = `sol2ks_${lastPayloadRef.current.address}.csv`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(dlUrl);
			pushLog("✅ CSV klar (med redigeringer).");
		} catch (err: unknown) {
			const message =
				err instanceof Error
					? err.message
					: typeof err === "string"
					? err
					: "Noe gikk galt";
			setError(message);
		}
	}

	// Reset
	function onReset() {
		formRef.current?.reset();
		setRows(null);
		setError(null);
		setOk(false);
		setAddress("");
		setWalletName("");
		setDustMode("off");
		setDustThreshold("0.001");
		setDustInterval("day");
		setIncludeNFT(false);
		setUseOslo(false);
		clearLog();
		setLogOpen(false);
		setOverrides({ symbols: {}, markets: {} });

		// reset to default 30 days
		const now = new Date();
		const from = new Date(now);
		from.setDate(from.getDate() - 29);
		setRange({ from, to: now });
	}

	const nice = (d?: Date) => (d ? d.toLocaleDateString("no-NO") : "—");

	async function clearCacheNow() {
		try {
			const payload = lastPayloadRef.current || buildPayload();
			if (!payload.address?.trim()) {
				pushLog("⚠️ Ingen adresse valgt – kan ikke tømme cache.");
				return;
			}
			const res = await fetch("/api/kryptosekken?clearCache=1", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const j = await res.json().catch(() => ({ error: res.statusText }));
				throw new Error(j.error || res.statusText);
			}
			const j = await res.json();
			if (j.cleared) {
				pushLog("🧹 Mellomlager tømt for denne forespørselen.");
			} else {
				pushLog("ℹ️ Fant ingen cache å tømme for disse parametrene.");
			}
			cacheKeyRef.current = null;
			setRows(null);
			setOk(false);
		} catch (err: any) {
			pushLog(`❌ Klarte ikke å tømme cache: ${err?.message || err}`);
		}
	}

	const hasRows = rows !== null;

	// Shared card class (proper light/dark)
	const cardCn =
		"rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/15 ring-1 ring-slate-300/80 dark:ring-slate-800/60";

	return (
		<main className="min-h-screen">
			<div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
				{/* ====== Header with badge + title/subtitle (left) and logo (right) ====== */}
				<header className="mb-8 sm:mb-12">
					{/* Row: badge + theme pill */}
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="inline-flex items-center gap-3 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 py-1 text-xs font-medium text-slate-800 dark:text-slate-200 shadow-sm dark:shadow-black/25">
							<SiSolana className="h-4 w-4" aria-hidden />
							Solana → Kryptosekken • CSV Generator
						</div>
						<div className="self-end sm:self-auto">
							<ThemePill />
						</div>
					</div>

					{/* Main: headline + logo (headline first on mobile) */}
					<div className="mt-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-4 justify-items-center sm:justify-items-start">
						{/* Headline + sub */}
						<div className="order-1 sm:order-none min-w-0 text-center sm:text-left">
							<h1 className="text-balance text-3xl sm:text-4xl font-semibold tracking-tight">
								<span className="bg-gradient-to-r from-indigo-600 to-emerald-600 bg-clip-text text-transparent">
									Solana-transaksjoner gjort enklere
								</span>
							</h1>
							<p className="mt-2 text-balance leading-relaxed max-w-[65ch] text-sm sm:text-base text-slate-700 dark:text-slate-300">
								Lim inn en Solana-adresse, velg tidsrom, <b>sjekk lommeboken</b>{" "}
								og last ned en <b>CSV-fil</b> klar for import i Kryptosekken.
							</p>
						</div>

						{/* Logo */}
						<div className="order-0 sm:order-none self-center">
							<Image
								src="/Sol2KS_logo.svg"
								alt="Sol2KS"
								width={160}
								height={160}
								className="h-12 w-auto sm:h-24"
								priority
							/>
						</div>
					</div>
				</header>

				{/* ========= Card 1: Inputs / Settings / Log / Cache ========= */}
				<div className={cardCn}>
					<ClientOnly>
						<form
							ref={formRef}
							onSubmit={onCheckWallet}
							className="p-4 sm:p-10"
						>
							{/* Address + Name with history */}
							<label className="block mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
								Lommebok
							</label>
							<div className="grid gap-3 sm:grid-cols-[1fr_280px]">
								{/* Address */}
								<div className="relative">
									<IoWalletOutline className="pointer-events-none absolute left-3 inset-y-0 mt-2 h-5 w-5 text-slate-400" />
									<input
										ref={addrInputRef}
										name="address"
										required
										autoComplete="off"
										placeholder="F.eks. ESURTD2D…"
										value={address}
										onChange={(e) => {
											setAddress(e.target.value);
											setAddrMenuOpen(true);
										}}
										onFocus={() => setAddrMenuOpen(true)}
										onBlur={() => setTimeout(() => setAddrMenuOpen(false), 120)}
										className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-11 pr-24 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
									/>

									{/* right-side actions: clear, history */}
									<div className="absolute inset-y-0 right-3 flex items-center sm:top-[-19px] gap-1">
										{/* quick clear */}
										{hasAddressInput && (
											<button
												type="button"
												aria-label="Tøm felt"
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => {
													setAddress("");
													setAddrMenuOpen(false);
													setTimeout(() => addrInputRef.current?.focus(), 0);
												}}
												className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 h-6 w-6"
												title="Tøm felt"
											>
												<FiX className="h-4 w-4" />
											</button>
										)}
										{/* history */}
										<button
											type="button"
											aria-label="Adressehistorikk"
											onMouseDown={(e) => e.preventDefault()}
											onClick={() => setAddrMenuOpen((v) => !v)}
											className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 h-6 w-6"
											title="Adressehistorikk"
										>
											<FiClock className="h-4 w-4" />
										</button>
									</div>

									{/* Dropdown history */}
									{addrMenuOpen && (addrHistory.length > 0 || address) && (
										<div className="absolute z-30 mt-2 w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
											{filteredHistory.length > 0 ? (
												<ul className="max-h-64 overflow-auto text-sm">
													{filteredHistory.map((a) => (
														<li
															key={a}
															className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5"
														>
															<button
																type="button"
																onMouseDown={(e) => e.preventDefault()}
																onClick={() => pickAddress(a)}
																className="truncate text-left text-slate-700 dark:text-slate-200"
																title={a}
															>
																{a}
																{/* tiny name hint */}
																{(() => {
																	const nm = readNamesMap()[a];
																	return nm ? (
																		<span className="ml-2 rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-300">
																			{nm}
																		</span>
																	) : null;
																})()}
															</button>
															<button
																type="button"
																aria-label="Fjern fra historikk"
																onMouseDown={(e) => e.preventDefault()}
																onClick={() => removeAddress(a)}
																className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-600"
															>
																<FiTrash2 className="h-4 w-4" />
															</button>
														</li>
													))}
												</ul>
											) : (
												<div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
													Ingen treff i historikk
												</div>
											)}
											<div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
												<span>{addrHistory.length} lagret</span>
												<button
													type="button"
													onMouseDown={(e) => e.preventDefault()}
													onClick={clearHistory}
													className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-white dark:hover:bg-white/10"
												>
													<FiTrash2 className="h-3 w-3" />
													Tøm historikk
												</button>
											</div>
										</div>
									)}
								</div>

								{/* Wallet name */}
								<div className="relative">
									<FiTag className="pointer-events-none absolute left-3 inset-y-0 mt-2.5 h-5 w-5 text-slate-400" />
									<div className="flex items-center gap-2">
										<input
											name="walletName"
											autoComplete="off"
											placeholder="Navn (valgfritt)"
											value={walletName}
											onChange={(e) => setWalletName(e.target.value)}
											className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-11 pr-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
										/>

										{/* Solscan button */}
										<Link
											href={explorerHref}
											target="_blank"
											rel="noopener noreferrer"
											aria-disabled={!canOpenExplorer}
											tabIndex={canOpenExplorer ? 0 : -1}
											onClick={(e) => {
												if (!canOpenExplorer) e.preventDefault();
											}}
											className={`inline-flex items-center gap-2 rounded-xl border  text-sm shadow-sm dark:shadow-black/25 aspect-square p-2 h-[37px] w-[37px] justify-center
                        ${
													canOpenExplorer
														? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-white/10"
														: "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/5 text-slate-400 cursor-not-allowed"
												}`}
											title={
												canOpenExplorer
													? "Åpne i Solscan"
													: "Skriv inn en adresse først"
											}
										>
											<IoOpenOutline className="h-[17px] w-[17px]" />
										</Link>
									</div>

									<p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
										Vises i <b>Notat</b> (eks. <b>MIN WALLET</b>).
									</p>
								</div>
							</div>

							{/* Timespan (dropdown calendar + presets) */}
							<div className="mt-6">
								<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
									<label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
										Tidsrom
									</label>
									<div className="text-[11px] text-slate-500 dark:text-slate-400">
										Avgrenser transaksjoner i perioden. Standard:{" "}
										<b>siste 30 dager</b>.
									</div>
								</div>

								<div className="mt-2 flex flex-wrap items-center gap-3">
									{/* Trigger */}
									<div className="relative w-full sm:w-auto">
										<button
											type="button"
											onClick={() => {
												setCalOpen((v) => !v);
												setCalMonth(range?.to ?? new Date());
											}}
											aria-expanded={calOpen}
											className="inline-flex w-full sm:w-auto items-center justify-between sm:justify-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											<span className="inline-flex items-center gap-2">
												<FiCalendar className="h-4 w-4 text-slate-500 dark:text-slate-400" />
												{formatRangeLabel(range)}
											</span>
											<FiChevronDown className="h-4 w-4 text-slate-400" />
										</button>

										{/* Popover dropdown (same on mobile & desktop) */}
										{calOpen && (
											<div className="absolute z-30 mt-2 w-full sm:w-[360px] max-w-[92vw] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-xl">
												{/* Legend */}
												<div className="flex items-center justify-between px-1 pb-2">
													<button
														type="button"
														className="text-[11px] text-slate-600 dark:text-slate-300"
														onClick={() =>
															range?.from && setCalMonth(range.from)
														}
														title="Gå til Fra-måned"
													>
														<span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-400/10 px-2 py-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-400/20">
															<span className="h-2 w-2 rounded-full bg-indigo-600" />
															Fra: <b>{nice(range?.from)}</b>
														</span>
													</button>
													<button
														type="button"
														className="text-[11px] text-slate-600 dark:text-slate-300"
														onClick={() => range?.to && setCalMonth(range.to)}
														title="Gå til Til-måned"
													>
														<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-400/10 px-2 py-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-400/20">
															<span className="h-2 w-2 rounded-full bg-emerald-600" />
															Til: <b>{nice(range?.to)}</b>
														</span>
													</button>
												</div>

												<DayPicker
													mode="range"
													selected={range}
													month={calMonth}
													onMonthChange={setCalMonth}
													onSelect={(r) => {
														const now = new Date();
														const bounded =
															r?.to && r.to > now
																? { ...r, to: now }
																: r || undefined;
														setRange(bounded);
														if (bounded?.from && bounded?.to) setCalOpen(false);
													}}
													numberOfMonths={1}
													showOutsideDays
													toDate={today}
													className="rdp"
													modifiersClassNames={{
														range_start:
															"bg-indigo-600 text-white rounded-l-full",
														range_middle:
															"bg-indigo-100 text-indigo-900 dark:bg-indigo-400/20 dark:text-indigo-200",
														range_end:
															"bg-emerald-600 text-white rounded-r-full",
														selected: "font-semibold",
														today: "ring-1 ring-indigo-500"
													}}
												/>

												<div className="mt-2 flex justify-end gap-2">
													<button
														type="button"
														onClick={() => setCalOpen(false)}
														className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
													>
														Lukk
													</button>
												</div>
											</div>
										)}
									</div>

									{/* Presets (wrap on small screens) */}
									<div className="flex flex-wrap gap-2 text-xs">
										<button
											type="button"
											onClick={() => presetDays(7)}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											Siste 7 dager
										</button>
										<button
											type="button"
											onClick={() => presetDays(30)}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											Siste 30 dager
										</button>
										<button
											type="button"
											onClick={ytd}
											title="Hittil i år — Fra 1. januar til i dag"
											aria-label="Hittil i år (Året så langt)"
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											Hittil i år
										</button>
										<button
											type="button"
											onClick={lastYearWhole}
											title="Hele fjoråret — Fra 1. januar til 31. desember i fjor"
											aria-label="Hele fjoråret"
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											Hele fjoråret
										</button>
										<button
											type="button"
											onClick={clearDates}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											Nullstill
										</button>
									</div>
								</div>

								{/* Tidssone toggle */}
								<div className="mt-3 inline-flex flex-wrap items-center gap-3">
									<Switch
										checked={useOslo}
										onChange={setUseOslo}
										label="Norsk tid (Europe/Oslo)"
									/>
									<span className="text-sm font-medium text-slate-800 dark:text-slate-200">
										Norsk tid (Europe/Oslo)
									</span>
									<span className="text-[11px] text-slate-500 dark:text-slate-400">
										CSV tidsstempler skrives i{" "}
										{useOslo ? "Norsk tid (UTC+01:00 Europe/Oslo)" : "UTC"}.
									</span>
								</div>
							</div>

							{/* NFT section */}
							<div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-white/5 p-4">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div className="inline-flex items-center gap-3">
										<Switch
											checked={includeNFT}
											onChange={setIncludeNFT}
											label="Inkluder NFT-overføringer"
										/>
										<span className="text-sm font-medium text-slate-800 dark:text-slate-200">
											Inkluder NFT-overføringer
										</span>
									</div>
									<div className="text-[11px] text-slate-500 dark:text-slate-400">
										Tar med bevegelser av NFT-er. (Ingen prising, kun
										overføringer.)
									</div>
								</div>
							</div>

							{/* Dust section */}
							<div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
								<div className="mb-3 flex items-center justify-between">
									<div className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
										<FiSliders className="h-4 w-4" />
										Støvtransaksjoner
									</div>

									<div className="relative group">
										<button
											type="button"
											aria-label="Hvorfor får jeg så mye støv i SOL?"
											className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 focus:outline-none"
										>
											<FiInfo className="h-4 w-4" />
										</button>
										<div
											role="tooltip"
											className="pointer-events-none absolute right-0 top-7 z-30 hidden w-[min(92vw,22rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 shadow-xl group-hover:block group-focus-within:block"
										>
											<p className="mb-1 font-medium">
												Hvorfor så mye “støv” i SOL?
											</p>
											<ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
												<li>
													<b>Spam / dusting:</b> små innbetalinger for å lokke
													klikk eller spore lommebøker.
												</li>
												<li>
													<b>DEX/protokoll-refusjoner:</b> bitte små
													rest-lamports/fee-reverseringer etter swaps/tx.
												</li>
												<li>
													<b>Konto-livssyklus:</b> opprettelse/lukking og{" "}
													<i>rent-exempt</i> topp-ups kan sende/returnere små
													SOL-beløp.
												</li>
												<li>
													<b>Program-interaksjoner:</b>{" "}
													claim/reward/airdrop-skript som sender små beløp for å
													trigge varsler eller dekke minutt-gebyr.
												</li>
												<li>
													<b>NFT/WSOL-håndtering:</b> wrapping/unwrapping og
													ATA-endringer kan etterlate mikrobeløp.
												</li>
											</ul>
										</div>
									</div>
								</div>

								<div className="grid gap-3 sm:grid-cols-3">
									{/* Mode */}
									<div className="flex flex-col gap-1">
										<label className="text-xs text-slate-600 dark:text-slate-400">
											Modus
										</label>
										<StyledSelect
											value={dustMode}
											onChange={(v) => setDustMode(v)}
											buttonClassName="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
											options={[
												{ value: "off", label: "Vis alle" },
												{ value: "remove", label: "Skjul" },
												{
													value: "aggregate-signer",
													label: "Slå sammen fra samme sender"
												},
												{
													value: "aggregate-period",
													label: "Slå sammen periodisk"
												}
											] as const}
											ariaLabel="Velg støvmodus"
										/>
									</div>

									{/* Threshold */}
									{dustMode !== "off" && (
										<div className="flex flex-col gap-1">
											<label className="text-xs text-slate-600 dark:text-slate-400">
												Grense (beløp)
											</label>
											<input
												type="number"
												step="0.001"
												inputMode="decimal"
												value={dustThreshold}
												onChange={(e) => setDustThreshold(e.target.value)}
												className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
												placeholder="0.001"
											/>
										</div>
									)}

									{/* Interval — when aggregating */}
									{(dustMode === "aggregate-period" ||
										dustMode === "aggregate-signer") && (
										<div className="flex flex-col gap-1">
											<label className="text-xs text-slate-600 dark:text-slate-400">
												Periode
											</label>
											<StyledSelect
												value={dustInterval}
												onChange={(v) => setDustInterval(v)}
												buttonClassName="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
												options={[
													{ value: "day", label: "Dag" },
													{ value: "week", label: "Uke" },
													{ value: "month", label: "Måned" },
													{ value: "year", label: "År" }
												] as const}
												ariaLabel="Velg periode"
											/>
										</div>
									)}
								</div>

								{/* Info text – specific per mode */}
								{dustMode === "off" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>Vis alle:</b> Ingen støvbehandling.
									</p>
								)}
								{dustMode === "remove" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>Skjul:</b> Filtrerer vekk alle overføringer under
										grensen.{" "}
										<span className="text-amber-700">(Ikke anbefalt)</span>
									</p>
								)}
								{dustMode === "aggregate-signer" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>Slå sammen fra samme sender:</b> Slår sammen små{" "}
										<code>Overføring-Inn/Ut</code> fra hver{" "}
										<i>signer-adresse</i> til én linje <b>per valgt periode</b>.
										Notatet viser hvem som sendte.
									</p>
								)}
								{dustMode === "aggregate-period" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>Slå sammen periodisk:</b> Slår sammen små{" "}
										<code>Overføring-Inn/Ut</code> i én linje per valgt periode
										(uavhengig av sender).
									</p>
								)}
							</div>

							{/* Actions */}
							<div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
								<button
									type="submit"
									disabled={loading}
									className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg hover:from-indigo-700 hover:to-emerald-700 focus:outline-none focus:ring-4 focus:ring-indigo-200/60 dark:focus:ring-indigo-900/40 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto"
								>
									{loading ? (
										<FiLoader className="h-4 w-4 animate-spin" />
									) : (
										<FiEye className="h-4 w-4" />
									)}
									Sjekk lommebok
								</button>
								{loading && (
									<button
										type="button"
										onClick={onCancel}
										className="inline-flex  items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm dark:shadow-black/25 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300 active:scale-[0.99] w-full sm:w-auto"
									>
										<FiX className="h-4 w-4" />
										Avbryt
									</button>
								)}
								<button
									type="button"
									onClick={onReset}
									className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10 active:scale-[0.99] w-full sm:w-auto"
								>
									Nullstill
								</button>

								{error && (
									<span
										role="status"
										aria-live="polite"
										className="sm:ml-2 text-sm text-red-600"
									>
										{error}
									</span>
								)}
								{!error && effectiveRows && effectiveRows.length > 0 && (
									<span className="sm:ml-2 text-sm text-emerald-700 dark:text-emerald-400">
										{effectiveRows.length} transaksjoner funnet ✅
									</span>
								)}

								{/* Live log toggle */}
								<div className="sm:ml-auto">
									<button
										type="button"
										onClick={() => setLogOpen((v) => !v)}
										className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10 w-full sm:w-auto justify-center"
										title="Vis/skjul logg"
									>
										<FiActivity className="h-4 w-4" />
										{logOpen ? "Skjul logg" : "Vis logg"}
									</button>
								</div>
							</div>

							{/* Live log panel */}
							{logOpen && (
								<div
									ref={logRef}
									className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-white/5 p-3 text-xs text-slate-700 dark:text-slate-200 max-h-40 overflow-auto"
								>
									{logLines.length === 0 ? (
										<div className="text-slate-500 dark:text-slate-400">
											Ingen hendelser ennå.
										</div>
									) : (
										<ul className="space-y-1 font-mono">
											{logLines.map((ln, i) => (
												<li key={i}>{ln}</li>
											))}
										</ul>
									)}
								</div>
							)}

							{/* Cache banner */}
							{cacheKeyRef.current && !loading && (
								<div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
									<span>
										Treff i cache for denne adressen/perioden. Du kan tømme
										cache hvis du vil foreta et nytt sjekk.
									</span>
									<button
										type="button"
										onClick={clearCacheNow}
										className="inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white/60 dark:bg-white/10 px-2 py-1 hover:bg-white dark:hover:bg-white/15 whitespace-nowrap w-full sm:w-auto justify-center"
										title="Tøm mellomlager for denne forespørselen"
									>
										<FiTrash2 className="h-4 w-4" />
										Tøm cache
									</button>
								</div>
							)}
						</form>
					</ClientOnly>
				</div>

				{/* ========= Card: Current holdings (now always shows even if empty/error) ========= */}
				{address?.trim() && (
					<div className="mt-6">
						<WalletHoldings address={address} includeNFT={false} enabled={ok} />
					</div>
				)}

				{/* ========= Card 2: Preview ========= */}
				{hasRows && (
					<>
						<div className="mt-6" ref={previewContainerRef}>
							<Preview
								rows={rows}
								setRows={setRows}
								overrides={overrides}
								setOverrides={setOverrides}
								onDownloadCSV={downloadCSV}
							/>
						</div>

						{/* ========= Kryptosekken import help (separate card) ========= */}
						<div className="mt-6">
							<KryptosekkenImportCard cardClassName={cardCn} />
						</div>
					</>
				)}

				{/* Footer */}
				<footer className="mt-6 text-xs text-slate-500 dark:text-slate-400">
					Resultatet kan inneholde feil. Kontroller i lommeboken og i
					Kryptosekken før innlevering.
				</footer>
			</div>
		</main>
	);
}

/* ========== local helpers used only by this file ========== */
function formatRangeLabel(r?: DateRange) {
	if (!r?.from && !r?.to) return "Velg datoer";
	const f = (d?: Date) => (d ? d.toLocaleDateString("no-NO") : "–");
	if (r?.from && r?.to) return `${f(r.from)} → ${f(r.to)}`;
	return `${f(r?.from)} → …`;
}
