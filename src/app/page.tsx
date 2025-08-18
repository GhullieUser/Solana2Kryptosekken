"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import {
	FiCalendar,
	FiLoader,
	FiDownload,
	FiEye,
	FiExternalLink,
	FiClock,
	FiTrash2,
	FiSliders,
	FiActivity,
	FiChevronDown,
	FiX,
	FiTag,
	FiInfo
} from "react-icons/fi";
import { IoWalletOutline } from "react-icons/io5";
import { SiSolana } from "react-icons/si";

/* ================= Client-only guard (Option A) ================= */
function ClientOnly({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return <div suppressHydrationWarning />;
	return <>{children}</>;
}

/* ================= Types ================= */
type KSRow = {
	Tidspunkt: string;
	Type: string;
	Inn: string;
	"Inn-Valuta": string;
	Ut: string;
	"Ut-Valuta": string;
	Gebyr: string;
	"Gebyr-Valuta": string;
	Marked: string;
	Notat: string;
};
type KSPreviewRow = KSRow & { signature?: string };

// "Needs attention" keys and overrides
type OverrideMaps = {
	symbols: Record<string, string>; // e.g. { "TOKEN-AB12CD": "FOO" }
	markets: Record<string, string>; // e.g. { "solana": "HELLOMOON" }
};
export type IssueKind = "unknown-token" | "unknown-market";
type IssueStatus = "pending" | "renamed" | "ignored";
type Issue = {
	kind: IssueKind;
	key: string;
	count: number;
	sigs: string[]; // all related signatures
	status: IssueStatus;
	newName?: string; // current override, if any
};

const PLACEHOLDER_RE = /^TOKEN-[0-9A-Z]{6}$/i;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/; // moved up so isUnknownMarket can use it

function isPlaceholderSymbol(s?: string) {
	return !!s && (PLACEHOLDER_RE.test(s) || s.toUpperCase() === "UNKNOWN");
}
const KNOWN_MARKETS = new Set([
	"solana",
	"spl",
	"solana dex",
	"airdrop",
	"stake",
	"aggregert" // <-- aggregated dust rows
]);

function isUnknownMarket(m?: string) {
	if (!m) return true;
	const lc = m.trim().toLowerCase();
	if (KNOWN_MARKETS.has(lc)) return false; // known/OK
	if (BASE58_RE.test(m)) return true; // raw program IDs
	if (m.toUpperCase() === "UNKNOWN") return true;
	return false;
}

type DustMode = "off" | "remove" | "aggregate";
type DustInterval = "day" | "week" | "month" | "year";
type SortOrder = "desc" | "asc";

/* Validation for payload sent to API */
const schema = z.object({
	address: z.string().min(32, "Ugyldig adresse"),
	fromISO: z.string().optional(),
	toISO: z.string().optional(),
	walletName: z.string().optional(),
	includeNFT: z.boolean().optional(),
	dustMode: z.enum(["off", "remove", "aggregate"]).optional(),
	dustThreshold: z.union([z.string(), z.number()]).optional(),
	dustInterval: z.enum(["day", "week", "month", "year"]).optional(),
	useOslo: z.boolean().optional() // ⬅️ added
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
function parseTidspunkt(t: string): number {
	const [date, time] = t.split(" ");
	const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
	const [hh = "0", mm = "0", ss = "0"] = (time || "").split(":");
	const dt = new Date(
		y,
		(m || 1) - 1,
		d || 1,
		parseInt(hh, 10),
		parseInt(mm, 10),
		parseInt(ss, 10)
	);
	return dt.getTime();
}
function formatRangeLabel(r?: DateRange) {
	if (!r?.from && !r?.to) return "Velg datoer";
	const f = (d?: Date) => (d ? d.toLocaleDateString("no-NO") : "–");
	if (r?.from && r?.to) return `${f(r.from)} → ${f(r.to)}`;
	return `${f(r?.from)} → …`;
}

// Stronger signature extraction used consistently
function extractSig(row: KSPreviewRow): string | undefined {
	if (row.signature) return row.signature;
	const m = row.Notat?.match(/sig:([1-9A-HJ-NP-Za-km-z]+)/);
	return m?.[1];
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
			className={`relative inline-flex h-5 w-10 items-center rounded-full transition cursor-pointer ${
				checked ? "bg-indigo-600" : "bg-slate-300"
			}`}
			title={label}
		>
			<span
				className={`absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white shadow transition-[left] ${
					checked ? "left-[22px]" : "left-[2px]"
				}`}
			/>
			<span className="sr-only">{label}</span>
		</button>
	);
}

/* ================= Page ================= */
const HISTORY_KEY = "sol2ks.addressHistory";
const HISTORY_MAX = 10;
const NAMES_KEY = "sol2ks.walletNames"; // { [address]: name }

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
	const [useOslo, setUseOslo] = useState(false); // ⬅️ added

	// Dust controls
	const [dustMode, setDustMode] = useState<DustMode>("off");
	const [dustThreshold, setDustThreshold] = useState<string>("0.001");
	const [dustInterval, setDustInterval] = useState<DustInterval>("day");

	// Tab + overrides + ignores
	const [activeTab, setActiveTab] = useState<"preview" | "attention">(
		"preview"
	);
	const [overrides, setOverrides] = useState<OverrideMaps>({
		symbols: {},
		markets: {}
	});
	const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());

	// Preview sort
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	// Highlight handling & table container ref
	const [highlightSig, setHighlightSig] = useState<string | null>(null);
	const previewContainerRef = useRef<HTMLDivElement | null>(null);

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

	// Issues list (includes handled ones, shows status)
	const issues: Issue[] = useMemo(() => {
		if (!rows) return [];
		// track counts + sig lists
		const sCount = new Map<string, { count: number; sigs: Set<string> }>();
		const mCount = new Map<string, { count: number; sigs: Set<string> }>();

		for (const r of rows) {
			const sig = extractSig(r);

			// SYMBOLS
			for (const s of [r["Inn-Valuta"], r["Ut-Valuta"]].filter(
				Boolean
			) as string[]) {
				if (!isPlaceholderSymbol(s)) continue;
				const o = sCount.get(s) || { count: 0, sigs: new Set<string>() };
				o.count += 1;
				if (sig) o.sigs.add(sig);
				sCount.set(s, o);
			}

			// MARKET
			const m = r.Marked;
			if (isUnknownMarket(m)) {
				const o = mCount.get(m) || { count: 0, sigs: new Set<string>() };
				o.count += 1;
				if (sig) o.sigs.add(sig);
				mCount.set(m, o);
			}
		}

		const out: Issue[] = [];

		for (const [k, v] of sCount.entries()) {
			const id = `symbol:${k}`;
			const hasRename = Boolean(overrides.symbols[k]);
			const isIgnored = ignoredKeys.has(id);
			out.push({
				kind: "unknown-token",
				key: k,
				count: v.count,
				sigs: [...v.sigs],
				status: hasRename ? "renamed" : isIgnored ? "ignored" : "pending",
				newName: hasRename ? overrides.symbols[k] : undefined
			});
		}
		for (const [k, v] of mCount.entries()) {
			const id = `market:${k}`;
			const hasRename = Object.prototype.hasOwnProperty.call(
				overrides.markets,
				k
			);
			const isIgnored = ignoredKeys.has(id);
			out.push({
				kind: "unknown-market",
				key: k,
				count: v.count,
				sigs: [...v.sigs],
				status: hasRename ? "renamed" : isIgnored ? "ignored" : "pending",
				newName: hasRename ? overrides.markets[k] : undefined
			});
		}

		// sort: pending first, then by count desc
		return out.sort((a, b) => {
			if (a.status !== b.status) {
				if (a.status === "pending") return -1;
				if (b.status === "pending") return 1;
			}
			return b.count - a.count;
		});
	}, [rows, overrides, ignoredKeys]);

	const pendingIssuesCount = useMemo(
		() => issues.filter((i) => i.status === "pending").length,
		[issues]
	);

	// Live log
	const [logOpen, setLogOpen] = useState(false);
	const [logLines, setLogLines] = useState<string[]>([]);
	const logRef = useRef<HTMLDivElement | null>(null);
	const pushLog = (s: string) =>
		setLogLines((prev) => [
			...prev,
			`${new Date().toLocaleTimeString()}  ${s}`
		]);
	const clearLog = () => setLogLines([]);

	// auto-scroll log
	useEffect(() => {
		if (logRef.current) {
			logRef.current.scrollTop = logRef.current.scrollHeight;
		}
	}, [logLines]);

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
			// names are loaded lazily
		} catch {}
	}, []);
	function renameIssue(kind: IssueKind, key: string, newVal: string) {
		if (!newVal.trim()) return;
		setOverrides((prev) => {
			const next = {
				...prev,
				symbols: { ...prev.symbols },
				markets: { ...prev.markets }
			};
			if (kind === "unknown-token")
				next.symbols[key] = newVal.trim().toUpperCase();
			else next.markets[key] = newVal.trim();
			return next;
		});
	}

	function ignoreIssue(kind: IssueKind, key: string) {
		const id = `${kind === "unknown-token" ? "symbol" : "market"}:${key}`;
		setIgnoredKeys((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// per-issue expand/collapse state
	const [openIssues, setOpenIssues] = useState<Set<string>>(new Set());
	function toggleOpenIssue(id: string) {
		setOpenIssues((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	/* ========== localStorage helpers ========== */
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
		const q = address.trim();
		if (!q) return addrHistory;
		const lc = q.toLowerCase();
		return addrHistory.filter((a) => a.toLowerCase().includes(lc));
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
			useOslo // ⬅️ include in payload
		};
	}
	function q(s?: string) {
		// keep literal double quotes in names/addresses from breaking the log line
		return `"${String(s ?? "").replace(/"/g, '\\"')}"`;
	}

	/* ========== Streamed preview with progress + cancel ========== */
	async function onCheckWallet(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setOk(false);
		setRows(null);
		cacheKeyRef.current = null;

		// clear previous run log & open
		clearLog();

		const payload = buildPayload();
		const parsed = schema.safeParse(payload);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Ugyldig input");
			pushLog("❌ Ugyldig input");
			setLogOpen(true);
			return;
		}

		// exact format: Ny sjekk "wallet name" "full address"
		pushLog(`Ny sjekk ${q(payload.walletName)} ${q(payload.address)}`);
		setLogOpen(true);

		// Remember address + name
		rememberAddress(parsed.data.address);

		// Abort controller
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
				// Process NDJSON lines
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

	/* ========== Download CSV (uses server cache) ========== */
	async function downloadCSV() {
		if (!lastPayloadRef.current) return;
		setError(null);
		try {
			const url = "/api/kryptosekken?useCache=1";
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "text/csv" },
				body: JSON.stringify({
					...lastPayloadRef.current,
					overrides // ⬅️ send renames for server-side CSV
				})
			});
			if (!res.ok) {
				const j = await res.json().catch(() => ({ error: "Feil" }));
				throw new Error(j.error || res.statusText);
			}
			const blob = await res.blob();
			const a = document.createElement("a");
			const dlUrl = URL.createObjectURL(blob);
			a.href = dlUrl;
			a.download = `kryptosekken_${lastPayloadRef.current.address}.csv`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(dlUrl);
			pushLog("✅ CSV klar (cache).");
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
		setSortOrder("desc");
		setIncludeNFT(false);
		setUseOslo(false); // reset tz toggle
		clearLog();
		setLogOpen(false);
		setOverrides({ symbols: {}, markets: {} });
		setIgnoredKeys(new Set());
		setActiveTab("preview");

		// reset to default 30 days
		const now = new Date();
		const from = new Date(now);
		from.setDate(from.getDate() - 29);
		setRange({ from, to: now });
	}

	const previewsReady = !loading && Array.isArray(rows) && rows.length > 0;

	const nice = (d?: Date) => (d ? d.toLocaleDateString("no-NO") : "—");

	// moved to its own banner; kept handler
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

	// Jump to a signature in the preview and highlight it
	function jumpToSig(sig: string) {
		if (!sig) return;
		setActiveTab("preview");
		setHighlightSig(sig);
		// Let tab switch render first, then scroll & highlight
		setTimeout(() => {
			const container = previewContainerRef.current;
			if (!container) return;
			const el = container.querySelector<HTMLElement>(`[data-sig="${sig}"]`);
			if (el) {
				el.scrollIntoView({ behavior: "smooth", block: "center" });
			}
			// remove highlight after a few seconds
			setTimeout(() => {
				setHighlightSig((curr) => (curr === sig ? null : curr));
			}, 3000);
		}, 60);
	}

	return (
		<main className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-emerald-50 text-slate-900">
			{/* Small UI tweaks */}
			<style jsx global>{`
				* {
					scrollbar-width: thin;
					scrollbar-color: #cbd5e1 #f8fafc;
				}
				*::-webkit-scrollbar {
					width: 10px;
					height: 10px;
				}
				*::-webkit-scrollbar-track {
					background: #f8fafc;
					border-radius: 8px;
				}
				*::-webkit-scrollbar-thumb {
					background: #cbd5e1;
					border-radius: 8px;
					border: 2px solid #f8fafc;
				}
				*::-webkit-scrollbar-thumb:hover {
					background: #94a3b8;
				}
				button {
					cursor: pointer;
				}
				button:disabled {
					cursor: not-allowed;
				}
				/* Smaller calendar */
				.rdp {
					--rdp-cell-size: 24px;
					font-size: 12px;
				}
				.rdp-caption_label {
					font-size: 12px;
				}
			`}</style>

			<div className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
				{/* Header */}
				<header className="mb-8 sm:mb-12">
					<div className="inline-flex items-center gap-3 rounded-full bg-white/70 ring-1 ring-black/5 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
						<SiSolana className="h-4 w-4" aria-hidden />
						Solana → Kryptosekken • CSV Generator
					</div>

					<h1 className="mt-4 text-balance text-3xl sm:text-4xl font-semibold tracking-tight">
						<span className="bg-gradient-to-r from-indigo-600 to-emerald-600 bg-clip-text text-transparent">
							Solana-transaksjoner gjort enklere
						</span>
					</h1>

					<p className="mt-2 max-w-prose text-sm sm:text-base text-slate-600">
						Lim inn en Solana-adresse, velg tidsrom, <b>sjekk lommeboken</b> og
						last ned en <b>CSV-fil</b> klar for import i Kryptosekken.
					</p>
				</header>

				{/* Card */}
				<div className="mt-4 rounded-3xl bg-white shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/60">
					{/* Wrap the ENTIRE form in ClientOnly to avoid hydration issues */}
					<ClientOnly>
						<form
							ref={formRef}
							onSubmit={onCheckWallet}
							className="p-6 sm:p-10"
						>
							{/* Address + Name with history */}
							<label className="block text-sm font-medium text-slate-700">
								Lommebok
							</label>
							<div className="grid gap-3 sm:grid-cols-[1fr_280px]">
								{/* Address */}
								<div className="relative">
									{/* perfectly centered */}
									<IoWalletOutline className="pointer-events-none absolute left-3 inset-y-0 mt-2 h-5 w-5 text-slate-400" />
									<input
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
										className="block w-full rounded-xl border border-slate-200 bg-white pl-11 pr-10 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
									/>
									{/* History toggle (centered) */}
									<button
										type="button"
										aria-label="Adressehistorikk"
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => setAddrMenuOpen((v) => !v)}
										className="absolute inset-y-0 right-3 mt-[7px] rounded-md p-1 text-slate-500 hover:bg-slate-100 h-6 w-6 aspect-square"
									>
										<FiClock className="h-4 w-4" />
									</button>

									{/* Dropdown history */}
									{addrMenuOpen && (addrHistory.length > 0 || address) && (
										<div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
											{filteredHistory.length > 0 ? (
												<ul className="max-h-64 overflow-auto text-sm">
													{filteredHistory.map((a) => (
														<li
															key={a}
															className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50"
														>
															<button
																type="button"
																onMouseDown={(e) => e.preventDefault()}
																onClick={() => pickAddress(a)}
																className="truncate text-left text-slate-700"
																title={a}
															>
																{a}
																{/* tiny name hint */}
																{(() => {
																	const nm = readNamesMap()[a];
																	return nm ? (
																		<span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
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
																className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
															>
																<FiTrash2 className="h-4 w-4" />
															</button>
														</li>
													))}
												</ul>
											) : (
												<div className="px-3 py-2 text-sm text-slate-500">
													Ingen treff i historikk
												</div>
											)}
											<div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
												<span>{addrHistory.length} lagret</span>
												<button
													type="button"
													onMouseDown={(e) => e.preventDefault()}
													onClick={clearHistory}
													className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-white"
												>
													<FiTrash2 className="h-3 w-3" />
													Tøm
												</button>
											</div>
										</div>
									)}
								</div>

								{/* Wallet name */}
								<div className="relative">
									{/* perfectly centered */}
									<FiTag className="pointer-events-none absolute left-3 inset-y-0 mt-2.5 h-5 w-5 text-slate-400" />
									<input
										name="walletName"
										autoComplete="off"
										placeholder="Navn (valgfritt)"
										value={walletName}
										onChange={(e) => setWalletName(e.target.value)}
										className="block w-full rounded-xl border border-slate-200 bg-white pl-11 pr-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
									/>
									<p className="mt-1 text-[11px] text-slate-500">
										Vises i <b>Notat</b> (eks. <b>MIN WALLET</b>).
									</p>
								</div>
							</div>

							{/* Timespan (dropdown calendar + presets) */}
							<div className="mt-6">
								<div className="flex items-center justify-between">
									<label className="block text-sm font-medium text-slate-700">
										Tidsrom
									</label>
									<div className="text-[11px] text-slate-500">
										Avgrenser transaksjoner i perioden. Standard:{" "}
										<b>siste 30 dager</b>.
									</div>
								</div>

								<div className="mt-2 flex flex-wrap items-center gap-3">
									{/* Trigger */}
									<div className="relative">
										<button
											type="button"
											onClick={() => {
												setCalOpen((v) => !v);
												setCalMonth(range?.to ?? new Date());
											}}
											className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
										>
											<FiCalendar className="h-4 w-4 text-slate-500" />
											{formatRangeLabel(range)}
											<FiChevronDown className="h-4 w-4 text-slate-400" />
										</button>

										{calOpen && (
											<div className="absolute z-20 mt-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl min-w-[260px]">
												{/* Legend */}
												<div className="flex items-center justify-between px-1 pb-2">
													<button
														type="button"
														className="text-[11px] text-slate-600"
														onClick={() =>
															range?.from && setCalMonth(range.from)
														}
														title="Gå til Fra-måned"
													>
														<span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 hover:bg-indigo-100">
															<span className="h-2 w-2 rounded-full bg-indigo-600" />
															Fra: <b>{nice(range?.from)}</b>
														</span>
													</button>
													<button
														type="button"
														className="text-[11px] text-slate-600"
														onClick={() => range?.to && setCalMonth(range.to)}
														title="Gå til Til-måned"
													>
														<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 hover:bg-emerald-100">
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
														// ensure "Til" is never in the future
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
														range_middle: "bg-indigo-100 text-indigo-900",
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
														className="rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
													>
														Lukk
													</button>
												</div>
											</div>
										)}
									</div>

									{/* Presets */}
									<div className="flex flex-wrap gap-2 text-xs">
										<button
											type="button"
											onClick={() => presetDays(7)}
											className="rounded-full border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
										>
											Siste 7 dager
										</button>
										<button
											type="button"
											onClick={() => presetDays(30)}
											className="rounded-full border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
										>
											Siste 30 dager
										</button>
										<button
											type="button"
											onClick={ytd}
											className="rounded-full border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
										>
											YTD
										</button>
										<button
											type="button"
											onClick={clearDates}
											className="rounded-full border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
										>
											Nullstill
										</button>
									</div>
								</div>

								{/* Tidssone toggle */}
								<div className="mt-3 inline-flex items-center gap-3">
									<Switch
										checked={useOslo}
										onChange={setUseOslo}
										label="Norsk tid (Europe/Oslo)"
									/>
									<span className="text-sm font-medium text-slate-700">
										Norsk tid (Europe/Oslo)
									</span>
									<span className="text-[11px] text-slate-500">
										CSV tidsstempler skrives i{" "}
										{useOslo ? "Norsk tid (UTC+01:00 Europe/Oslo)" : "UTC"}.
									</span>
								</div>
							</div>

							{/* NFT section (separate) */}
							<div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
								<div className="flex items-center justify-between">
									<div className="inline-flex items-center gap-3">
										<Switch
											checked={includeNFT}
											onChange={setIncludeNFT}
											label="Inkluder NFT-overføringer"
										/>
										<span className="text-sm font-medium text-slate-700">
											Inkluder NFT-overføringer
										</span>
									</div>
									<div className="text-[11px] text-slate-500">
										Tar med bevegelser av NFT-er. (Ingen prising, kun
										overføringer.)
									</div>
								</div>
							</div>

							{/* Dust section (separate) */}
							<div className="mt-4 rounded-xl border border-slate-200 p-4">
								{/* Header + tooltip aligned to opposite sides */}
								<div className="mb-3 flex items-center justify-between">
									<div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
										<FiSliders className="h-4 w-4" />
										Støvtransaksjoner
									</div>

									{/* Info tooltip (hover/focus) */}
									<div className="relative group">
										<button
											type="button"
											aria-label="Hvorfor får jeg så mye støv i SOL?"
											className="rounded-full p-1 text-slate-500 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
										>
											<FiInfo className="h-4 w-4" />
										</button>
										<div
											role="tooltip"
											className="pointer-events-none absolute right-0 top-7 z-30 hidden w-[22rem] rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl group-hover:block group-focus-within:block"
										>
											<p className="mb-1 font-medium">
												Hvorfor så mye “støv” i SOL?
											</p>
											<ul className="list-disc space-y-1 pl-4 text-slate-600">
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
										<label className="text-xs text-slate-600">Modus</label>
										<select
											value={dustMode}
											onChange={(e) => setDustMode(e.target.value as DustMode)}
											className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
										>
											<option value="off">Vis alle</option>
											<option value="remove">Skjul </option>
											<option value="aggregate">Slå sammen periodisk</option>
										</select>
									</div>

									{/* Threshold */}
									{dustMode !== "off" && (
										<div className="flex flex-col gap-1">
											<label className="text-xs text-slate-600">
												Grense (beløp)
											</label>
											<input
												type="number"
												step="any"
												inputMode="decimal"
												value={dustThreshold}
												onChange={(e) => setDustThreshold(e.target.value)}
												className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
												placeholder="0.001"
											/>
										</div>
									)}

									{/* Interval — ONLY when aggregate */}
									{dustMode === "aggregate" && (
										<div className="flex flex-col gap-1">
											<label className="text-xs text-slate-600">Periode</label>
											<select
												value={dustInterval}
												onChange={(e) =>
													setDustInterval(e.target.value as DustInterval)
												}
												className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
											>
												<option value="day">Dag</option>
												<option value="week">Uke</option>
												<option value="month">Måned</option>
												<option value="year">År</option>
											</select>
										</div>
									)}
								</div>

								{/* Info text – specific per mode */}
								{dustMode === "off" && (
									<p className="mt-2 text-[11px] text-slate-500">
										<b>Vis alle:</b> Støv er mikro-overføringer (typisk &lt;
										0.001 SOL) som ofte stammer fra spam/dusting, små refusjoner
										fra DEX/protokoller, kontolukking eller rent-exempt
										topp-ups, og diverse program-interaksjoner.
									</p>
								)}

								{dustMode === "remove" && (
									<p className="mt-2 text-[11px] text-slate-500">
										<b>Skjul:</b> Filtrerer vekk alle linjer under angitt
										grense.{" "}
										<span className="text-amber-700">(Ikke anbefalt)</span>
									</p>
								)}

								{dustMode === "aggregate" && (
									<p className="mt-2 text-[11px] text-slate-500">
										<b>Slå sammen periodisk:</b> Slå sammen alle små{" "}
										<code>Overføring-Inn/Ut</code> i én linje per valgt periode.
									</p>
								)}
							</div>

							{/* Actions */}
							<div className="mt-6 flex flex-wrap items-center gap-3">
								<button
									type="submit"
									disabled={loading}
									className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
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
										className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 active:scale-[0.99]"
									>
										<FiX className="h-4 w-4" />
										Avbryt
									</button>
								)}{" "}
								<button
									type="button"
									onClick={onReset}
									className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99]"
								>
									Nullstill
								</button>
								{error && (
									<span
										role="status"
										aria-live="polite"
										className="text-sm text-red-600"
									>
										{error}
									</span>
								)}
								{!error && effectiveRows && effectiveRows.length > 0 && (
									<span className="text-sm text-emerald-700">
										{effectiveRows.length} transaksjoner funnet ✅
									</span>
								)}
								{/* Live log toggle */}
								<button
									type="button"
									onClick={() => setLogOpen((v) => !v)}
									className="ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
									title="Vis/skjul logg"
								>
									<FiActivity className="h-4 w-4" />
									{logOpen ? "Skjul logg" : "Vis logg"}
								</button>
							</div>

							{/* Live log panel */}
							{logOpen && (
								<div
									ref={logRef}
									className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 max-h-40 overflow-auto"
								>
									{logLines.length === 0 ? (
										<div className="text-slate-500">Ingen hendelser ennå.</div>
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
								<div className="mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
									<span>
										Treff i cache for denne adressen/perioden. Du kan tømme
										cache hvis du vil foreta et nytt sjekk.
									</span>
									<button
										type="button"
										onClick={clearCacheNow}
										className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/60 px-2 py-1 hover:bg-white"
										title="Tøm mellomlager for denne forespørselen"
									>
										<FiTrash2 className="h-4 w-4" />
										Tøm cache
									</button>
								</div>
							)}

							{rows && (
								<>
									{/* Tabs header */}
									<div className="mt-6 border-b border-slate-200 flex items-center gap-4">
										<button
											type="button"
											onClick={() => setActiveTab("preview")}
											className={`px-3 py-2 text-sm -mb-px border-b-2 ${
												activeTab === "preview"
													? "border-indigo-600 text-indigo-700"
													: "border-transparent text-slate-600 hover:text-slate-800"
											}`}
										>
											Forhåndsvisning
										</button>
										<button
											type="button"
											onClick={() => setActiveTab("attention")}
											className={`px-3 py-2 text-sm -mb-px border-b-2 ${
												activeTab === "attention"
													? "border-indigo-600 text-indigo-700"
													: "border-transparent text-slate-600 hover:text-slate-800"
											}`}
											title="Uavklarte elementer som bør navngis"
										>
											Trenger oppmerksomhet
											{pendingIssuesCount > 0 && (
												<span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[11px] px-1.5 py-0.5">
													{pendingIssuesCount}
												</span>
											)}
										</button>
									</div>

									{/* Tabs content */}
									{(() => {
										const idForIssue = (kind: IssueKind, key: string) =>
											`issue-${kind}-${key.replace(/[^a-z0-9\-]/gi, "_")}`;
										if (activeTab === "attention") {
											return (
												<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
													{issues.length === 0 ? (
														<div className="text-sm text-emerald-700">
															Ingen uavklarte elementer 🎉
														</div>
													) : (
														<ul className="space-y-3">
															{issues.map((it) => {
																const inputId = idForIssue(it.kind, it.key);
																const isOpen = openIssues.has(inputId);

																const statusBadge =
																	it.status === "pending" ? (
																		<span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
																			Avventer
																		</span>
																	) : it.status === "renamed" ? (
																		<span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">
																			Endret
																			{it.newName ? ` → ${it.newName}` : ""}
																		</span>
																	) : (
																		<span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700">
																			Ignorert
																		</span>
																	);

																// Build occurrence list with details (timestamp, type, tokens)
																const occurrenceRows =
																	rows?.filter((r) => {
																		if (it.kind === "unknown-token") {
																			return (
																				r["Inn-Valuta"] === it.key ||
																				r["Ut-Valuta"] === it.key
																			);
																		}
																		// unknown-market
																		return r.Marked === it.key;
																	}) ?? [];

																return (
																	<li
																		key={`${it.kind}:${it.key}`}
																		className="rounded-lg bg-white p-3 ring-1 ring-slate-200"
																	>
																		<div className="flex items-start justify-between gap-3">
																			<div className="space-y-1">
																				<div className="text-sm font-medium text-slate-800">
																					{it.kind === "unknown-token"
																						? "Ukjent token"
																						: "Ukjent marked"}
																					:{" "}
																					<code className="font-mono">
																						{it.key}
																					</code>
																					{statusBadge}
																				</div>
																				<div className="text-xs text-slate-600">
																					{it.count} forekomster
																				</div>
																			</div>

																			<div className="flex items-center gap-2">
																				<input
																					id={inputId}
																					defaultValue={it.newName ?? ""}
																					placeholder={
																						it.kind === "unknown-token"
																							? "Ny tokensymbol (BTC, ETH, SOL...)"
																							: "Nytt markedsnavn"
																					}
																					className="w-56 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
																				/>
																				<button
																					type="button"
																					onClick={() => {
																						const el = document.getElementById(
																							inputId
																						) as HTMLInputElement | null;
																						const val = (
																							el?.value ?? ""
																						).trim();
																						if (!val) return;
																						renameIssue(it.kind, it.key, val);
																					}}
																					className="rounded-md bg-indigo-600 text-white px-2 py-1 text-sm disabled:opacity-60"
																				>
																					Lagre
																				</button>
																				<button
																					type="button"
																					onClick={() =>
																						ignoreIssue(it.kind, it.key)
																					}
																					className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
																					title={
																						it.status === "ignored"
																							? "Angre ignorering"
																							: "Ignorer"
																					}
																				>
																					{it.status === "ignored"
																						? "Angre"
																						: "Ignorer"}
																				</button>
																				<button
																					type="button"
																					onClick={() =>
																						toggleOpenIssue(inputId)
																					}
																					className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
																				>
																					{isOpen
																						? "Skjul forekomster"
																						: `Vis forekomster (${occurrenceRows.length})`}
																				</button>
																			</div>
																		</div>

																		{/* Expandable occurrence list (click to jump & highlight) */}
																		{isOpen && (
																			<div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
																				{occurrenceRows.length === 0 ? (
																					<div className="text-xs text-slate-600">
																						Ingen forekomster funnet.
																					</div>
																				) : (
																					<ul className="grid gap-2 sm:grid-cols-1 md:grid-cols-2">
																						{occurrenceRows.map((r, idx) => {
																							const sig = extractSig(r);
																							const tokenInfo =
																								[
																									r["Inn-Valuta"],
																									r["Ut-Valuta"]
																								]
																									.filter(Boolean)
																									.join(" / ") || "—";
																							return (
																								<li
																									key={`${sig ?? "x"}-${idx}`}
																								>
																									<button
																										type="button"
																										onClick={() =>
																											sig && jumpToSig(sig)
																										}
																										disabled={!sig}
																										className="w-full text-left rounded-md bg-white px-2 py-1.5 text-xs shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
																										title={
																											sig
																												? "Gå til rad i forhåndsvisning"
																												: "Ingen signatur funnet"
																										}
																									>
																										<div className="flex items-center justify-between gap-2">
																											<span className="font-mono text-[11px] text-slate-600">
																												{r.Tidspunkt}
																											</span>
																											{sig ? (
																												<span className="text-[10px] text-indigo-600">
																													Gå til rad
																												</span>
																											) : null}
																										</div>
																										<div className="mt-0.5">
																											<span className="font-medium text-slate-800">
																												{r.Type}
																											</span>{" "}
																											<span className="text-slate-600">
																												• {tokenInfo}
																											</span>
																										</div>
																									</button>
																								</li>
																							);
																						})}
																					</ul>
																				)}
																			</div>
																		)}
																	</li>
																);
															})}
														</ul>
													)}
												</div>
											);
										}

										// PREVIEW TAB
										const sorted = [...effectiveRows].sort((a, b) => {
											const ta = parseTidspunkt(a.Tidspunkt);
											const tb = parseTidspunkt(b.Tidspunkt);
											return sortOrder === "desc" ? tb - ta : ta - tb;
										});
										const limited = sorted.slice(0, 200);

										return (
											<div className="mt-6">
												<div className="mb-2 flex items-center justify-between">
													<div className="text-xs text-slate-600">
														Viser {Math.min(effectiveRows.length, 200)} av{" "}
														{effectiveRows.length} rader.
													</div>
													{/* Sorter */}
													<div className="flex items-center gap-2 text-xs">
														<span className="text-slate-600">Sorter:</span>
														<select
															value={sortOrder}
															onChange={(e) =>
																setSortOrder(e.target.value as SortOrder)
															}
															className="min-w-[180px] pr-8 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
														>
															<option value="desc">Nyeste først</option>
															<option value="asc">Eldste først</option>
														</select>
													</div>
												</div>

												<div
													ref={previewContainerRef}
													className="max-h-[24rem] overflow-auto rounded-xl ring-1 ring-slate-200"
												>
													<table className="min-w-full text-xs">
														<thead className="sticky top-0 bg-slate-50 text-slate-700">
															<tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left whitespace-nowrap">
																<th className="min-w-[9.5rem]">Tidspunkt</th>
																<th>Type</th>
																<th className="text-right">Inn</th>
																<th>Inn-Valuta</th>
																<th className="text-right">Ut</th>
																<th>Ut-Valuta</th>
																<th className="text-right">Gebyr</th>
																<th>Gebyr-Valuta</th>
																<th>Marked</th>
																<th>Notat</th>
																<th>Explorer</th>
															</tr>
														</thead>
														<tbody className="divide-y divide-slate-100 bg-white">
															{limited.map((r, i) => {
																const sig = extractSig(r);
																const solscan = sig
																	? `https://solscan.io/tx/${sig}`
																	: undefined;
																const rowKey = `${sig ?? "nosig"}-${r.Type}-${
																	r["Inn-Valuta"]
																}-${r["Ut-Valuta"]}-${r.Inn}-${r.Ut}-${i}`;
																const [datePart, timePart] =
																	r.Tidspunkt.split(" ");

																const highlight =
																	sig && highlightSig === sig
																		? "bg-amber-50 ring-2 ring-amber-400"
																		: "";

																return (
																	<tr
																		key={rowKey}
																		data-sig={sig || undefined}
																		className={`[&>td]:px-3 [&>td]:py-2 transition-colors ${highlight}`}
																	>
																		<td className="font-medium whitespace-normal leading-tight">
																			<div className="min-w-[9.5rem]">
																				<div>{datePart}</div>
																				<div className="text-slate-500">
																					{timePart}
																				</div>
																			</div>
																		</td>
																		<td>{r.Type}</td>
																		<td className="text-right font-mono tabular-nums">
																			{r.Inn}
																		</td>
																		<td>{r["Inn-Valuta"]}</td>
																		<td className="text-right font-mono tabular-nums">
																			{r.Ut}
																		</td>
																		<td>{r["Ut-Valuta"]}</td>
																		<td className="text-right font-mono tabular-nums">
																			{r.Gebyr}
																		</td>
																		<td>{r["Gebyr-Valuta"]}</td>
																		<td
																			className="truncate max-w-[12rem]"
																			title={r.Marked}
																		>
																			{r.Marked}
																		</td>
																		<td
																			className="truncate max-w-[14rem]"
																			title={r.Notat}
																		>
																			{r.Notat}
																		</td>
																		<td>
																			{solscan ? (
																				<a
																					href={solscan}
																					target="_blank"
																					rel="noopener noreferrer"
																					className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
																					title="Åpne i Solscan"
																				>
																					<FiExternalLink className="h-4 w-4" />
																					<span className="sr-only">
																						Solscan
																					</span>
																				</a>
																			) : (
																				<span className="text-slate-400">
																					—
																				</span>
																			)}
																		</td>
																	</tr>
																);
															})}
															{limited.length === 0 && (
																<tr>
																	<td
																		colSpan={11}
																		className="px-3 py-6 text-center text-slate-500"
																	>
																		Ingen rader funnet for valgte kriterier.
																	</td>
																</tr>
															)}
														</tbody>
													</table>
												</div>
											</div>
										);
									})()}
								</>
							)}
							{/* Global actions row (below the big card) */}
							{previewsReady && (
								<div className="mt-4 flex items-center justify-between">
									{rows && (
										<div className="text-sm">
											{pendingIssuesCount > 0 ? (
												<button
													type="button"
													onClick={() => setActiveTab("attention")}
													className="text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 hover:bg-amber-100"
												>
													Løs ‘Trenger oppmerksomhet’ først (
													{pendingIssuesCount})
												</button>
											) : (
												<span className="text-emerald-700">
													Alt ser bra ut ✅
												</span>
											)}
										</div>
									)}

									<div>
										<button
											type="button"
											onClick={downloadCSV}
											disabled={!rows || pendingIssuesCount > 0 || loading}
											className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:shadow-lg active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
											title={
												pendingIssuesCount > 0
													? "Løs ‘Trenger oppmerksomhet’ først"
													: "Last ned CSV"
											}
										>
											<FiDownload className="h-4 w-4" />
											Last ned CSV
										</button>
									</div>
								</div>
							)}

							{/* Help */}
							<div className="mt-6 rounded-xl bg-gradient-to-r from-emerald-50 to-indigo-50 p-4 text-xs text-slate-600 ring-1 ring-slate-200/70">
								Mapper: <b>Swaps</b> → <code>Handel</code>, <b>SOL/SPL</b> →{" "}
								<code>Overføring-Inn/Ut</code>, <b>Airdrops</b> →{" "}
								<code>Erverv</code>, <b>staking</b> → <code>Inntekt</code>.
								Ukjente tokens får koden <code>TOKEN-XXXXXX</code>.
							</div>
						</form>
					</ClientOnly>
				</div>

				{/* Footer */}
				<footer className="mt-6 text-xs text-slate-500">
					Vi tar forbehold om feil. Kontroller resultatet i Kryptosekken etter
					opplasting.
				</footer>
			</div>
		</main>
	);
}
