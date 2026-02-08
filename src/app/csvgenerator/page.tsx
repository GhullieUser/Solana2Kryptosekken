"use client";

import {
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
	useCallback
} from "react";
import type { ReactNode } from "react";
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
	FiChevronDown,
	FiX,
	FiTag,
	FiInfo,
	FiActivity,
	FiAlertTriangle
} from "react-icons/fi";
import { BsXDiamondFill } from "react-icons/bs";
import { MdOutlineCleaningServices } from "react-icons/md";
import { HiOutlineSearch } from "react-icons/hi";
import type { HeliusTx } from "@/lib/helius";
import { IoWalletOutline, IoOpenOutline } from "react-icons/io5";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// ⬇️ Preview card
import Preview from "@/app/components/preview";
import WalletHoldings from "@/app/components/WalletHoldings";
import KryptosekkenImportCard from "@/app/components/KryptosekkenImportCard";
import StyledSelect from "@/app/components/styled-select";
import { useLocale } from "@/app/components/locale-provider";
import { currencyCode, rowsToCSV } from "@/lib/kryptosekken";

/* ================= Client-only guard ================= */
function ClientOnly({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return <div suppressHydrationWarning />;
	return <>{children}</>;
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
	/** raw Helius tx used to classify this row (when available) */
	debugTx?: HeliusTx;
};

export type OverrideMaps = {
	symbols: Record<string, string>;
	markets: Record<string, string>;
};

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

type DustMode = "off" | "remove" | "aggregate-signer" | "aggregate-period";
type DustInterval = "day" | "week" | "month" | "year";

/* Validation for payload sent to API */
const schema = z.object({
	address: z.string().min(32, "Ugyldig adresse / Invalid address"),
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
const HISTORY_MAX = 10;

type AddressHistoryItem = {
	address: string;
	label?: string | null;
};

type CsvVersion = {
	id: string;
	address: string;
	label?: string | null;
	partial?: boolean | null;
	scan_session_id?: string | null;
	include_nft?: boolean | null;
	use_oslo?: boolean | null;
	dust_mode?: string | null;
	dust_threshold?: string | number | null;
	dust_interval?: string | null;
	from_iso?: string | null;
	to_iso?: string | null;
	updated_at?: string | null;
};

function CSVGeneratorPageInner() {
	const { tr, locale } = useLocale();
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const searchParams = useSearchParams();
	const formRef = useRef<HTMLFormElement | null>(null);
	const lastPayloadRef = useRef<Payload | null>(null);
	const lastCountsRef = useRef<{
		rawCount: number;
		processedCount: number;
	} | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const loadedFromParamsRef = useRef(false);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorCta, setErrorCta] = useState<{
		label: string;
		href: string;
	} | null>(null);
	const [ok, setOk] = useState(false);
	const [creditsSpent, setCreditsSpent] = useState<number | null>(null);
	const [partialResult, setPartialResult] = useState(false);
	const [scanSessionId, setScanSessionId] = useState<string | null>(null);
	const scanSessionIdRef = useRef<string | null>(null);
	const lastPayloadKeyRef = useRef<string | null>(null);
	const [billingStatus, setBillingStatus] = useState<{
		freeRemaining: number;
		creditsRemaining: number;
	} | null>(null);
	const [isAuthed, setIsAuthed] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (creditsSpent !== null && ok) {
			window.dispatchEvent(new Event("sol2ks:billing:update"));
		}
	}, [creditsSpent, ok]);

	const refreshBilling = useCallback(async () => {
		try {
			const res = await fetch("/api/billing/status", {
				method: "GET",
				cache: "no-store"
			});
			if (!res.ok) return;
			const data = (await res.json()) as {
				freeRemaining?: number;
				creditsRemaining?: number;
			};
			const nextStatus = {
				freeRemaining: data.freeRemaining ?? 0,
				creditsRemaining: data.creditsRemaining ?? 0
			};
			setBillingStatus(nextStatus);
			return nextStatus;
		} catch {
			// ignore
		}
		return null;
	}, []);

	useEffect(() => {
		if (!isAuthed) {
			setBillingStatus(null);
			return;
		}
		refreshBilling();
	}, [isAuthed, refreshBilling]);

	useEffect(() => {
		if (!isAuthed) return;
		const onBillingUpdate = () => refreshBilling();
		window.addEventListener("sol2ks:billing:update", onBillingUpdate);
		return () =>
			window.removeEventListener("sol2ks:billing:update", onBillingUpdate);
	}, [isAuthed, refreshBilling]);

	// Default range = last 30 days
	const [range, setRange] = useState<DateRange | undefined>();
	useEffect(() => {
		const now = new Date();
		const from = new Date(now);
		from.setDate(from.getDate() - 29);
		setRange({ from, to: now });
	}, []);

	const [rows, setRows] = useState<KSPreviewRow[] | null>(null);
	const [sharedLogos, setSharedLogos] = useState<Record<string, string | null>>(
		{}
	);

	// Address + history state
	const [address, setAddress] = useState("");
	const [walletName, setWalletName] = useState("");
	const [addrHistory, setAddrHistory] = useState<AddressHistoryItem[]>([]);
	const [addrMenuOpen, setAddrMenuOpen] = useState(false);
	const [csvVersions, setCsvVersions] = useState<CsvVersion[]>([]);
	const [csvVersionId, setCsvVersionId] = useState<string | null>(null);
	const [csvNotice, setCsvNotice] = useState<string | null>(null);
	const prevCsvVersionsRef = useRef<CsvVersion[]>([]);

	// Live log
	const [logOpen, setLogOpen] = useState(false);
	const [logLines, setLogLines] = useState<string[]>([]);
	const logRef = useRef<HTMLDivElement | null>(null);
	const [infoModal, setInfoModal] = useState<{
		title: string;
		content: ReactNode;
	} | null>(null);

	const openInfoModal = useCallback((title: string, content: ReactNode) => {
		if (
			typeof window !== "undefined" &&
			window.matchMedia("(max-width: 639px)").matches
		) {
			setInfoModal({ title, content });
		}
	}, []);

	const normalizeCreditError = useCallback(
		(message: string) => {
			if (!message) return message;
			if (message.toLowerCase().includes("not enough tx credits")) {
				return tr({
					no: "Ikke nok TX Credits til å utføre et søk.",
					en: "Not enough TX Credits to perform a search."
				});
			}
			return message;
		},
		[tr]
	);

		const setScanSessionIdSafe = useCallback((next: string | null) => {
			scanSessionIdRef.current = next;
			setScanSessionId(next);
		}, []);

	const resetPreview = useCallback(() => {
		setRows(null);
		setOk(false);
		setError(null);
		setErrorCta(null);
		setCreditsSpent(null);
		setPartialResult(false);
		setScanSessionIdSafe(null);
		lastPayloadKeyRef.current = null;
		setLogOpen(false);
		setLogLines([]);
		lastPayloadRef.current = null;
		lastCountsRef.current = null;
	}, []);

	useEffect(() => {
		const addr = searchParams.get("address");
		if (addr && !address.trim()) {
			setAddress(addr);
		}
	}, [address, searchParams]);

	const formatDateRange = useCallback(
		(from?: string | null, to?: string | null) => {
			if (!from && !to) return null;
			const fmt = (v?: string | null) => {
				if (!v) return "";
				const d = new Date(v);
				if (Number.isNaN(d.getTime())) return v;
				return d.toLocaleDateString(locale === "en" ? "en-GB" : "no-NO", {
					year: "numeric",
					month: "short",
					day: "2-digit"
				});
			};
			const a = fmt(from);
			const b = fmt(to);
			if (a && b) return `${a} – ${b}`;
			return a || b;
		},
		[locale]
	);

	const extractSigFromNotat = useCallback((notat?: string) => {
		const m = notat?.match(/sig:([1-9A-HJ-NP-Za-km-z]+)/);
		return m?.[1];
	}, []);

	const parseCsvToRows = useCallback((csv: string): KSPreviewRow[] => {
		const out: KSPreviewRow[] = [];
		const lines = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const rows: string[][] = [];
		let current = "";
		let inQuotes = false;
		let row: string[] = [];
		for (let i = 0; i < lines.length; i += 1) {
			const ch = lines[i];
			const next = lines[i + 1];
			if (ch === '"') {
				if (inQuotes && next === '"') {
					current += '"';
					i += 1;
				} else {
					inQuotes = !inQuotes;
				}
				continue;
			}
			if (!inQuotes && ch === ",") {
				row.push(current);
				current = "";
				continue;
			}
			if (!inQuotes && ch === "\n") {
				row.push(current);
				rows.push(row);
				row = [];
				current = "";
				continue;
			}
			current += ch;
		}
		if (current.length || row.length) {
			row.push(current);
			rows.push(row);
		}

		const header = rows.shift();
		if (!header || header.length === 0) return out;
		const idx = (name: string) => header.indexOf(name);
		const get = (r: string[], name: string) => {
			const i = idx(name);
			return i >= 0 ? (r[i] ?? "") : "";
		};

		for (const r of rows) {
			if (!r || r.length === 0) continue;
			out.push({
				Tidspunkt: get(r, "Tidspunkt"),
				Type: get(r, "Type") as KSType,
				Inn: get(r, "Inn"),
				"Inn-Valuta": get(r, "Inn-Valuta"),
				Ut: get(r, "Ut"),
				"Ut-Valuta": get(r, "Ut-Valuta"),
				Gebyr: get(r, "Gebyr"),
				"Gebyr-Valuta": get(r, "Gebyr-Valuta"),
				Marked: get(r, "Marked"),
				Notat: get(r, "Notat")
			});
		}
		return out;
	}, []);

	const loadCsvPreview = useCallback(
		async (query: string, opts?: { skipDebug?: boolean }) => {
			const res = await fetch(`/api/csvs?${query}&format=json`);
			if (!res.ok) return;
			const j = await res.json();
			if (!j?.csv) return;
			setError(null);
			setErrorCta(null);
			const parsedRows = parseCsvToRows(j.csv);
			setRows(parsedRows);
			setOk(true);
			const dustModeRaw = (j.meta?.dust_mode ?? "off") as
				| DustMode
				| "aggregate";
			const normalizedDustMode: DustMode =
				dustModeRaw === "aggregate" ? "aggregate-period" : dustModeRaw;
			const normalizedDustThreshold =
				j.meta?.dust_threshold !== undefined &&
				j.meta?.dust_threshold !== null
					? String(j.meta.dust_threshold)
					: undefined;
			const normalizedDustInterval = j.meta?.dust_interval ?? undefined;
			const metaPayload: Payload = {
				address: j.meta?.address ?? address.trim(),
				walletName: j.meta?.label ?? undefined,
				fromISO: j.meta?.from_iso ?? undefined,
				toISO: j.meta?.to_iso ?? undefined,
				includeNFT: j.meta?.include_nft ?? false,
				useOslo: j.meta?.use_oslo ?? false,
				dustMode: normalizedDustMode,
				dustThreshold: normalizedDustThreshold,
				dustInterval: normalizedDustInterval
			};
			lastPayloadRef.current = metaPayload;
			const metaKey = payloadKeyFromPayload(metaPayload);
			lastPayloadKeyRef.current = metaKey;
			setScanSessionIdSafe(j.meta?.scan_session_id ?? null);
			lastCountsRef.current = {
				rawCount: j.meta?.raw_count ?? parsedRows.length,
				processedCount: j.meta?.processed_count ?? parsedRows.length
			};
			setPartialResult(Boolean(j.meta?.partial));
			setCreditsSpent(null);
			if (j.meta?.partial && !j.meta?.scan_session_id) {
				const newSessionId = getScanSessionId();
				setScanSessionIdSafe(newSessionId);
				await saveGeneratedCsv(j.csv, true, newSessionId);
			} else {
				setScanSessionIdSafe(j.meta?.scan_session_id ?? null);
			}
			setWalletName(j.meta?.label ?? "");
			setAddress(j.meta?.address ?? address.trim());
			setIncludeNFT(Boolean(j.meta?.include_nft ?? false));
			setUseOslo(Boolean(j.meta?.use_oslo ?? false));
			setDustMode(normalizedDustMode);
			if (normalizedDustThreshold !== undefined) {
				setDustThreshold(normalizedDustThreshold);
			}
			if (normalizedDustInterval) {
				setDustInterval(normalizedDustInterval as DustInterval);
			}
			const fromISO = j.meta?.from_iso ? new Date(j.meta.from_iso) : undefined;
			const toISO = j.meta?.to_iso ? new Date(j.meta.to_iso) : undefined;
			const fromValid = fromISO && !Number.isNaN(fromISO.getTime());
			const toValid = toISO && !Number.isNaN(toISO.getTime());
			if (fromValid || toValid) {
				setRange({
					from: fromValid ? fromISO : undefined,
					to: toValid ? toISO : undefined
				});
			} else {
				setRange(undefined);
			}

			// Rehydrate debug info for reopened CSVs.
			try {
				if (opts?.skipDebug) return;
				const debugPayload = {
					address: j.meta?.address ?? address.trim(),
					walletName: j.meta?.label ?? undefined,
					fromISO: j.meta?.from_iso ?? undefined,
					toISO: j.meta?.to_iso ?? undefined,
					includeNFT: j.meta?.include_nft ?? false,
					useOslo: j.meta?.use_oslo ?? false,
					dustMode: j.meta?.dust_mode ?? undefined,
					dustThreshold: j.meta?.dust_threshold ?? undefined,
					dustInterval: j.meta?.dust_interval ?? undefined
				};
				const debugRes = await fetch("/api/kryptosekken?format=json", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json"
					},
					body: JSON.stringify(debugPayload)
				});
				if (debugRes.ok) {
					const debugJson = await debugRes.json();
					const debugRows = Array.isArray(debugJson?.rows)
						? (debugJson.rows as KSPreviewRow[])
						: [];
					const debugMap = new Map<string, HeliusTx>();
					const metaMap = new Map<string, Partial<KSPreviewRow>>();
					for (const row of debugRows) {
						const sig = row.signature ?? extractSigFromNotat(row.Notat);
						if (!sig) continue;
						if (row.debugTx) {
							debugMap.set(sig, row.debugTx);
						}
						const meta: Partial<KSPreviewRow> = {};
						if (row.signer) meta.signer = row.signer;
						const recipient =
							(row as any).recipient ??
							(row as any).mottaker ??
							(row as any).Mottaker ??
							(row as any).receiver ??
							(row as any).Receiver ??
							(row as any).to ??
							(row as any).To ??
							(row as any).til ??
							(row as any).Til;
						if (recipient) (meta as any).recipient = recipient;
						const sender =
							(row as any).sender ??
							(row as any).Sender ??
							(row as any).avsender ??
							(row as any).Avsender ??
							(row as any).fra ??
							(row as any).Fra ??
							(row as any).from ??
							(row as any).From;
						if (sender) (meta as any).sender = sender;
						const programId =
							(row as any).programId ??
							(row as any).program_id ??
							(row as any).ProgramId ??
							(row as any).program ??
							(row as any).Program;
						if (programId) (meta as any).programId = programId;
						const programName =
							(row as any).programName ??
							(row as any).program_name ??
							(row as any).ProgramName;
						if (programName) (meta as any).programName = programName;
						if (row.signature) (meta as any).signature = row.signature;
						if (Object.keys(meta).length > 0) metaMap.set(sig, meta);
					}
					if (debugMap.size > 0 || metaMap.size > 0) {
						setRows(
							(prev) =>
								prev?.map((row) => {
									const sig = row.signature ?? extractSigFromNotat(row.Notat);
									const debugTx = sig ? debugMap.get(sig) : undefined;
									const meta = sig ? metaMap.get(sig) : undefined;
									if (!debugTx && !meta) return row;
									return {
										...row,
										...(meta ?? {}),
										...(debugTx ? { debugTx } : {})
									};
								}) ?? null
						);
					}
				}
			} catch {
				// Ignore debug rehydration failures.
			}
		},
		[address, extractSigFromNotat, parseCsvToRows]
	);

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

	const buildCsvFromRows = useCallback(
		(inputRows: KSPreviewRow[], currentOverrides: OverrideMaps) => {
			const tokenMapRaw = currentOverrides?.symbols ?? {};
			const marketMap = currentOverrides?.markets ?? {};
			const normTokenMap: Record<string, string> = {};
			for (const [from, to] of Object.entries(tokenMapRaw)) {
				const fromKey = currencyCode(from);
				const toVal = currencyCode(to);
				if (fromKey && toVal) normTokenMap[fromKey] = toVal;
			}

			const rowsForCsv: KSRow[] = inputRows.map((r) => {
				const inn = r["Inn-Valuta"];
				const ut = r["Ut-Valuta"];
				const mkt = r.Marked;
				const innNew = inn && normTokenMap[inn] ? normTokenMap[inn] : inn;
				const utNew = ut && normTokenMap[ut] ? normTokenMap[ut] : ut;
				const mktNew =
					mkt && marketMap[mkt] !== undefined ? marketMap[mkt]! : mkt;

				return {
					Tidspunkt: r.Tidspunkt,
					Type: r.Type,
					Inn: r.Inn,
					"Inn-Valuta": innNew,
					Ut: r.Ut,
					"Ut-Valuta": utNew,
					Gebyr: r.Gebyr,
					"Gebyr-Valuta": r["Gebyr-Valuta"],
					Marked: mktNew,
					Notat: r.Notat
				};
			});

			return rowsToCSV(rowsForCsv);
		},
		[]
	);

	function payloadKeyFromPayload(payload: Payload) {
		return JSON.stringify({
			address: payload.address,
			fromISO: payload.fromISO ?? null,
			toISO: payload.toISO ?? null,
			includeNFT: payload.includeNFT ?? false,
			useOslo: payload.useOslo ?? false,
			dustMode: payload.dustMode ?? "off",
			dustThreshold: payload.dustThreshold ?? null,
			dustInterval: payload.dustInterval ?? "day"
		});
	}
	function payloadKeyFromVersion(v: CsvVersion) {
		return JSON.stringify({
			address: v.address,
			fromISO: v.from_iso ?? null,
			toISO: v.to_iso ?? null,
			includeNFT: v.include_nft ?? false,
			useOslo: v.use_oslo ?? false,
			dustMode: v.dust_mode ?? "off",
			dustThreshold:
				v.dust_threshold !== undefined && v.dust_threshold !== null
					? String(v.dust_threshold)
					: null,
			dustInterval: v.dust_interval ?? "day"
		});
	}

	const fetchCsvVersionsForAddress = useCallback(
		async (
			addr: string,
			opts?: {
				payload?: Payload;
			}
		) => {
			if (!isAuthed || !isProbablySolanaAddress(addr)) {
				setCsvVersions([]);
				setCsvVersionId(null);
				setCsvNotice(null);
				prevCsvVersionsRef.current = [];
				return;
			}
			const res = await fetch(
				`/api/csvs?address=${encodeURIComponent(addr)}&format=list`
			);
			if (!res.ok) return;
			const j = await res.json();
			const list: CsvVersion[] = Array.isArray(j?.data) ? j.data : [];
			setCsvVersions(list);
			setCsvVersionId(list[0]?.id ?? null);

			if (opts?.payload) {
				const key = payloadKeyFromPayload(opts.payload);
				const prevList = prevCsvVersionsRef.current;
				const prevMatch = prevList.find(
					(v) => payloadKeyFromVersion(v) === key
				);
				const nextMatch = list.find(
					(v) => payloadKeyFromVersion(v) === key
				);
				if (!prevMatch && nextMatch) {
					setCsvNotice(
						tr({
							no: "Ny CSV generert for denne lommeboken.",
							en: "New CSV generated for this wallet."
						})
					);
				} else if (prevMatch?.partial && nextMatch && !nextMatch.partial) {
					setCsvNotice(
						tr({
							no: "Ufullstendig skann fullført.",
							en: "Incomplete scan completed."
						})
					);
				} else if (nextMatch) {
					setCsvNotice(
						tr({
							no: "CSV oppdatert for denne lommeboken.",
							en: "CSV updated for this wallet."
						})
					);
				}
			} else {
				setCsvNotice(null);
			}

			prevCsvVersionsRef.current = list;
		},
		[isAuthed, tr]
	);

	useEffect(() => {
		let active = true;
		(async () => {
			const addr = address.trim();
			if (!active) return;
			await fetchCsvVersionsForAddress(addr);
		})().catch(() => undefined);
		return () => {
			active = false;
		};
	}, [address, isAuthed, fetchCsvVersionsForAddress]);

	const saveGeneratedCsv = useCallback(
		async (
			csvText: string,
			partialOverride?: boolean,
			scanSessionOverride?: string | null
		) => {
			if (!isAuthed || !lastPayloadRef.current) return;
			const payload = lastPayloadRef.current;
			const counts = lastCountsRef.current;
			const rawCount = counts?.rawCount ?? (rows ? rows.length : undefined);
			const processedCount =
				counts?.processedCount ?? (rows ? rows.length : undefined);
			const partialValue =
				typeof partialOverride === "boolean" ? partialOverride : partialResult;
			await fetch("/api/csvs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					address: payload.address,
					label: payload.walletName ?? null,
					csv: csvText,
					rawCount,
					processedCount,
					partial: partialValue,
					scanSessionId:
						scanSessionOverride !== undefined
							? scanSessionOverride
							: scanSessionId,
					fromISO: payload.fromISO ?? null,
					toISO: payload.toISO ?? null,
					includeNFT: payload.includeNFT ?? false,
					useOslo: payload.useOslo ?? false,
					dustMode: payload.dustMode ?? null,
					dustThreshold: payload.dustThreshold ?? null,
					dustInterval: payload.dustInterval ?? null
				})
			}).catch(() => undefined);
			await fetchCsvVersionsForAddress(payload.address, { payload });
		},
		[isAuthed, partialResult, rows, scanSessionId, fetchCsvVersionsForAddress]
	);

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

	const isCreditError =
		typeof error === "string" &&
		(error.toLowerCase().includes("not enough tx credits") ||
			error.toLowerCase().includes("ikke nok tx credits"));

	const localizeStreamLog = useCallback(
		(msg: string) => {
			if (locale !== "en") return msg;
			let out = msg;
			out = out.replace(
				"Henter token-kontoer (ATAer)",
				"Fetching token accounts (ATAs)"
			);
			out = out.replace("Henter token metadata", "Fetching token metadata");
			out = out.replace("Skanner hovedadresse", "Scanning main address");
			out = out.replace("Skanner ATAer", "Scanning ATAs");
			out = out.replace(
				/Fant (\d+) tilknyttede token-kontoer \(ATAer\)\. Skanner alle for å få med SPL-bevegelser\./,
				"Found $1 associated token accounts (ATAs). Scanning all to include SPL movements."
			);
			return out;
		},
		[locale]
	);

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
					? tr({
							no: `Henter beholdning for ${e.detail.address} …`,
							en: `Fetching holdings for ${e.detail.address} …`
						})
					: tr({ no: "Henter beholdning …", en: "Fetching holdings …" })
			);
		};
		const onSuccess = (e: any) => {
			const n = e?.detail?.count ?? 0;
			pushLog(
				tr({
					no: `Beholdning oppdatert: ${n} aktiva.`,
					en: `Holdings updated: ${n} assets.`
				})
			);
		};
		const onError = (e: any) => {
			const msg = e?.detail?.error || "Ukjent feil";
			pushLog(
				tr({
					no: `❌ Beholdning-feil: ${msg}`,
					en: `❌ Holdings error: ${msg}`
				})
			);
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
	}, [pushLog, tr]);

	// Calendar popover
	const [calOpen, setCalOpen] = useState(false);
	const [calMonth, setCalMonth] = useState<Date | undefined>(undefined);
	const today = new Date();

	// Load auth + history on mount
	useEffect(() => {
		let active = true;
		(async () => {
			const { data: userData } = await supabase.auth.getUser();
			if (!active) return;
			const authed = !!userData?.user;
			setIsAuthed(authed);
			if (!authed) return;
			const res = await fetch("/api/addresses");
			if (!active) return;
			if (res.ok) {
				const j = await res.json();
				const list: AddressHistoryItem[] = Array.isArray(j?.data)
					? j.data
							.filter((r: any) => r?.address)
							.map((r: any) => ({
								address: r.address,
								label: r.label ?? null
							}))
					: [];
				setAddrHistory(list.slice(0, HISTORY_MAX));
			}
		})();
		return () => {
			active = false;
		};
	}, [supabase]);

	useEffect(() => {
		let active = true;
		(async () => {
			const csvId = searchParams.get("csvId")?.trim();
			const addr = searchParams.get("address")?.trim();
			if (!isAuthed) return;
			if (!csvId && !addr) return;
			if (loadedFromParamsRef.current) return;
			const query = csvId
				? `id=${encodeURIComponent(csvId)}`
				: `address=${encodeURIComponent(addr!)}`;
			if (!active) return;
			await loadCsvPreview(query);
			loadedFromParamsRef.current = true;
		})().catch(() => undefined);
		return () => {
			active = false;
		};
	}, [isAuthed, loadCsvPreview, searchParams]);
	function saveHistory(list: AddressHistoryItem[]) {
		setAddrHistory(list);
	}
	async function rememberAddress(addr: string) {
		const a = addr.trim();
		if (!isProbablySolanaAddress(a)) return; // avoid garbage
		const existing = addrHistory.find((x) => x.address === a);
		const label = walletName.trim() || existing?.label || null;
		const next: AddressHistoryItem[] = [
			{ address: a, label },
			...addrHistory.filter((x) => x.address !== a)
		].slice(0, HISTORY_MAX);
		saveHistory(next);
		if (!isAuthed) return;
		await fetch("/api/addresses", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				address: a,
				label
			})
		}).catch(() => undefined);
	}
	async function pickAddress(addr: string) {
		resetPreview();
		setAddress(addr);
		const match = addrHistory.find((x) => x.address === addr);
		setWalletName(match?.label ?? "");
		setAddrMenuOpen(false);
	}
	async function removeAddress(addr: string) {
		saveHistory(addrHistory.filter((x) => x.address !== addr));
		if (!isAuthed) return;
		await fetch("/api/addresses", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ address: addr })
		}).catch(() => undefined);
	}
	async function clearHistory() {
		saveHistory([]);
		if (!isAuthed) return;
		await fetch("/api/addresses", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ all: true })
		}).catch(() => undefined);
	}

	const filteredHistory = useMemo(() => {
		const q = address.trim().toLowerCase();
		if (!q) return addrHistory;
		const starts = addrHistory.filter((a) =>
			a.address.toLowerCase().startsWith(q)
		);
		const contains = addrHistory.filter(
			(a) => !starts.includes(a) && a.address.toLowerCase().includes(q)
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
	function getScanSessionId() {
		if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
			return crypto.randomUUID();
		}
		return `scan_${Math.random().toString(36).slice(2)}_${Date.now()}`;
	}
	function q(s?: string) {
		return `"${String(s ?? "").replace(/"/g, '\\"')}"`;
	}

	async function startScan(payload: Payload) {
		if (!isAuthed) {
			setError(
				tr({
					no: "Du må være innlogget for å generere CSV-er.",
					en: "You must be signed in to generate CSVs."
				})
			);
			setErrorCta(null);
			setCreditsSpent(null);
			setPartialResult(false);
			return;
		}

		clearLog();

		const parsed = schema.safeParse(payload);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Invalid input");
			setErrorCta(null);
			setCreditsSpent(null);
			setPartialResult(false);
			pushLog(tr({ no: "❌ Ugyldig input", en: "❌ Invalid input" }));
			setLogOpen(true);
			return;
		}

		const payloadKey = payloadKeyFromPayload(parsed.data);
		const shouldReuseSession =
			lastPayloadKeyRef.current === payloadKey && !!scanSessionIdRef.current;
		const nextSessionId = shouldReuseSession
			? scanSessionIdRef.current
			: getScanSessionId();
		setScanSessionIdSafe(nextSessionId);
		lastPayloadKeyRef.current = payloadKey;

		const freshStatus = shouldReuseSession ? await refreshBilling() : null;
		const status = freshStatus ?? billingStatus;
		const availableCredits =
			(status?.freeRemaining ?? 0) + (status?.creditsRemaining ?? 0);
		const hasKnownCredits =
			status !== null &&
			status.freeRemaining !== undefined &&
			status.creditsRemaining !== undefined;
		if (shouldReuseSession && hasKnownCredits && availableCredits <= 0) {
			const msg = tr({
				no: "Ikke nok TX Credits til å fortsette skannet.",
				en: "Not enough TX Credits to continue the scan."
			});
			setError(msg);
			setErrorCta({
				label: tr({ no: "Topp opp", en: "Top up" }),
				href: "/pricing"
			});
			setCreditsSpent(null);
			setPartialResult(true);
			pushLog(tr({ no: "⚠️ Ikke nok TX Credits. Topp opp for å fortsette.", en: "⚠️ Not enough TX Credits. Top up to continue." }));
			setLogOpen(true);
			return;
		}

		setError(null);
		setErrorCta(null);
		setOk(false);
		setRows(null);
		setCreditsSpent(null);
		setPartialResult(false);

		const rangeLabel = formatDateRange(payload.fromISO, payload.toISO);
		pushLog(
			(shouldReuseSession
				? tr({ no: "Fortsetter skann", en: "Continuing scan" })
				: tr({ no: "Ny sjekk", en: "New check" })) +
				` ${q(payload.walletName)} ${q(payload.address)}` +
				(rangeLabel ? ` — ${rangeLabel}` : "")
		);
		setLogOpen(true);
		if (shouldReuseSession) {
			pushLog(
				tr({
					no: "Fortsetter forrige skann. Totalt antall vises først når hele perioden er skannet.",
					en: "Continuing previous scan. Total count is shown once the full period is scanned."
				})
			);
		}

		await rememberAddress(parsed.data.address);

		const ctrl = new AbortController();
		abortRef.current = ctrl;

		setLoading(true);
		setCreditsSpent(null);
		setPartialResult(false);
		let pendingErrorCta: { label: string; href: string } | null = null;
		try {
			pushLog(
				tr({
					no: "Starter sjekk… dette kan ta noen minutter for store lommebøker.",
					en: "Starting scan… this can take a few minutes for large wallets."
				})
			);
			const res = await fetch("/api/kryptosekken?format=ndjson", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...parsed.data,
					scanSessionId: nextSessionId
				}),
				signal: ctrl.signal
			});

			if (!res.ok || !res.body) {
				const text = await res.text().catch(() => "");
				let errMsg = res.statusText;
				try {
					const j = text ? JSON.parse(text) : null;
					errMsg =
						(typeof j?.error === "string" && j.error) ||
						(typeof j?.message === "string" && j.message) ||
						errMsg;
					pendingErrorCta =
						j?.cta && typeof j.cta?.href === "string" ? j.cta : null;
				} catch {
					errMsg = text?.trim()?.slice(0, 300) || errMsg;
				}
				errMsg = normalizeCreditError(errMsg);
				pushLog(tr({ no: "❌ API-feil:", en: "❌ API error:" }) + ` ${errMsg}`);
				throw new Error(errMsg);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nlIndex: number;
				while ((nlIndex = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, nlIndex).trim();
					buf = buf.slice(nlIndex + 1);
					if (!line) continue;
					try {
						const evt = JSON.parse(line);
						if (evt.type === "log") {
							pushLog(localizeStreamLog(evt.message));
						} else if (evt.type === "error") {
							const msgRaw =
								typeof evt.error === "string" && evt.error
									? evt.error
									: "Something went wrong";
							const msg = normalizeCreditError(msgRaw);
							setError(msg);
							setErrorCta(
								evt?.cta && typeof evt.cta?.href === "string" ? evt.cta : null
							);
							if (msgRaw.toLowerCase().includes("not enough tx credits")) {
								window.dispatchEvent(new Event("sol2ks:billing:update"));
							}
							pushLog(tr({ no: "❌ Feil:", en: "❌ Error:" }) + ` ${msg}`);
						} else if (evt.type === "page") {
							const prefix =
								evt.kind === "main"
									? tr({ no: "Hovedadresse", en: "Main address" })
									: `ATA ${evt.idx + 1}/${evt.totalATAs}`;
							pushLog(
								`${prefix}: ${tr({ no: "side", en: "page" })} ${evt.page}`
							);
						} else if (evt.type === "addrDone") {
							const prefix =
								evt.kind === "main"
									? tr({ no: "Hovedadresse", en: "Main address" })
									: `ATA ${evt.idx + 1}/${evt.totalATAs}`;
							pushLog(
								tr({ no: "Ferdig", en: "Done" }) +
									` — ${prefix}: ${evt.pages} ${tr({
										no: "sider",
										en: "pages"
									})} (${evt.addressShort})`
							);
						} else if (evt.type === "done") {
							const j = evt.data as {
								rowsPreview: KSPreviewRow[];
								count: number;
								rawCount: number;
								totalRaw?: number;
								totalLogged?: number;
								newRaw?: number;
								newLogged?: number;
								partial?: boolean;
								fromCache?: boolean;
								chargedCredits?: number;
							};
							setRows(j.rowsPreview || []);
							lastPayloadRef.current = parsed.data;
							lastCountsRef.current = {
								rawCount: j.rawCount,
								processedCount: j.count
							};
							setErrorCta(null);
							if (j.rowsPreview?.length) {
								const csvAuto = buildCsvFromRows(j.rowsPreview, overrides);
								await saveGeneratedCsv(
									csvAuto,
									Boolean(j.partial),
									j.partial ? nextSessionId : null
								);
							}
							setOk(true);
							setCreditsSpent(j.fromCache ? null : (j.chargedCredits ?? null));
							setPartialResult(Boolean(j.partial));
							if (!j.partial) {
								setScanSessionIdSafe(null);
								lastPayloadKeyRef.current = null;
							}
							window.dispatchEvent(new Event("sol2ks:billing:update"));
							const totalRaw = j.totalRaw ?? j.rawCount;
							const totalLogged = j.totalLogged ?? j.count;
							const newRaw = j.newRaw ?? totalRaw;
							const newLogged = j.newLogged ?? totalLogged;
							if (totalRaw !== totalLogged || newRaw !== totalRaw) {
								pushLog(
									tr({
										no: `Nye rå: ${newRaw}.`,
										en: `New raw: ${newRaw}.`
									})
								);
								pushLog(
									tr({
										no: `Total rå: ${totalRaw}.`,
										en: `Total raw: ${totalRaw}.`
									})
								);
								pushLog(
									tr({
										no: `Nye loggført: ${newLogged}.`,
										en: `New logged: ${newLogged}.`
									})
								);
								pushLog(
									tr({
										no: `Total loggført: ${totalLogged}.`,
										en: `Total logged: ${totalLogged}.`
									})
								);
							} else {
								pushLog(
									tr({
										no: `Transaksjoner funnet: ${totalLogged}.`,
										en: `Transactions found: ${totalLogged}.`
									})
								);
							}
							pushLog(
								tr({
									no: `✅ ${j.count} transaksjoner loggført.`,
									en: `✅ ${j.count} transactions logged.`
								})
							);
							if (!j.partial) {
								pushLog(
									tr({
										no: "Alle transaksjoner i perioden er funnet. Full rapport er generert.",
										en: "All transactions in the period have been found. A full report has been generated."
									})
								);
							}
							if (!j.fromCache && typeof j.chargedCredits === "number") {
								pushLog(
									tr({
										no: `TX Credits brukt ${j.chargedCredits}.`,
										en: `TX Credits spent ${j.chargedCredits}.`
									})
								);
							}
						}
					} catch {
						// ignore bad chunk
					}
				}
			}
		} catch (err: any) {
			if (err?.name === "AbortError") {
				pushLog(
					tr({ no: "⏹️ Avbrutt av bruker.", en: "⏹️ Cancelled by user." })
				);
			} else {
				const messageRaw =
					err instanceof Error
						? err.message
						: typeof err === "string"
							? err
							: "Something went wrong";
				const message = normalizeCreditError(messageRaw);
				setError(message);
				setErrorCta(pendingErrorCta);
				setCreditsSpent(null);
				setPartialResult(false);
			}
		} finally {
			setLoading(false);
			abortRef.current = null;
		}
	}

	/* ========== Streamed preview with progress + cancel ========== */
	async function onCheckWallet(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		await startScan(buildPayload());
	}

	function onCancel() {
		if (!abortRef.current) return;
		abortRef.current.abort();
		abortRef.current = null;
		setLoading(false);
		setCreditsSpent(null);
		setPartialResult(false);
	}

	async function downloadCSV(currentOverrides: OverrideMaps) {
		if (!isAuthed) {
			setError(
				tr({
					no: "Du må være innlogget for å generere CSV-er.",
					en: "You must be signed in to generate CSVs."
				})
			);
			return;
		}
		if (!rows || !lastPayloadRef.current) return;
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

			const res = await fetch("/api/kryptosekken?format=csv", {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "text/csv" },
				body: JSON.stringify({
					...lastPayloadRef.current,
					overrides: currentOverrides,
					clientEdits
				})
			});

			if (!res.ok) {
				const j = await res.json().catch(() => ({ error: "Feil" }));
				throw new Error(j.error || res.statusText);
			}
			const blob = await res.blob();
			const csvText = await blob.text();
			await saveGeneratedCsv(csvText);
			const a = document.createElement("a");
			const dlUrl = URL.createObjectURL(blob);
			a.href = dlUrl;
			a.download = `sol2ks_${lastPayloadRef.current.address}.csv`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(dlUrl);
			pushLog(
				tr({
					no: "✅ CSV klar (med redigeringer).",
					en: "✅ CSV ready (with edits)."
				})
			);
		} catch (err: unknown) {
			const message =
				err instanceof Error
					? err.message
					: typeof err === "string"
						? err
						: "Something went wrong";
			setError(message);
			setErrorCta(null);
		}
	}

	// Reset
	function onReset() {
		formRef.current?.reset();
		setRows(null);
		setError(null);
		setErrorCta(null);
		setCreditsSpent(null);
		setPartialResult(false);
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

	const hasRows = rows !== null;
	const csvOptions = useMemo(
		() =>
			csvVersions.map((v) => {
				const baseLabel =
					formatDateRange(v.from_iso, v.to_iso) ||
					tr({ no: "Uten tidsrom", en: "No range" });
				const suffix = v.partial
					? tr({ no: " (Ufullstendig)", en: " (Incomplete)" })
					: "";
				return {
					value: v.id,
					label: `${baseLabel}${suffix}`
				};
			}),
		[csvVersions, formatDateRange, tr]
	);
	const selectedCsv = useMemo(
		() => csvVersions.find((v) => v.id === csvVersionId) ?? null,
		[csvVersions, csvVersionId]
	);

	const openSelectedCsv = useCallback(async () => {
		if (!csvVersionId) return;
		await loadCsvPreview(`id=${encodeURIComponent(csvVersionId)}`);
	}, [csvVersionId, loadCsvPreview]);

	const continueSelectedCsv = useCallback(async () => {
		if (!csvVersionId) return;
		await loadCsvPreview(`id=${encodeURIComponent(csvVersionId)}`, {
			skipDebug: true
		});
		if (lastPayloadRef.current) {
			await startScan(lastPayloadRef.current);
		}
	}, [csvVersionId, loadCsvPreview, startScan]);

	// Shared card class (proper light/dark)
	const cardCn =
		"rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 ring-1 ring-slate-300/80 dark:ring-white/10";

	return (
		<main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
			<div className="mx-auto max-w-6xl px-4 pt-20 sm:pt-24 pb-10 sm:pb-16">
				<div className="mb-10">
					<div className="flex items-center justify-between gap-4">
						<div>
							<h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
								{tr({ no: "Lommebok Skanner", en: "Wallet Scanner" })}
							</h1>
							<p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300">
								{tr({
									no: "Lim inn en Solana addresse og velg tidsrom for å sjekke historikken.",
									en: "Paste a Solana address and select a time range to check the history."
								})}
							</p>
						</div>
						<HiOutlineSearch className="h-12 w-12 sm:h-16 sm:w-16 text-slate-600 dark:text-slate-300" />
					</div>
				</div>

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
								{tr({ no: "Lommebok addresse", en: "Wallet" })}
							</label>
							<div className="grid gap-3 sm:grid-cols-[1fr_280px]">
								{/* Address */}
								<div className="relative">
									<div className="relative">
										<IoWalletOutline className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
										<input
											ref={addrInputRef}
											name="address"
											required
											autoComplete="off"
											placeholder={tr({
												no: "F.eks. 7xKX3yF1Z5g6n7m8p9q2…",
												en: "e.g. 7xKX3yF1Z5g6n7m8p9q2…"
											})}
											value={address}
											onChange={(e) => {
												resetPreview();
												setAddress(e.target.value);
												setAddrMenuOpen(true);
											}}
											onFocus={() => setAddrMenuOpen(true)}
											onBlur={() =>
												setTimeout(() => setAddrMenuOpen(false), 120)
											}
											className="block w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-11 pr-24 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
										/>

										{/* right-side actions: clear, history */}
										<div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
											{/* quick clear */}
											{hasAddressInput && (
												<button
													type="button"
													aria-label={tr({ no: "Tøm felt", en: "Clear field" })}
													onMouseDown={(e) => e.preventDefault()}
													onClick={() => {
														setAddress("");
														resetPreview();
														setAddrMenuOpen(false);
														setTimeout(() => addrInputRef.current?.focus(), 0);
													}}
													className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 h-6 w-6"
													title={tr({ no: "Tøm felt", en: "Clear field" })}
												>
													<FiX className="h-4 w-4" />
												</button>
											)}
											{/* history */}
											<button
												type="button"
												aria-label={tr({
													no: "Adressehistorikk",
													en: "Address history"
												})}
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => setAddrMenuOpen((v) => !v)}
												className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 h-6 w-6"
												title={tr({
													no: "Adressehistorikk",
													en: "Address history"
												})}
											>
												<FiClock className="h-4 w-4" />
											</button>
										</div>
									</div>

									{isAuthed && csvVersions.length > 0 && csvVersionId && (
										<div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200/70 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
											<span className="font-medium">
												{tr({
													no: "Genererte CSV-er for denne lommeboken funnet.",
													en: "Generated CSVs found for this wallet."
												})}
											</span>
											<div className="ml-auto flex items-center gap-2">
												<StyledSelect
													value={csvVersionId}
													onChange={(next) => setCsvVersionId(next)}
													options={csvOptions}
													buttonClassName="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs text-indigo-700 shadow-sm transition hover:bg-indigo-50 dark:border-indigo-500/40 dark:bg-white/5 dark:text-indigo-200 dark:hover:bg-white/10"
													menuClassName="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden"
													optionClassName="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 whitespace-nowrap"
													labelClassName="truncate whitespace-nowrap"
													ariaLabel={tr({ no: "Velg CSV", en: "Select CSV" })}
													minWidthLabel={
														csvOptions[0]?.label ||
														tr({ no: "Uten tidsrom", en: "No range" })
													}
												/>
												{selectedCsv?.partial ? (
													<button
														type="button"
														onClick={continueSelectedCsv}
														className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold transition bg-indigo-600 text-white hover:bg-indigo-500"
														title={tr({ no: "Fortsett skann", en: "Continue scan" })}
														aria-label={tr({ no: "Fortsett skann", en: "Continue scan" })}
													>
														<FiEye className="h-3.5 w-3.5" />
														{tr({ no: "Fortsett skann", en: "Continue scan" })}
													</button>
												) : (
													<button
														type="button"
														onClick={openSelectedCsv}
														className="inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-white px-2 py-1 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/40 dark:bg-white/5 dark:text-indigo-200 dark:hover:bg-white/10"
														title={tr({ no: "Åpne", en: "Open" })}
														aria-label={tr({ no: "Åpne", en: "Open" })}
													>
														<FiEye className="h-4 w-4" />
													</button>
												)}
											</div>
										</div>
									)}

									{/* Dropdown history */}
									{addrMenuOpen && (addrHistory.length > 0 || address) && (
										<div className="absolute left-0 right-0 z-30 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
											{filteredHistory.length > 0 ? (
												<ul className="max-h-64 overflow-auto text-sm">
													{filteredHistory.map((item) => (
														<li
															key={item.address}
															className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5"
														>
															<button
																type="button"
																onMouseDown={(e) => e.preventDefault()}
																onClick={() => pickAddress(item.address)}
																className="truncate text-left text-slate-700 dark:text-slate-200"
																title={item.address}
															>
																{item.address}
																{/* tiny name hint */}
																{item.label ? (
																	<span className="ml-2 rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-300">
																		{item.label}
																	</span>
																) : null}
															</button>
															<button
																type="button"
																aria-label={tr({
																	no: "Fjern fra historikk",
																	en: "Remove from history"
																})}
																onMouseDown={(e) => e.preventDefault()}
																onClick={() => removeAddress(item.address)}
																className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-600"
															>
																<FiTrash2 className="h-4 w-4" />
															</button>
														</li>
													))}
												</ul>
											) : (
												<div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
													{tr({
														no: "Ingen treff i historikk",
														en: "No matches in history"
													})}
												</div>
											)}
											<div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
												<span>
													{tr({
														no: `${addrHistory.length} lagret`,
														en: `${addrHistory.length} saved`
													})}
												</span>
												<button
													type="button"
													onMouseDown={(e) => e.preventDefault()}
													onClick={clearHistory}
													className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-white dark:hover:bg-white/10"
												>
													<FiTrash2 className="h-3 w-3" />
													{tr({ no: "Tøm historikk", en: "Clear history" })}
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
											placeholder={tr({
												no: "Navn (valgfritt)",
												en: "Name (optional)"
											})}
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
													? tr({ no: "Åpne i Solscan", en: "Open in Solscan" })
													: tr({
															no: "Skriv inn en adresse først",
															en: "Enter an address first"
														})
											}
										>
											<IoOpenOutline className="h-[17px] w-[17px]" />
										</Link>
									</div>

									<p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
										{tr({
											no: "Vises i ",
											en: "Shown in "
										})}
										<b>Notat</b>
										{tr({
											no: " (eks. ",
											en: " (e.g. "
										})}
										<b>{tr({ no: "MIN WALLET", en: "MY WALLET" })}</b>
										).
									</p>
								</div>
							</div>

							{/* Timespan (dropdown calendar + presets) */}
							<div className="mt-6">
								<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
									<label className="block text-sm font-medium text-slate-800 dark:text-slate-200">
										{tr({ no: "Tidsrom", en: "Date range" })}
									</label>
									<div className="text-[11px] text-slate-500 dark:text-slate-400">
										{tr({
											no: "Avgrenser transaksjoner til valgt periode.",
											en: "Limits transactions to the selected period."
										})}
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
												{formatRangeLabel(tr, locale, range)}
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
														title={tr({
															no: "Gå til Fra-måned",
															en: "Go to From month"
														})}
													>
														<span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-400/10 px-2 py-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-400/20">
															<span className="h-2 w-2 rounded-full bg-indigo-600" />
															{tr({ no: "Fra", en: "From" })}:{" "}
															<b>{nice(range?.from)}</b>
														</span>
													</button>
													<button
														type="button"
														className="text-[11px] text-slate-600 dark:text-slate-300"
														onClick={() => range?.to && setCalMonth(range.to)}
														title={tr({
															no: "Gå til Til-måned",
															en: "Go to To month"
														})}
													>
														<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-400/10 px-2 py-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-400/20">
															<span className="h-2 w-2 rounded-full bg-emerald-600" />
															{tr({ no: "Til", en: "To" })}:{" "}
															<b>{nice(range?.to)}</b>
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
														{tr({ no: "Lukk", en: "Close" })}
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
											{tr({ no: "Siste 7 dager", en: "Last 7 days" })}
										</button>
										<button
											type="button"
											onClick={() => presetDays(30)}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											{tr({ no: "Siste 30 dager", en: "Last 30 days" })}
										</button>
										<button
											type="button"
											onClick={ytd}
											title={tr({
												no: "Hittil i år — Fra 1. januar til i dag",
												en: "Year to date — From Jan 1 to today"
											})}
											aria-label={tr({
												no: "Hittil i år (Året så langt)",
												en: "Year to date"
											})}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											{tr({ no: "Hittil i år", en: "Year to date" })}
										</button>
										<button
											type="button"
											onClick={lastYearWhole}
											title={tr({
												no: "Hele fjoråret — Fra 1. januar til 31. desember i fjor",
												en: "Last year — From Jan 1 to Dec 31"
											})}
											aria-label={tr({ no: "Hele fjoråret", en: "Last year" })}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											{tr({ no: "Hele fjoråret", en: "Last year" })}
										</button>
										<button
											type="button"
											onClick={clearDates}
											className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/10"
										>
											{tr({ no: "Nullstill", en: "Reset" })}
										</button>
									</div>
								</div>

								{/* Tidssone toggle */}
								<div className="mt-3 inline-flex flex-wrap items-center gap-3">
									<Switch
										checked={useOslo}
										onChange={setUseOslo}
										label={tr({
											no: "Norsk tid (Europe/Oslo)",
											en: "Norway time (Europe/Oslo)"
										})}
									/>
									<span className="text-sm font-medium text-slate-800 dark:text-slate-200">
										{tr({
											no: "Norsk tid (Europe/Oslo)",
											en: "Norway time (Europe/Oslo)"
										})}
									</span>
									<span className="text-[11px] text-slate-500 dark:text-slate-400">
										{tr({
											no: "CSV tidsstempler skrives i ",
											en: "CSV timestamps are written in "
										})}
										{useOslo
											? tr({
													no: "Norsk tid (UTC+01:00 Europe/Oslo)",
													en: "Norway time (Europe/Oslo)"
												})
											: "UTC"}
										.
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
											label={tr({
												no: "Inkluder NFT-overføringer",
												en: "Include NFT transfers"
											})}
										/>
										<span className="text-sm font-medium text-slate-800 dark:text-slate-200">
											{tr({
												no: "Inkluder NFT-overføringer",
												en: "Include NFT transfers"
											})}
										</span>
									</div>
									<div className="text-[11px] text-slate-500 dark:text-slate-400">
										{tr({
											no: "Tar med bevegelser av NFT-er. (Ingen prising, kun overføringer.)",
											en: "Includes NFT movements. (No pricing, transfers only.)"
										})}
									</div>
								</div>
							</div>

							{/* Dust section */}
							<div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
								<div className="mb-3 flex items-center justify-between">
									<div className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
										<MdOutlineCleaningServices className="h-4 w-4" />
										{tr({ no: "Støvtransaksjoner", en: "Dust transactions" })}
									</div>

									<div className="relative group">
										<button
											type="button"
											aria-label={tr({
												no: "Hvorfor får jeg så mye støv i SOL?",
												en: "Why am I getting so much SOL dust?"
											})}
											onClick={() =>
												openInfoModal(
													tr({
														no: "Hvorfor så mye “støv” i SOL?",
														en: "Why so much SOL “dust”?"
													}),
													<div>
														<ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
															<li>
																<b>Spam / dusting:</b>{" "}
																{tr({
																	no: "små innbetalinger for å lokke klikk eller spore lommebøker.",
																	en: "tiny deposits used to lure clicks or track wallets."
																})}
															</li>
															<li>
																<b>DEX/protocol refunds:</b>{" "}
																{tr({
																	no: "bitte små rest-lamports/fee-reverseringer etter swaps/tx.",
																	en: "tiny leftover lamports/fee reversals after swaps/tx."
																})}
															</li>
															<li>
																<b>
																	{tr({
																		no: "Konto-livssyklus",
																		en: "Account lifecycle"
																	})}
																	:
																</b>{" "}
																{tr({
																	no: "opprettelse/lukking og ",
																	en: "creation/closure and "
																})}
																<i>rent-exempt</i>{" "}
																{tr({
																	no: "topp-ups kan sende/returnere små SOL-beløp.",
																	en: "top-ups can send/return small SOL amounts."
																})}
															</li>
															<li>
																<b>
																	{tr({
																		no: "Program-interaksjoner",
																		en: "Program interactions"
																	})}
																	:
																</b>{" "}
																{tr({
																	no: "claim/reward/airdrop-skript som sender små beløp for å trigge varsler eller dekke minutt-gebyr.",
																	en: "claim/reward/airdrop scripts that send tiny amounts to trigger notifications or cover min-fees."
																})}
															</li>
															<li>
																<b>
																	{tr({
																		no: "NFT/WSOL-håndtering",
																		en: "NFT/WSOL handling"
																	})}
																	:
																</b>{" "}
																{tr({
																	no: "wrapping/unwrapping og ATA-endringer kan etterlate mikrobeløp.",
																	en: "wrapping/unwrapping and ATA changes can leave micro-amounts."
																})}
															</li>
														</ul>
													</div>
												)
											}
											className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 focus:outline-none"
										>
											<FiInfo className="h-4 w-4" />
										</button>
										<div
											role="tooltip"
											className="pointer-events-none absolute right-0 top-7 z-30 hidden w-[min(92vw,22rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 shadow-xl sm:group-hover:block sm:group-focus-within:block"
										>
											<p className="mb-1 font-medium">
												{tr({
													no: "Hvorfor så mye “støv” i SOL?",
													en: "Why so much SOL “dust”?"
												})}
											</p>
											<ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
												<li>
													<b>Spam / dusting:</b>{" "}
													{tr({
														no: "små innbetalinger for å lokke klikk eller spore lommebøker.",
														en: "tiny deposits used to lure clicks or track wallets."
													})}
												</li>
												<li>
													<b>DEX/protocol refunds:</b>{" "}
													{tr({
														no: "bitte små rest-lamports/fee-reverseringer etter swaps/tx.",
														en: "tiny leftover lamports/fee reversals after swaps/tx."
													})}
												</li>
												<li>
													<b>
														{tr({
															no: "Konto-livssyklus",
															en: "Account lifecycle"
														})}
														:
													</b>{" "}
													{tr({
														no: "opprettelse/lukking og ",
														en: "creation/closure and "
													})}
													<i>rent-exempt</i>{" "}
													{tr({
														no: "topp-ups kan sende/returnere små SOL-beløp.",
														en: "top-ups can send/return small SOL amounts."
													})}
												</li>
												<li>
													<b>
														{tr({
															no: "Program-interaksjoner",
															en: "Program interactions"
														})}
														:
													</b>{" "}
													{tr({
														no: "claim/reward/airdrop-skript som sender små beløp for å trigge varsler eller dekke minutt-gebyr.",
														en: "claim/reward/airdrop scripts that send tiny amounts to trigger notifications or cover min-fees."
													})}
												</li>
												<li>
													<b>
														{tr({
															no: "NFT/WSOL-håndtering",
															en: "NFT/WSOL handling"
														})}
														:
													</b>{" "}
													{tr({
														no: "wrapping/unwrapping og ATA-endringer kan etterlate mikrobeløp.",
														en: "wrapping/unwrapping and ATA changes can leave micro-amounts."
													})}
												</li>
											</ul>
										</div>
									</div>
								</div>

								<div className="grid gap-3 sm:grid-cols-3">
									{/* Mode */}
									<div className="flex flex-col gap-1">
										<label className="text-xs text-slate-600 dark:text-slate-400">
											{tr({ no: "Modus", en: "Mode" })}
										</label>
										<StyledSelect
											value={dustMode}
											onChange={(v) => setDustMode(v)}
											buttonClassName="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
											options={
												[
													{
														value: "off",
														label: tr({ no: "Vis alle", en: "Show all" })
													},
													{
														value: "remove",
														label: tr({ no: "Skjul", en: "Hide" })
													},
													{
														value: "aggregate-signer",
														label: tr({
															no: "Slå sammen fra samme sender",
															en: "Aggregate by sender"
														})
													},
													{
														value: "aggregate-period",
														label: tr({
															no: "Slå sammen periodisk",
															en: "Aggregate by period"
														})
													}
												] as const
											}
											ariaLabel={tr({
												no: "Velg støvmodus",
												en: "Choose dust mode"
											})}
										/>
									</div>

									{/* Threshold */}
									{dustMode !== "off" && (
										<div className="flex flex-col gap-1">
											<label className="text-xs text-slate-600 dark:text-slate-400">
												{tr({ no: "Grense (beløp)", en: "Threshold (amount)" })}
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
												{tr({ no: "Periode", en: "Period" })}
											</label>
											<StyledSelect
												value={dustInterval}
												onChange={(v) => setDustInterval(v)}
												buttonClassName="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/40"
												options={
													[
														{
															value: "day",
															label: tr({ no: "Dag", en: "Day" })
														},
														{
															value: "week",
															label: tr({ no: "Uke", en: "Week" })
														},
														{
															value: "month",
															label: tr({ no: "Måned", en: "Month" })
														},
														{
															value: "year",
															label: tr({ no: "År", en: "Year" })
														}
													] as const
												}
												ariaLabel={tr({
													no: "Velg periode",
													en: "Choose period"
												})}
											/>
										</div>
									)}
								</div>

								{/* Info text – specific per mode */}
								{dustMode === "off" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>{tr({ no: "Vis alle", en: "Show all" })}:</b>{" "}
										{tr({
											no: "Ingen støvbehandling.",
											en: "No dust processing."
										})}
									</p>
								)}
								{dustMode === "remove" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>{tr({ no: "Skjul", en: "Hide" })}:</b>{" "}
										{tr({
											no: "Filtrerer vekk alle overføringer under grensen.",
											en: "Filters out all transfers below the threshold."
										})}{" "}
										<span className="text-amber-700">
											({tr({ no: "Ikke anbefalt", en: "Not recommended" })})
										</span>
									</p>
								)}
								{dustMode === "aggregate-signer" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>
											{tr({
												no: "Slå sammen fra samme sender",
												en: "Aggregate by sender"
											})}
											:
										</b>{" "}
										{tr({ no: "Slår sammen små ", en: "Aggregates small " })}
										<code>Overføring-Inn</code> og <code>Overføring-Ut</code>{" "}
										hver for seg fra hver{" "}
										<i>{tr({ no: "signer-adresse", en: "signer address" })}</i>{" "}
										{tr({
											no: "per ",
											en: "per "
										})}
										<b>
											{tr({
												no: "per valgt periode",
												en: "per selected period"
											})}
										</b>
										.
										{tr({
											no: " Notatet viser hvem som sendte.",
											en: " The note shows who sent it."
										})}
									</p>
								)}
								{dustMode === "aggregate-period" && (
									<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
										<b>
											{tr({
												no: "Slå sammen periodisk",
												en: "Aggregate by period"
											})}
											:
										</b>{" "}
										{tr({ no: "Slår sammen små ", en: "Aggregates small " })}
										<code>Overføring-Inn</code> og <code>Overføring-Ut</code>{" "}
										hver for seg per valgt periode
										{tr({
											no: " (uavhengig av sender).",
											en: " (regardless of sender)."
										})}
									</p>
								)}
							</div>

							{/* Actions */}
							<div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
								<button
									type="submit"
									disabled={loading || !isAuthed}
									className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg hover:from-indigo-700 hover:to-emerald-700 focus:outline-none focus:ring-4 focus:ring-indigo-200/60 dark:focus:ring-indigo-900/40 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto"
								>
									{loading ? (
										<FiLoader className="h-4 w-4 animate-spin" />
									) : (
										<FiEye className="h-4 w-4" />
									)}
									{tr({ no: "Sjekk lommebok", en: "Check wallet" })}
								</button>
								{loading && (
									<button
										type="button"
										onClick={onCancel}
										className="inline-flex  items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm dark:shadow-black/25 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300 active:scale-[0.99] w-full sm:w-auto"
									>
										<FiX className="h-4 w-4" />
										{tr({ no: "Avbryt", en: "Cancel" })}
									</button>
								)}
								<button
									type="button"
									onClick={onReset}
									className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10 active:scale-[0.99] w-full sm:w-auto"
								>
									{tr({ no: "Nullstill", en: "Reset" })}
								</button>

								{error && !isCreditError && (
									<div
										role="status"
										aria-live="polite"
										className="sm:ml-2 text-sm text-red-600 flex flex-wrap items-center gap-2"
									>
										<span>{error}</span>
										{errorCta && (
											<Link
												href={errorCta.href}
												className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 px-3 py-1 text-[11px] font-semibold hover:bg-amber-200/70 dark:hover:bg-amber-500/25"
											>
												{tr({ no: "Topp opp", en: "Top up" })}
											</Link>
										)}
									</div>
								)}
								{!error && !isAuthed && (
									<div className="sm:ml-2 text-sm text-slate-600 dark:text-slate-300">
										<Link
											href="/signin"
											className="text-indigo-600 dark:text-indigo-400 hover:underline"
										>
											{tr({
												no: "Logg inn for å sjekke lommebøker.",
												en: "Sign in to check wallets."
											})}
										</Link>
									</div>
								)}
								{!error && effectiveRows && effectiveRows.length > 0 && (
									<span className="sm:ml-2" />
								)}
								{/* Live log toggle */}
								<div className="sm:ml-auto flex items-center gap-2">
									<div className="relative group">
										<button
											type="button"
											aria-label={tr({
												no: "Hvorfor skanner generatoren bakover i tid?",
												en: "Why does the generator scan backwards in time?"
											})}
											onClick={() =>
												openInfoModal(
													tr({
														no: "Skanning bakover i tid",
														en: "Scanning backwards in time"
													}),
													<div>
														<p className="mb-2 text-slate-700 dark:text-slate-200">
															{tr({
																no: "Solana-APIet leverer transaksjoner i nyeste-rekkefølge. Derfor starter vi fra de nyeste og jobber oss bakover for å finne eldre transaksjoner.",
																en: "The Solana API returns transactions newest-first. We start from the latest and page backwards to find older transactions."
															})}
														</p>
														<ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
															<li>
																{tr({
																	no: "Dette gir raskere forhåndsvisning av nyere aktivitet.",
																	en: "This gives a faster preview of recent activity."
																})}
															</li>
															<li>
																{tr({
																	no: "Ved delvis skann stopper vi når kredittgrensen nås, men kan fortsette senere fra samme punkt.",
																	en: "On partial scans we stop when credit limits are reached, and can continue later from the same point."
																})}
															</li>
														</ul>
													</div>
												)
											}
											className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 focus:outline-none"
										>
											<FiInfo className="h-4 w-4" />
										</button>
										<div
											role="tooltip"
											className="pointer-events-none absolute right-0 top-7 z-30 hidden w-[min(92vw,22rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs text-slate-700 dark:text-slate-300 shadow-xl sm:group-hover:block sm:group-focus-within:block"
										>
											<p className="mb-1 font-medium">
												{tr({
													no: "Skanning bakover i tid",
													en: "Scanning backwards in time"
												})}
											</p>
											<p className="mb-2 text-slate-600 dark:text-slate-300">
												{tr({
													no: "Solana-APIet leverer transaksjoner i nyeste-rekkefølge, så vi starter med de nyeste og går bakover.",
													en: "The Solana API returns transactions newest-first, so we start at the latest and page backwards."
												})}
											</p>
											<ul className="list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-300">
												<li>
													{tr({
														no: "Raskere forhåndsvisning av nyere aktivitet.",
														en: "Faster preview of recent activity."
													})}
												</li>
												<li>
													{tr({
														no: "Delvis skann stopper ved kredittgrense og kan fortsette senere.",
														en: "Partial scans stop at the credit limit and can be resumed later."
													})}
												</li>
											</ul>
										</div>
									</div>
									<button
										type="button"
										onClick={() => setLogOpen((v) => !v)}
										className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10 w-full sm:w-auto justify-center"
										title={tr({ no: "Vis/skjul logg", en: "Show/hide log" })}
									>
										<FiActivity className="h-4 w-4" />
										{logOpen
											? tr({ no: "Skjul logg", en: "Hide log" })
											: tr({ no: "Vis logg", en: "Show log" })}
									</button>
								</div>
							</div>

							{isCreditError && (
								<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
									<div className="flex flex-wrap items-center gap-2">
										<span className="inline-flex items-center gap-1">
											<FiAlertTriangle className="h-3.5 w-3.5" />
											{error}
										</span>
										{errorCta && (
											<Link
												href={errorCta.href}
												className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200 px-3 py-1 text-[11px] font-semibold hover:bg-rose-200/70 dark:hover:bg-rose-500/25"
											>
												{tr({ no: "Topp opp", en: "Top up" })}
											</Link>
										)}
									</div>
								</div>
							)}

							{!error && partialResult && (
								<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
									<div className="flex flex-wrap items-center gap-2">
										<span className="inline-flex items-center gap-1">
											<FiAlertTriangle className="h-3.5 w-3.5" />
											{(billingStatus?.freeRemaining ?? 0) +
												(billingStatus?.creditsRemaining ?? 0) >
											0
												? tr({
														no: "Ufullstendig skann. Klikk «Sjekk lommebok» for å fortsette skannet.",
														en: "Incomplete scan. Click “Check wallet” to continue the scan."
													})
												: tr({
														no: "Ufullstendig skann pga. ikke nok TX Credits. Topp opp for å fullføre.",
														en: "Incomplete scan due to insufficient TX Credits. Top up to complete the scan."
													})}
										</span>
										{(billingStatus?.freeRemaining ?? 0) +
											(billingStatus?.creditsRemaining ?? 0) ===
											0 && (
											<Link
												href="/pricing"
												className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 px-3 py-1 text-[11px] font-semibold hover:bg-amber-200/70 dark:hover:bg-amber-500/25"
											>
												{tr({ no: "Topp opp", en: "Top up" })}
											</Link>
										)}
									</div>
								</div>
							)}

							{/* Live log panel */}
							{logOpen && (
								<div
									ref={logRef}
									className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-white/5 p-3 text-xs text-slate-700 dark:text-slate-200 max-h-40 overflow-auto"
								>
									{logLines.length === 0 ? (
										<div className="text-slate-500 dark:text-slate-400">
											{tr({
												no: "Ingen hendelser ennå.",
												en: "No events yet."
											})}
										</div>
									) : (
										<div className="space-y-2">
											{logLines.length > 0 && (
												<ul className="space-y-1 font-mono">
													{logLines.map((ln, i) => {
														const creditMatch = ln.match(
															/(TX Credits (brukt|spent))\s*(\d+)(.*)$/
														);
														if (creditMatch) {
															const label = creditMatch[1];
															const value = creditMatch[3];
															const tail = creditMatch[4] ?? "";
															const prefix = ln.slice(0, creditMatch.index ?? 0).trim();
															return (
																<li key={i} className="flex items-center gap-1">
																	{prefix ? <span>{prefix}</span> : null}
																	<BsXDiamondFill className="h-3.5 w-3.5 text-amber-500 ml-1" />
																	<span className="tabular-nums">{value}</span>
																	<span>{` ${label}${tail}`}</span>
																</li>
															);
														}
														return (
															<li key={i} className="flex items-center gap-1">
																<span>{ln}</span>
															</li>
														);
													})}
												</ul>
											)}
										</div>
									)}
								</div>
							)}
						</form>
					</ClientOnly>
				</div>

				{/* ========= Card: Current holdings (now always shows even if empty/error) ========= */}
				{address?.trim() && (
					<div className="mt-6">
						<WalletHoldings
							address={address}
							includeNFT={false}
							enabled={ok}
							onLogoMap={(logos) =>
								setSharedLogos((prev) => ({ ...prev, ...logos }))
							}
						/>
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
								walletName={walletName.trim() || undefined}
								address={address.trim() || undefined}
								timeframeLabel={formatRangeLabel(tr, locale, range)}
								prefetchedLogos={sharedLogos}
							/>
						</div>

						{/* ========= Kryptosekken import help (separate card) ========= */}
						<div className="mt-6">
							<KryptosekkenImportCard cardClassName={cardCn} />
						</div>
					</>
				)}

				{/* Footer */}
				<footer className="mt-6 w-full text-center sm:text-left text-xs text-slate-500 dark:text-slate-400">
					{tr({
						no: "Resultatet kan inneholde feil. Kontroller i lommeboken og i Kryptosekken før innlevering.",
						en: "The result may contain errors. Verify in the wallet and in Kryptosekken before filing."
					})}
				</footer>

				{infoModal && (
					<div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/40 p-4">
						<div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-2xl">
							<div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 px-4 py-3">
								<p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
									{infoModal.title}
								</p>
								<button
									type="button"
									onClick={() => setInfoModal(null)}
									className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
									aria-label={tr({ no: "Lukk", en: "Close" })}
								>
									✕
								</button>
							</div>
							<div className="px-4 py-4 text-sm text-slate-700 dark:text-slate-200">
								{infoModal.content}
							</div>
						</div>
					</div>
				)}
			</div>
		</main>
	);
}

export default function CSVGeneratorPage() {
	return (
		<Suspense fallback={<div className="min-h-screen" />}>
			<CSVGeneratorPageInner />
		</Suspense>
	);
}

/* ========== local helpers used only by this file ========== */
function formatRangeLabel(
	tr: (o: { no: string; en: string }) => string,
	locale: "no" | "en",
	r?: DateRange
) {
	if (!r?.from && !r?.to) return tr({ no: "Velg datoer", en: "Choose dates" });
	const dateLocale = locale === "en" ? "en-GB" : "no-NO";
	const fmt = new Intl.DateTimeFormat(dateLocale);
	const f = (d?: Date) => (d ? fmt.format(d) : "–");
	if (r?.from && r?.to) return `${f(r.from)} → ${f(r.to)}`;
	return `${f(r?.from)} → …`;
}
