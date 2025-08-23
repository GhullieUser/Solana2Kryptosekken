// app/components/preview.tsx
"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
	FiExternalLink,
	FiEdit,
	FiCopy,
	FiDownload,
	FiX,
	FiInfo,
	FiMaximize,
	FiMinimize,
	FiFilter
} from "react-icons/fi";

import type { KSRow, KSPreviewRow, OverrideMaps } from "../page";

/* ---------- local helpers & constants (duplicated here for isolation) ---------- */
type IssueKind = "unknown-token" | "unknown-market";
type IssueStatus = "pending" | "renamed" | "ignored";
type Issue = {
	kind: IssueKind;
	key: string;
	count: number;
	sigs: string[];
	status: IssueStatus;
	newName?: string;
};

const PLACEHOLDER_RE = /^TOKEN-[0-9A-Z]{6}$/i;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isPlaceholderSymbol(s?: string) {
	return !!s && (PLACEHOLDER_RE.test(s) || s.toUpperCase() === "UNKNOWN");
}

export const TYPE_OPTIONS = [
	"Handel",
	"Erverv",
	"Inntekt",
	"Tap",
	"Forbruk",
	"Renteinntekt",
	"Overføring-Inn",
	"Overføring-Ut",
	"Gave-Inn",
	"Gave-Ut",
	"Tap-uten-fradrag",
	"Forvaltningskostnad"
] as const;

type KSType = (typeof TYPE_OPTIONS)[number];

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
	if (KNOWN_MARKETS.has(lc)) return false; // known/OK
	if (BASE58_RE.test(m)) return true; // raw program IDs
	if (m.toUpperCase() === "UNKNOWN") return true;
	return false;
}

function parseTidspunkt(t: string): number {
	const [date, time] = t.split(" ");
	const [y, m, d] = (date || "").split("-").map((n) => parseInt(n, 10));
	const [hh = "0", mm = "0", ss = "0"] = (time || "").split(":");
	const dt = new Date(
		y || 1970,
		(m || 1) - 1,
		d || 1,
		parseInt(hh, 10),
		parseInt(mm, 10),
		parseInt(ss, 10)
	);
	return dt.getTime();
}

function extractSig(row: KSPreviewRow): string | undefined {
	if (row.signature) return row.signature;
	const m = row.Notat?.match(/sig:([1-9A-HJ-NP-Za-km-z]+)/);
	return m?.[1];
}

type SortOrder = "desc" | "asc";

/* ---------- small UI bits used inside this component ---------- */
function middleEllipsis(s: string, start = 10, end = 8) {
	if (!s) return "";
	return s.length <= start + end + 1
		? s
		: `${s.slice(0, start)}…${s.slice(-end)}`;
}

function MetaBox({
	label,
	value,
	link
}: {
	label: string;
	value: string;
	link?: string;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-white/10 dark:bg-white/5">
			<div className="min-w-0">
				<div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
					{label}
				</div>
				<div
					className="font-mono text-[12px] text-slate-800 dark:text-slate-200"
					title={value}
				>
					{middleEllipsis(value)}
				</div>
			</div>

			<div className="shrink-0 inline-flex items-center gap-1.5">
				<button
					type="button"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(value);
							setCopied(true);
							setTimeout(() => setCopied(false), 1200);
						} catch {}
					}}
					className="rounded p-1 text-slate-600 hover:bg-white hover:text-slate-900 ring-1 ring-transparent hover:ring-slate-200 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-slate-100"
					aria-label="Kopier"
					title={copied ? "Kopiert!" : "Kopier"}
				>
					<FiCopy className="h-4 w-4" />
				</button>

				{link && (
					<Link
						href={link}
						target="_blank"
						rel="noopener noreferrer"
						className="rounded p-1 text-indigo-600 hover:bg-white hover:text-indigo-700 ring-1 ring-transparent hover:ring-indigo-200 dark:text-indigo-400 dark:hover:bg-white/5 dark:hover:text-indigo-300"
						aria-label="Åpne i explorer"
						title="Åpne i explorer"
					>
						<FiExternalLink className="h-4 w-4" />
					</Link>
				)}
			</div>
		</div>
	);
}

/* full-bleed hover chrome + edit affordance */
function CellChrome({
	children,
	onEdit,
	align = "left",
	title,
	canEdit = true,
	clickToEdit = false,
	showButton = true
}: {
	children: React.ReactNode;
	onEdit: () => void;
	align?: "left" | "right";
	title?: string;
	canEdit?: boolean;
	clickToEdit?: boolean;
	showButton?: boolean;
}) {
	const clickable = canEdit && clickToEdit;
	return (
		<div
			className={`group relative block w-full h-full ${
				align === "right" ? "text-right" : "text-left"
			}`}
			title={title}
			onClick={
				clickable
					? (e) => {
							e.stopPropagation();
							onEdit();
					  }
					: undefined
			}
			role={clickable ? "button" : undefined}
			tabIndex={clickable ? 0 : undefined}
			onKeyDown={
				clickable
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onEdit();
							}
					  }
					: undefined
			}
		>
			<span className="rounded pointer-events-none absolute -inset-x-2 top-1/2 -translate-y-1/2 h-10 z-0 ring-1 ring-transparent group-hover:ring-emerald-300/80 group-hover:bg-emerald-50/50 dark:group-hover:ring-emerald-500/40 dark:group-hover:bg-emerald-500/10 transition" />
			<div
				className={`relative z-10 ${
					align === "right" ? "font-mono tabular-nums" : ""
				}`}
			>
				{children}
			</div>
			{canEdit && showButton && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onEdit();
					}}
					className="absolute right-0 top-1/2 -translate-y-1/2 z-20 hidden group-hover:flex items-center justify-center h-5 w-5 rounded bg-white shadow ring-1 ring-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-900/60 dark:ring-white/10 dark:text-slate-300 dark:hover:bg-slate-800"
					aria-label="Rediger"
				>
					<FiEdit className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
}

function TidspunktCell({
	idxOriginal,
	value,
	openEditCell
}: {
	idxOriginal: number;
	value: string;
	openEditCell: (
		idxOriginal: number,
		field: keyof KSRow,
		currentValue: string
	) => void;
}) {
	const [datePart, timePart = ""] = (value || "").split(" ");
	const canEdit = !!String(value ?? "").trim();
	return (
		<div className="min-w-[4rem]">
			<CellChrome
				onEdit={() => openEditCell(idxOriginal, "Tidspunkt", value ?? "")}
				title={value}
				canEdit={canEdit}
			>
				<div className="leading-tight">
					<div className="font-medium">{datePart || value}</div>
					{timePart ? (
						<div className="text-slate-500 text-[11px] dark:text-slate-400">
							{timePart}
						</div>
					) : null}
				</div>
			</CellChrome>
		</div>
	);
}

function EditableCell({
	idxOriginal,
	field,
	value,
	align = "left",
	title,
	openEditCell
}: {
	idxOriginal: number;
	field: keyof KSRow;
	value: string;
	align?: "left" | "right";
	title?: string;
	openEditCell: (
		idxOriginal: number,
		field: keyof KSRow,
		currentValue: string
	) => void;
}) {
	const isValutaField =
		field === "Inn-Valuta" || field === "Ut-Valuta" || field === "Gebyr-Valuta";
	const isEmpty = !String(value ?? "").trim();

	if (isValutaField && isEmpty) {
		return (
			<CellChrome
				onEdit={() => {}}
				align={align}
				title={title}
				canEdit={false}
				clickToEdit={false}
				showButton={false}
			>
				<span
					className="pointer-events-none select-none text-slate-400 italic dark:text-slate-500"
					aria-hidden="true"
				>
					—
				</span>
			</CellChrome>
		);
	}

	const canEdit = !!String(value ?? "").trim();
	return (
		<CellChrome
			onEdit={() => openEditCell(idxOriginal, field, value ?? "")}
			align={align}
			title={title || value}
			canEdit={canEdit}
		>
			{value || ""}
		</CellChrome>
	);
}

/* =================== main component =================== */
type Props = {
	rows: KSPreviewRow[] | null;
	setRows: React.Dispatch<React.SetStateAction<KSPreviewRow[] | null>>;
	overrides: OverrideMaps;
	setOverrides: React.Dispatch<React.SetStateAction<OverrideMaps>>;
	onDownloadCSV: (overrides: OverrideMaps) => void;
};

type EditScope = "one" | "bySigner" | "bySignature" | "byMarked";
type FilterableField = "Type" | "Inn-Valuta" | "Ut-Valuta" | "Marked";
type Filters = Partial<Record<FilterableField, Set<string>>>;

export default function Preview({
	rows,
	setRows,
	overrides,
	setOverrides,
	onDownloadCSV
}: Props) {
	const [activeTab, setActiveTab] = useState<"preview" | "attention">(
		"preview"
	);
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	// filters
	const [filters, setFilters] = useState<Filters>({});
	const [openFilter, setOpenFilter] = useState<FilterableField | null>(null);

	// This ref always points to the currently visible scroll area (normal OR maximized)
	const previewContainerRef = useRef<HTMLDivElement | null>(null);

	// “Maximize” = take up the whole browser window (not Fullscreen API)
	const [isMaximized, setIsMaximized] = useState(false);
	function toggleMaximize() {
		setIsMaximized((v) => !v);
	}
	useEffect(() => {
		if (isMaximized) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			return () => {
				document.body.style.overflow = prev;
			};
		}
	}, [isMaximized]);

	// highlight + scroll-to-signature
	const [highlightSig, setHighlightSig] = useState<string | null>(null);

	// resizable height (only in normal mode)
	const [previewHeight, setPreviewHeight] = useState<number>(384);
	const isDraggingRef = useRef(false);
	const dragStartYRef = useRef(0);
	const startHeightRef = useRef(384);

	function onResizeStart(e: React.MouseEvent) {
		isDraggingRef.current = true;
		dragStartYRef.current = e.clientY;
		startHeightRef.current = previewHeight;
		window.addEventListener("mousemove", onResizing);
		window.addEventListener("mouseup", onResizeEnd);
	}
	function onResizing(e: MouseEvent) {
		if (!isDraggingRef.current) return;
		const dy = e.clientY - dragStartYRef.current;
		const h = Math.max(
			220,
			Math.min(window.innerHeight - 240, startHeightRef.current + dy)
		);
		setPreviewHeight(h);
	}
	function onResizeEnd() {
		isDraggingRef.current = false;
		window.removeEventListener("mousemove", onResizing);
		window.removeEventListener("mouseup", onResizeEnd);
	}
	useEffect(() => {
		return () => {
			window.removeEventListener("mousemove", onResizing);
			window.removeEventListener("mouseup", onResizeEnd);
		};
	}, []);

	// Effective rows with overrides applied (only for display)
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

	// ===== issues (unknown tokens/markets) =====
	const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());
	const [openIssues, setOpenIssues] = useState<Set<string>>(new Set());

	const issues: Issue[] = useMemo(() => {
		if (!rows) return [];

		const sCount = new Map<string, { count: number; sigs: Set<string> }>();
		const mCount = new Map<string, { count: number; sigs: Set<string> }>();

		for (const r of rows) {
			const sig = extractSig(r);

			// symbols
			for (const s of [r["Inn-Valuta"], r["Ut-Valuta"]].filter(
				Boolean
			) as string[]) {
				if (!isPlaceholderSymbol(s)) continue;
				const o = sCount.get(s) || { count: 0, sigs: new Set<string>() };
				o.count += 1;
				if (sig) o.sigs.add(sig);
				sCount.set(s, o);
			}

			// markets
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
	function ignoreAllPending() {
		setIgnoredKeys((prev) => {
			const next = new Set(prev);
			for (const it of issues) {
				if (it.status !== "pending") continue;
				const id = `${it.kind === "unknown-token" ? "symbol" : "market"}:${
					it.key
				}`;
				next.add(id);
			}
			return next;
		});
	}

	// ===== inline editor state =====
	type FieldKey = keyof KSRow;
	const [editOpen, setEditOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<{
		idxOriginal: number;
		field: FieldKey;
		sig?: string;
		signer?: string;
		label: string;
	} | null>(null);
	const [editDraft, setEditDraft] = useState("");
	const [editScope, setEditScope] = useState<EditScope>("one");

	/* ====== Virtualization state ====== */
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportH, setViewportH] = useState(0);
	const [rowH, setRowH] = useState(40); // will be auto-measured
	const overscan = 10;

	// attach listeners to current scroll container (embedded OR maximized)
	useEffect(() => {
		const el = previewContainerRef.current;
		if (!el) return;

		const onScroll = () => setScrollTop(el.scrollTop);
		el.addEventListener("scroll", onScroll, { passive: true });
		setScrollTop(el.scrollTop);
		setViewportH(el.clientHeight);

		const ro = new ResizeObserver(() => {
			setViewportH(el.clientHeight);
		});
		ro.observe(el);

		return () => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
		};
	}, [isMaximized, previewHeight, activeTab]);

	const handleMeasureRow = useCallback(
		(h: number) => {
			if (!h) return;
			if (Math.abs(h - rowH) > 1) setRowH(h);
		},
		[rowH]
	);

	function openEditCell(
		idxOriginal: number,
		field: FieldKey,
		currentValue: string
	) {
		const sig = rows ? extractSig(rows[idxOriginal]) : undefined;
		const signer = rows?.[idxOriginal]?.signer;
		setEditTarget({
			idxOriginal,
			field,
			sig,
			signer,
			label: field
		});
		setEditDraft(
			field === "Type" && !TYPE_OPTIONS.includes(currentValue as KSType)
				? TYPE_OPTIONS[0]
				: currentValue ?? ""
		);

		setEditScope("one");
		setEditOpen(true);
	}

	function applyEdit(mode: EditScope) {
		if (!rows || !editTarget) return;
		const { idxOriginal, field, signer, sig } = editTarget;
		const newVal = editDraft;

		const originalMarket = rows[idxOriginal]?.Marked?.trim();

		setRows((prev) => {
			if (!prev) return prev;
			const next = [...prev];

			if (mode === "one") {
				const row = { ...next[idxOriginal] } as any;
				row[field] = newVal;
				next[idxOriginal] = row;
				return next;
			}

			if (mode === "bySigner") {
				if (!signer) return prev;
				for (let i = 0; i < next.length; i++) {
					const rowSigner = next[i]?.signer;
					if (rowSigner && rowSigner === signer) {
						const row = { ...next[i] } as any;
						row[field] = newVal;
						next[i] = row;
					}
				}
				return next;
			}

			if (mode === "bySignature") {
				if (!sig) return prev;
				for (let i = 0; i < next.length; i++) {
					const rowSig = extractSig(next[i]);
					if (rowSig && rowSig === sig) {
						const row = { ...next[i] } as any;
						row[field] = newVal;
						next[i] = row;
					}
				}
				return next;
			}

			if (mode === "byMarked") {
				if (!originalMarket) return prev;
				for (let i = 0; i < next.length; i++) {
					if ((next[i]?.Marked ?? "").trim() === originalMarket) {
						const row = { ...next[i] } as any;
						row[field] = newVal;
						next[i] = row;
					}
				}
				return next;
			}

			return next;
		});

		if (
			mode === "byMarked" &&
			editTarget.field === "Marked" &&
			originalMarket
		) {
			setOverrides((prev) => ({
				...prev,
				markets: { ...(prev.markets ?? {}), [originalMarket]: newVal }
			}));
		}

		setEditOpen(false);
		setEditTarget(null);
		setEditDraft("");
	}

	// jump to a signature inside the table — works with virtualization
	function jumpToSig(sig: string) {
		if (!sig) return;
		setActiveTab("preview");
		setHighlightSig(sig);

		setTimeout(() => {
			const container = previewContainerRef.current;
			if (!container) return;
			const idx = displayed.findIndex(({ r }) => extractSig(r) === sig);
			if (idx >= 0) {
				const target = Math.max(0, idx * rowH - container.clientHeight / 2);
				container.scrollTo({ top: target, behavior: "smooth" });
			}
		}, 60);

		setTimeout(() => {
			setHighlightSig((curr) => (curr === sig ? null : curr));
		}, 6000);
	}

	/* ===================== FILTERS ===================== */
	const optionCounts = useMemo(() => {
		// counts over ALL effective rows (pre-filter), based on overrides
		const counts: Record<FilterableField, Map<string, number>> = {
			Type: new Map(),
			"Inn-Valuta": new Map(),
			"Ut-Valuta": new Map(),
			Marked: new Map()
		};
		for (const r of effectiveRows) {
			(
				["Type", "Inn-Valuta", "Ut-Valuta", "Marked"] as FilterableField[]
			).forEach((f) => {
				const v = (r as any)[f] as string | undefined;
				if (!v || !String(v).trim()) return;
				counts[f].set(v, (counts[f].get(v) ?? 0) + 1);
			});
		}
		return counts;
	}, [effectiveRows]);

	const filterHasAny = useMemo(
		() => Object.values(filters).some((s) => s && s.size > 0),
		[filters]
	);

	function toggleFilterValue(field: FilterableField, value: string) {
		setFilters((prev) => {
			const next = { ...prev };
			const curr = new Set(next[field] ?? []);
			if (curr.has(value)) curr.delete(value);
			else curr.add(value);
			next[field] = curr;
			return next;
		});
	}

	function clearFilter(field: FilterableField) {
		setFilters((prev) => {
			const next = { ...prev };
			delete next[field];
			return next;
		});
	}

	function clearAllFilters() {
		setFilters({});
		setOpenFilter(null);
	}

	// apply filters
	const matchesFilters = (r: KSPreviewRow) => {
		const fields: FilterableField[] = [
			"Type",
			"Inn-Valuta",
			"Ut-Valuta",
			"Marked"
		];
		for (const f of fields) {
			const selected = filters[f];
			if (selected && selected.size > 0) {
				const val = (r as any)[f] as string | undefined;
				if (!val || !selected.has(val)) return false;
			}
		}
		return true;
	};

	/* ===================== PREVIEW DATA (sort + filter) ===================== */
	const baseIndexed = effectiveRows.map((r, i) => ({ r, i }));
	const sorted = [...baseIndexed].sort((a, b) => {
		const ta = parseTidspunkt(a.r.Tidspunkt);
		const tb = parseTidspunkt(b.r.Tidspunkt);
		return sortOrder === "desc" ? tb - ta : ta - tb;
	});
	const filtered = sorted.filter(({ r }) => matchesFilters(r));
	const displayed = filtered; // VIRTUALIZED rendering, no cap

	const previewsReady =
		Array.isArray(effectiveRows) && effectiveRows.length >= 0;

	/* ---------- header cell with filter popover ---------- */
	function HeaderWithFilter({
		label,
		field
	}: {
		label: string;
		field: FilterableField;
	}) {
		const isOpen = openFilter === field;
		const selected = filters[field];
		const active = !!selected && selected.size > 0;

		// options sorted by count desc, then alpha
		const opts = useMemo(() => {
			const m = optionCounts[field];
			const arr = Array.from(m.entries());
			arr.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
			return arr;
		}, [field, optionCounts]);

		return (
			<th className="relative whitespace-nowrap">
				<>
					{/* Plain header title + icons */}
					<div className="inline-flex items-center gap-1">
						<span className="pr-0.5">{label}</span>

						{/* subtle active dot */}
						{active && (
							<span
								className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400"
								aria-hidden="true"
							/>
						)}

						{/* Filter icon */}
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setOpenFilter((curr) => (curr === field ? null : field));
							}}
							className="p-0.5 -m-0.5"
							aria-label={`Filtrer ${label}`}
							aria-expanded={isOpen}
							title={`Filtrer ${label}`}
						>
							<FiFilter
								className={[
									"h-4 w-4 transition-colors",
									active
										? "text-indigo-600 dark:text-indigo-400"
										: "text-slate-400 dark:text-slate-500",
									"hover:text-slate-700 dark:hover:text-slate-200 focus:text-slate-700 dark:focus:text-slate-200"
								].join(" ")}
							/>
						</button>

						{/* Header reset (X) */}
						{active && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									clearFilter(field);
								}}
								className="p-0.5 -m-0.5"
								aria-label="Nullstill filter"
								title="Nullstill filter"
							>
								<FiX className="h-4 w-4 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 transition-colors" />
							</button>
						)}
					</div>

					{/* Popover */}
					{isOpen && (
						<div
							className="absolute right-0 mt-2 z-30 w-[min(92vw,18rem)] sm:w-72 max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-[#0f172a]/95 dark:backdrop-blur"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="mb-2 flex items-center justify-between">
								<div className="text-xs font-medium text-slate-700 dark:text-slate-200">
									Filtrer: {label}
								</div>
								<button
									type="button"
									onClick={() => setOpenFilter(null)}
									className="p-1 rounded text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
									aria-label="Lukk"
									title="Lukk"
								>
									<FiX className="h-4 w-4" />
								</button>
							</div>

							{opts.length === 0 ? (
								<div className="p-2 text-xs text-slate-500 dark:text-slate-300">
									Ingen verdier.
								</div>
							) : (
								<ul className="space-y-1">
									{opts.map(([val, count]) => {
										const checked = !!selected?.has(val);
										return (
											<li key={val}>
												<label className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-white/5">
													<span
														className="truncate text-xs text-slate-800 dark:text-slate-200"
														title={val}
													>
														<input
															type="checkbox"
															className="mr-2 align-middle"
															checked={checked}
															onChange={() => toggleFilterValue(field, val)}
														/>
														{val}
													</span>
													<span className="text-[10px] text-slate-500 dark:text-slate-400">
														{count}
													</span>
												</label>
											</li>
										);
									})}
								</ul>
							)}

							<div className="mt-2 flex items-center justify-between">
								<button
									type="button"
									onClick={() => clearFilter(field)}
									className="rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
								>
									Nullstill {label}
								</button>
								<button
									type="button"
									onClick={() => setOpenFilter(null)}
									className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
								>
									Lukk
								</button>
							</div>
						</div>
					)}
				</>
			</th>
		);
	}

	/* ---------- reusable table renderer with virtualization ---------- */
	function PreviewTable({
		onMeasureRow
	}: {
		onMeasureRow: (h: number) => void;
	}) {
		// compute window
		const total = displayed.length;
		const startIndex = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
		const endIndex = Math.min(
			total - 1,
			Math.ceil((scrollTop + viewportH) / rowH) + overscan
		);
		const visible = total > 0 ? displayed.slice(startIndex, endIndex + 1) : [];

		// measurement ref for the first visible row
		const measureRowRef = useCallback(
			(el: HTMLTableRowElement | null) => {
				if (!el) return;
				const h = el.getBoundingClientRect().height;
				if (h) onMeasureRow(h);
			},
			[onMeasureRow]
		);

		return (
			<table className="min-w-[960px] sm:min-w-full text-[11px] sm:text-xs">
				<thead className="sticky top-0 z-20 bg-white dark:bg-[#0e1729] text-slate-700 dark:text-slate-200 shadow-sm">
					<tr className="[&>th]:px-2 sm:[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
						<th className="min-w-[4rem] whitespace-nowrap">Tidspunkt</th>
						<HeaderWithFilter label="Type" field="Type" />
						<th className="text-right whitespace-nowrap">Inn</th>
						<HeaderWithFilter label="Inn-Valuta" field="Inn-Valuta" />
						<th className="text-right whitespace-nowrap">Ut</th>
						<HeaderWithFilter label="Ut-Valuta" field="Ut-Valuta" />
						<th className="text-right whitespace-nowrap">Gebyr</th>
						<th className="whitespace-nowrap hidden md:table-cell">
							Gebyr-Valuta
						</th>
						<HeaderWithFilter label="Marked" field="Marked" />
						<th className="whitespace-nowrap">Notat</th>
						<th className="whitespace-nowrap hidden md:table-cell">Explorer</th>
					</tr>
				</thead>

				{/* Virtualized body */}
				{total === 0 ? (
					<tbody>
						<tr>
							<td
								colSpan={1000}
								className="px-3 py-6 text-center text-slate-500 dark:text-slate-400"
							>
								Ingen rader funnet for valgte kriterier.
							</td>
						</tr>
					</tbody>
				) : (
					<tbody className="bg-white dark:bg-transparent">
						{/* top spacer (no border) */}
						{startIndex > 0 && (
							<tr style={{ height: startIndex * rowH }}>
								<td colSpan={1000} />
							</tr>
						)}

						{/* visible rows (use bottom border instead of zebra backgrounds) */}
						{visible.map((it, idx) => {
							const r = it.r;
							const idxOriginal = it.i;
							const sig = extractSig(r);
							const solscan = sig ? `https://solscan.io/tx/${sig}` : undefined;
							const rowKey = `${sig ?? "nosig"}-${r.Type}-${r["Inn-Valuta"]}-${
								r["Ut-Valuta"]
							}-${r.Inn}-${r.Ut}-${idxOriginal}`;
							const highlight = sig && highlightSig === sig;

							const attachMeasure = idx === 0 ? { ref: measureRowRef } : {};

							return (
								<tr
									key={rowKey}
									data-sig={sig || undefined}
									className={[
										"[&>td]:px-2 sm:[&>td]:px-3 [&>td]:py-2 transition-colors",
										"border-b border-slate-100 dark:border-white/10",
										highlight
											? "[&>td]:bg-amber-50 dark:[&>td]:bg-amber-900/20"
											: ""
									].join(" ")}
									{...attachMeasure}
								>
									<td className="font-medium whitespace-normal leading-tight">
										<TidspunktCell
											idxOriginal={idxOriginal}
											value={r.Tidspunkt}
											openEditCell={openEditCell}
										/>
									</td>

									<td>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Type"}
											value={r.Type}
											openEditCell={openEditCell}
										/>
									</td>

									<td className="text-right">
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Inn"}
											value={r.Inn}
											align="right"
											openEditCell={openEditCell}
										/>
									</td>

									<td>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Inn-Valuta"}
											value={r["Inn-Valuta"]}
											openEditCell={openEditCell}
										/>
									</td>

									<td className="text-right">
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Ut"}
											value={r.Ut}
											align="right"
											openEditCell={openEditCell}
										/>
									</td>

									<td>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Ut-Valuta"}
											value={r["Ut-Valuta"]}
											openEditCell={openEditCell}
										/>
									</td>

									<td className="text-right">
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Gebyr"}
											value={r.Gebyr}
											align="right"
											openEditCell={openEditCell}
										/>
									</td>

									<td className="hidden md:table-cell">
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Gebyr-Valuta"}
											value={r["Gebyr-Valuta"]}
											openEditCell={openEditCell}
										/>
									</td>

									<td className="truncate max-w-[9rem] sm:max-w-[12rem]">
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Marked"}
											value={r.Marked}
											title={r.Marked}
											openEditCell={openEditCell}
										/>
									</td>

									<td className="truncate max-w-[10rem] sm:max-w-[14rem]">
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Notat"}
											value={r.Notat}
											title={r.Notat}
											openEditCell={openEditCell}
										/>
									</td>

									<td className="hidden md:table-cell">
										{solscan ? (
											<Link
												href={solscan}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 text-indigo-600 hover:underline justify-center ml-4 dark:text-indigo-400"
												title="Åpne i Solscan"
											>
												<FiExternalLink className="h-4 w-4" />
												<span className="sr-only">Solscan</span>
											</Link>
										) : (
											<span className="text-slate-400 dark:text-slate-500">
												—
											</span>
										)}
									</td>
								</tr>
							);
						})}

						{/* bottom spacer (no border) */}
						{endIndex < total - 1 && (
							<tr style={{ height: (total - endIndex - 1) * rowH }}>
								<td colSpan={1000} />
							</tr>
						)}
					</tbody>
				)}
			</table>
		);
	}

	/* ===================== RENDER ===================== */
	return (
		<section className="mt-6">
			<div className="rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/5 ring-1 ring-slate-200/60 dark:ring-slate-800/60">
				<div className="p-4 sm:p-10">
					{/* Tabs header (side-by-side, no scrolling) */}
					<div className="border-b border-slate-200 dark:border-white/10">
						<div
							className="flex flex-nowrap items-end -mb-px"
							role="tablist"
							aria-label="Forhåndsvisning faner"
						>
							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "preview"}
								onClick={() => {
									setActiveTab("preview");
									setOpenFilter(null);
								}}
								className={[
									"relative flex-1 min-w-0 text-center rounded-t-md",
									"px-2 pr-6 py-1.5 text-[11px] leading-5 sm:px-3 sm:py-2 sm:text-sm",
									"-mb-px border-b-2 transition-colors",
									activeTab === "preview"
										? "border-indigo-600 text-indigo-700 dark:border-indigo-500 dark:text-indigo-400"
										: "border-transparent text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"
								].join(" ")}
							>
								Forhåndsvisning
							</button>

							<button
								type="button"
								role="tab"
								aria-selected={activeTab === "attention"}
								onClick={() => {
									setActiveTab("attention");
									setOpenFilter(null);
								}}
								title="Uavklarte elementer som bør navngis"
								className={[
									"relative flex-1 min-w-0 text-center rounded-t-md",
									"px-2 pr-8 py-1.5 text-[11px] leading-5 sm:px-3 sm:py-2 sm:text-sm",
									"-mb-px border-b-2 transition-colors",
									activeTab === "attention"
										? "border-indigo-600 text-indigo-700 dark:border-indigo-500 dark:text-indigo-400"
										: "border-transparent text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100"
								].join(" ")}
							>
								<span className="pointer-events-none">
									Trenger oppmerksomhet
								</span>
								{pendingIssuesCount > 0 && (
									<span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 dark:bg-amber-500/20 dark:text-amber-300">
										{pendingIssuesCount}
									</span>
								)}
							</button>
						</div>
					</div>

					{/* Tabs content */}
					{activeTab === "attention" ? (
						<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3 max-h-[80vh] overflow-y-auto overscroll-contain dark:border-amber-900/40 dark:bg-amber-500/10">
							{issues.length === 0 ? (
								<div className="text-sm text-emerald-700 dark:text-emerald-400">
									Ingen uavklarte elementer 🎉
								</div>
							) : (
								<>
									{/* Mass action bar */}
									<div className="mb-2 flex items-center justify-end">
										<button
											type="button"
											onClick={ignoreAllPending}
											disabled={!issues.some((i) => i.status === "pending")}
											className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
											title="Ignorer alle uavklarte elementer"
										>
											Ignorer alle
										</button>
									</div>

									<ul className="space-y-3">
										{issues.map((it) => {
											const inputId = `issue-${it.kind}-${it.key.replace(
												/[^a-z0-9\-]/gi,
												"_"
											)}`;
											const isOpen = openIssues.has(inputId);

											const statusBadge =
												it.status === "pending" ? (
													<span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
														Avventer
													</span>
												) : it.status === "renamed" ? (
													<span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
														Endret{it.newName ? ` → ${it.newName}` : ""}
													</span>
												) : (
													<span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-white/10 dark:text-slate-300">
														Ignorert
													</span>
												);

											const occurrenceRows =
												rows?.filter((r) => {
													if (it.kind === "unknown-token") {
														return (
															r["Inn-Valuta"] === it.key ||
															r["Ut-Valuta"] === it.key
														);
													}
													return r.Marked === it.key;
												}) ?? [];

											return (
												<li
													key={`${it.kind}:${it.key}`}
													className="rounded-lg bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-white/10"
												>
													<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
														<div className="space-y-1">
															<div className="text-sm font-medium text-slate-800 dark:text-slate-100">
																{it.kind === "unknown-token"
																	? "Ukjent token"
																	: "Ukjent marked"}
																: <code className="font-mono">{it.key}</code>
																{statusBadge}
															</div>
															<div className="text-xs text-slate-600 dark:text-slate-400">
																{it.count} forekomster
															</div>
														</div>

														<div className="flex flex-wrap items-center gap-2 sm:justify-end">
															<input
																id={inputId}
																defaultValue={it.newName ?? ""}
																placeholder={
																	it.kind === "unknown-token"
																		? "Ny tokensymbol (BTC, ETH, SOL...)"
																		: "Nytt markedsnavn"
																}
																className="w-full sm:w-56 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
															/>
															<button
																type="button"
																onClick={() => {
																	const el = document.getElementById(
																		inputId
																	) as HTMLInputElement | null;
																	const val = (el?.value ?? "").trim();
																	if (!val) return;
																	renameIssue(it.kind, it.key, val);
																}}
																className="rounded-md bg-indigo-600 text-white px-2 py-1 text-sm disabled:opacity-60 dark:bg-indigo-500"
															>
																Lagre
															</button>
															<button
																type="button"
																onClick={() => ignoreIssue(it.kind, it.key)}
																className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
																title={
																	it.status === "ignored"
																		? "Angre ignorering"
																		: "Ignorer"
																}
															>
																{it.status === "ignored" ? "Angre" : "Ignorer"}
															</button>
															<button
																type="button"
																onClick={() =>
																	setOpenIssues((prev) => {
																		const next = new Set(prev);
																		if (next.has(inputId)) next.delete(inputId);
																		else next.add(inputId);
																		return next;
																	})
																}
																className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
															>
																{isOpen
																	? "Skjul forekomster"
																	: `Vis forekomster (${occurrenceRows.length})`}
															</button>
														</div>
													</div>

													{isOpen && (
														<div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-white/10 dark:bg-white/5">
															{occurrenceRows.length === 0 ? (
																<div className="text-xs text-slate-600 dark:text-slate-400">
																	Ingen forekomster funnet.
																</div>
															) : (
																<ul className="grid gap-2 sm:grid-cols-1 md:grid-cols-2">
																	{occurrenceRows.map((r, idx) => {
																		const sig = extractSig(r);
																		const tokenInfo =
																			[r["Inn-Valuta"], r["Ut-Valuta"]]
																				.filter(Boolean)
																				.join(" / ") || "—";
																		const solscan = sig
																			? `https://solscan.io/tx/${sig}`
																			: undefined;

																		return (
																			<li key={`${sig ?? "x"}-${idx}`}>
																				<div
																					className="w-full rounded-md bg-white px-2 py-1.5 text-xs shadow-sm ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-white/10"
																					title={
																						sig
																							? "Gå til rad i forhåndsvisning eller åpne i Solscan"
																							: "Ingen signatur funnet"
																					}
																				>
																					<div className="flex items-center justify-between gap-2">
																						<span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
																							{r.Tidspunkt}
																						</span>
																						<div className="flex items-center gap-2">
																							<button
																								type="button"
																								onClick={() =>
																									sig && jumpToSig(sig)
																								}
																								disabled={!sig}
																								className="text-[10px] text-indigo-600 hover:underline disabled:opacity-60 dark:text-indigo-400"
																								title="Gå til rad"
																							>
																								Gå til rad
																							</button>
																							{sig && solscan && (
																								<Link
																									href={solscan}
																									target="_blank"
																									rel="noopener noreferrer"
																									className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline dark:text-indigo-400"
																									title="Åpne i Solscan"
																									onClick={(e) =>
																										e.stopPropagation()
																									}
																								>
																									<FiExternalLink className="h-3.5 w-3.5" />
																									Solscan
																								</Link>
																							)}
																						</div>
																					</div>
																					<div className="mt-0.5">
																						<span className="font-medium text-slate-800 dark:text-slate-100">
																							{r.Type}
																						</span>{" "}
																						<span className="text-slate-600 dark:text-slate-400">
																							• {tokenInfo}
																						</span>
																					</div>
																				</div>
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
								</>
							)}
						</div>
					) : (
						/* PREVIEW TAB */
						<div className="mt-6">
							{/* Top bar with sorter + maximize + reset filters */}
							<div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div className="text-xs text-slate-600 dark:text-slate-400">
									Viser {displayed.length} rader
									{filterHasAny ? " (filtrert)" : ""}.
								</div>
								<div className="flex flex-wrap items-center gap-2 text-xs">
									{filterHasAny && (
										<button
											type="button"
											onClick={clearAllFilters}
											className="rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
											title="Nullstill alle filtre"
										>
											Nullstill filtre
										</button>
									)}

									<span className="text-slate-600 dark:text-slate-300">
										Sorter:
									</span>
									<select
										value={sortOrder}
										onChange={(e) => setSortOrder(e.target.value as SortOrder)}
										className="min-w-[140px] sm:min-w-[180px] pr-8 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
									>
										<option value="desc">Nyeste først</option>
										<option value="asc">Eldste først</option>
									</select>

									{/* Maximize toggle (window fill, not Fullscreen API) */}
									<button
										type="button"
										onClick={toggleMaximize}
										className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
										title={isMaximized ? "Lukk maksimering" : "Maksimer"}
										aria-pressed={isMaximized}
									>
										{isMaximized ? (
											<FiMinimize className="h-4 w-4" />
										) : (
											<FiMaximize className="h-4 w-4" />
										)}
									</button>
								</div>
							</div>

							{/* Normal (embedded) preview */}
							{!isMaximized && (
								<>
									<div
										ref={previewContainerRef}
										className="relative overflow-auto overscroll-contain rounded-t-xl ring-1 ring-slate-200 contain-content dark:ring-white/10"
										style={{ height: previewHeight }}
										onClick={() => setOpenFilter(null)}
									>
										<PreviewTable onMeasureRow={handleMeasureRow} />
									</div>

									<div
										onMouseDown={onResizeStart}
										className="flex items-center justify-center h-4 cursor-ns-resize bg-slate-50 border-x border-b border-slate-200 rounded-b-xl select-none dark:bg-white/5 dark:border-white/10"
										title="Dra for å endre høyde"
									>
										<div className="h-1 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
									</div>
								</>
							)}

							{/* Maximized overlay (fills the browser window; modals still work above) */}
							{isMaximized && (
								<div
									className="fixed inset-0 z-40 bg-white dark:bg-[#0b1220]"
									onClick={() => setOpenFilter(null)}
								>
									<div className="h-full flex flex-col p-4 sm:p-6">
										{/* Sticky top bar inside overlay: re-use sorter and minimize */}
										<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<div className="text-xs text-slate-600 dark:text-slate-400">
												Viser {displayed.length} rader
												{filterHasAny ? " (filtrert)" : ""}.
											</div>
											<div className="flex flex-wrap items-center gap-2 text-xs">
												{filterHasAny && (
													<button
														type="button"
														onClick={clearAllFilters}
														className="rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
														title="Nullstill alle filtre"
													>
														Nullstill filtre
													</button>
												)}
												<span className="text-slate-600 dark:text-slate-300">
													Sorter:
												</span>
												<select
													value={sortOrder}
													onChange={(e) =>
														setSortOrder(e.target.value as SortOrder)
													}
													className="min-w-[140px] sm:min-w-[180px] pr-8 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
												>
													<option value="desc">Nyeste først</option>
													<option value="asc">Eldste først</option>
												</select>
												<button
													type="button"
													onClick={toggleMaximize}
													className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
													title="Lukk maksimering"
												>
													<FiMinimize className="h-4 w-4" />
												</button>
											</div>
										</div>

										{/* Scroll area fills remaining height */}
										<div className="flex-1 min-h-0">
											<div
												ref={previewContainerRef}
												className="h-full overflow-auto overscroll-contain rounded-xl ring-1 ring-slate-200 contain-content dark:ring-white/10"
											>
												<PreviewTable onMeasureRow={handleMeasureRow} />
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
					)}

					{/* ===== Global actions & help (belong to preview card) ===== */}
					{previewsReady && (
						<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							{rows && (
								<div className="text-sm">
									{pendingIssuesCount > 0 ? (
										<button
											type="button"
											onClick={() => setActiveTab("attention")}
											className="text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-900/40 dark:hover:bg-amber-500/20"
										>
											Løs ‘Trenger oppmerksomhet’ først ({pendingIssuesCount})
										</button>
									) : (
										<span className="text-emerald-700 dark:text-emerald-400">
											Alt ser bra ut ✅
										</span>
									)}
								</div>
							)}

							<div className="w-full sm:w-auto">
								<button
									type="button"
									onClick={() => onDownloadCSV(overrides)}
									disabled={!rows || pendingIssuesCount > 0}
									className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:shadow-lg active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed dark:from-indigo-500 dark:to-emerald-500"
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

					{/* Inline editor modal (centered, rounded on all breakpoints) */}
					{editOpen && editTarget && (
						<div
							className="fixed inset-0 z-50 bg-black/30 dark:bg-black/40 flex items-center justify-center p-3 sm:p-4"
							onClick={() => setEditOpen(false)}
							role="dialog"
							aria-modal="true"
							aria-labelledby="edit-dialog-title"
						>
							<div
								className="w-full max-w-[min(100vw-1rem,44rem)] sm:max-w-2xl rounded-2xl overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-[linear-gradient(180deg,#0e1729_0%,#0b1220_100%)] dark:ring-white/10 flex flex-col max-h-[90vh]"
								onClick={(e) => e.stopPropagation()}
							>
								{/* Sticky header */}
								<div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-white/10 dark:bg-[#0e1729]/80">
									<h3
										id="edit-dialog-title"
										className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100"
									>
										Rediger felt:{" "}
										<code className="font-mono">{editTarget.label}</code>
									</h3>
									<button
										type="button"
										onClick={() => setEditOpen(false)}
										className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
										aria-label="Lukk"
									>
										<FiX className="h-5 w-5" />
									</button>
								</div>

								{/* Scrollable content */}
								<div className="px-3 sm:px-4 py-3 sm:py-4 overflow-y-auto">
									{(editTarget.sig || editTarget.signer) && (
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
											{editTarget.sig && (
												<MetaBox
													label="Signatur"
													value={editTarget.sig}
													link={`https://solscan.io/tx/${editTarget.sig}`}
												/>
											)}
											{editTarget.signer && (
												<MetaBox
													label="Signer-adresse"
													value={editTarget.signer}
													link={`https://solscan.io/address/${editTarget.signer}`}
												/>
											)}
										</div>
									)}

									<div className="mt-3">
										{editTarget.field === "Type" ? (
											<select
												value={editDraft}
												onChange={(e) => setEditDraft(e.target.value)}
												className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
											>
												{TYPE_OPTIONS.map((t) => (
													<option key={t} value={t}>
														{t}
													</option>
												))}
											</select>
										) : (
											<textarea
												rows={6}
												autoFocus
												value={editDraft}
												onChange={(e) => setEditDraft(e.target.value)}
												className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 font-mono whitespace-pre-wrap break-words min-h-[7rem] dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
												placeholder="Ny verdi…"
											/>
										)}
									</div>
								</div>

								{/* Sticky action bar with centered tooltip */}
								<ModalActions
									editScope={editScope}
									setEditScope={setEditScope}
									editTarget={editTarget}
									rows={rows}
									applyEdit={applyEdit}
								/>
							</div>
						</div>
					)}

					{/* Help (belongs with preview card) */}
					<div className="mt-6 rounded-xl bg-gradient-to-r from-emerald-50 to-indigo-50 p-4 text-xs text-slate-600 ring-1 ring-slate-200/70 dark:from-[#0b1220] dark:to-[#0b1220] dark:text-slate-300 dark:ring-white/10">
						Mapper: <b>Swaps</b> → <code>Handel</code>, <b>SOL/SPL</b> →{" "}
						<code>Overføring-Inn/Ut</code>, <b>Airdrops</b> →{" "}
						<code>Erverv</code>, <b>staking</b> → <code>Inntekt</code>. Ukjente
						tokens får koden <code>TOKEN-XXXXXX</code>.
					</div>
				</div>
			</div>
		</section>
	);
}

/* ===== Modal actions extracted (kept centered tooltip) ===== */
function ModalActions({
	editScope,
	setEditScope,
	editTarget,
	rows,
	applyEdit
}: {
	editScope: "one" | "bySigner" | "bySignature" | "byMarked";
	setEditScope: (v: "one" | "bySigner" | "bySignature" | "byMarked") => void;
	editTarget: {
		idxOriginal: number;
		field: keyof KSRow;
		sig?: string;
		signer?: string;
		label: string;
	} | null;
	rows: KSPreviewRow[] | null;
	applyEdit: (mode: "one" | "bySigner" | "bySignature" | "byMarked") => void;
}) {
	const [tipOpen, setTipOpen] = useState(false);
	const [tipTop, setTipTop] = useState<number | null>(null);
	const infoBtnRef = useRef<HTMLButtonElement | null>(null);

	const placeTip = useCallback(() => {
		const r = infoBtnRef.current?.getBoundingClientRect();
		if (r) setTipTop(r.bottom + 8);
	}, []);

	useEffect(() => {
		if (!tipOpen) return;
		placeTip();
		const onScroll = () => placeTip();
		const onResize = () => placeTip();
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		};
	}, [tipOpen, placeTip]);

	return (
		<div className="sticky bottom-0 z-10 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-white/10 dark:bg-[#0e1729]/80">
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<div className="text-[11px] text-slate-500 dark:text-slate-400">
					Velg hvor endringen skal gjelde.
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<select
						value={editScope}
						onChange={(e) =>
							setEditScope(
								e.target.value as
									| "one"
									| "bySigner"
									| "bySignature"
									| "byMarked"
							)
						}
						className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
					>
						<option value="one">Bare dette feltet</option>
						<option value="bySigner" disabled={!editTarget?.signer}>
							Alle med samme underskriver-adresse
						</option>
						<option value="bySignature" disabled={!editTarget?.sig}>
							Alle med samme signatur
						</option>
						<option
							value="byMarked"
							disabled={!rows?.[editTarget?.idxOriginal ?? 0]?.Marked?.trim()}
						>
							Alle fra samme marked
						</option>
					</select>

					{/* Info button + viewport-centered tooltip */}
					<div className="relative">
						<button
							ref={infoBtnRef}
							type="button"
							aria-label="Forklaring av alternativer"
							onMouseEnter={() => {
								setTipOpen(true);
								placeTip();
							}}
							onMouseLeave={() => setTipOpen(false)}
							onFocus={() => {
								setTipOpen(true);
								placeTip();
							}}
							onBlur={() => setTipOpen(false)}
							onClick={() => {
								setTipOpen((v) => !v);
								placeTip();
							}}
							className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 dark:focus:bg-white/5"
						>
							<FiInfo className="h-4 w-4" />
						</button>

						{tipOpen && tipTop !== null && (
							<div
								role="tooltip"
								className="fixed left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,22rem)] rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl dark:border-white/10 dark:bg-[#0f172a]/95 dark:text-slate-200 dark:backdrop-blur"
								style={{ top: tipTop }}
							>
								<p className="mb-1 font-medium">Hva betyr valgene?</p>
								<ul className="list-disc space-y-1 pl-4">
									<li>
										<b>Bare dette feltet</b> – endrer kun denne cellen (én rad).
									</li>
									<li>
										<b>Alle fra samme underskriver-adresse</b> – endrer alle
										rader der samme underskriver (signer) har signert.
									</li>
									<li>
										<b>Alle med samme signatur</b> – endrer alle rader som
										tilhører samme transaksjon (signatur).
									</li>
									<li>
										<b>Alle fra samme marked</b> – endrer alle rader med samme
										verdi i<code className="ml-1">Marked</code>-feltet.
									</li>
								</ul>
							</div>
						)}
					</div>

					<button
						type="button"
						onClick={() => applyEdit(editScope)}
						disabled={
							(editScope === "bySigner" && !editTarget?.signer) ||
							(editScope === "bySignature" && !editTarget?.sig)
						}
						className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
					>
						Lagre
					</button>
				</div>
			</div>
		</div>
	);
}
