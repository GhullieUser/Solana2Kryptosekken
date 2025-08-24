// app/components/preview.tsx
"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
	FiExternalLink,
	FiEdit,
	FiDownload,
	FiX,
	FiMaximize,
	FiMinimize,
	FiFilter,
	FiRotateCcw,
	FiRotateCw
} from "react-icons/fi";

import type { KSRow, KSPreviewRow, OverrideMaps } from "../page";
import ModalEditor from "@components/edit-modal";

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

function getRecipientFromRow(row: KSPreviewRow | any): string | undefined {
	if (!row) return undefined;
	// Try common keys used in your data
	// (add/remove keys here if your dataset uses different ones)
	const v =
		row.recipient ??
		row.mottaker ??
		row.Mottaker ??
		row.receiver ??
		row.Receiver ??
		row.to ??
		row.To ??
		row.til ??
		row.Til ??
		row["Mottaker-adresse"] ??
		row["mottaker-adresse"] ??
		row["Receiver Address"];
	return typeof v === "string" ? v : undefined;
}

type SortOrder = "desc" | "asc";

/** Columns in the preview table, in visual order */
type ColKey =
	| "tidspunkt"
	| "type"
	| "inn"
	| "innValuta"
	| "ut"
	| "utValuta"
	| "gebyr"
	| "gebyrValuta"
	| "marked"
	| "notat"
	| "explorer";

/** Single source of truth: default widths in px. */
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
	tidspunkt: 95,
	type: 115,
	inn: 140,
	innValuta: 120,
	ut: 140,
	utValuta: 120,
	gebyr: 140,
	gebyrValuta: 120,
	marked: 140,
	notat: 300,
	explorer: 120
};

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 700;

const COL_ORDER: ColKey[] = [
	"tidspunkt",
	"type",
	"inn",
	"innValuta",
	"ut",
	"utValuta",
	"gebyr",
	"gebyrValuta",
	"marked",
	"notat",
	"explorer"
];

/** Unified select styling (match expanded counterpart; avoid bright white border) */
const SELECT_STYLE =
	"min-w-[140px] sm:min-w-[180px] pr-8 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs shadow-sm " +
	"focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 " +
	"dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-900/40";

/* ---------- tiny utils ---------- */
function middleEllipsis(s: string, start = 10, end = 8) {
	if (!s) return "";
	return s.length <= start + end + 1
		? s
		: `${s.slice(0, start)}…${s.slice(-end)}`;
}

/* ---------- Shared padded wrapper for cells (padding here, td/th are padding:0) ---------- */
function CellPad({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative px-2 sm:px-3 py-2 overflow-hidden">{children}</div>
	);
}

/* ---------- Edit chrome ---------- */
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
			<span className="pointer-events-none absolute inset-[-5px] z-0 rounded ring-1 ring-transparent group-hover:ring-emerald-300/80 group-hover:bg-emerald-50/60 dark:group-hover:ring-emerald-500/40 dark:group-hover:bg-emerald-500/10 transition" />
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
		<CellPad>
			<CellChrome
				onEdit={() => openEditCell(idxOriginal, "Tidspunkt", value ?? "")}
				title={value}
				canEdit={canEdit}
			>
				<div className="leading-tight overflow-hidden">
					<div className="font-medium truncate">{datePart || value}</div>
					{timePart ? (
						<div className="text-slate-500 text-[11px] dark:text-slate-400 truncate">
							{timePart}
						</div>
					) : null}
				</div>
			</CellChrome>
		</CellPad>
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
			<CellPad>
				<CellChrome
					onEdit={() => {}}
					align={align}
					title={title}
					canEdit={false}
					clickToEdit={false}
					showButton={false}
				>
					<span className="pointer-events-none select-none text-slate-400 italic dark:text-slate-500">
						—
					</span>
				</CellChrome>
			</CellPad>
		);
	}

	const canEdit = !!String(value ?? "").trim();
	return (
		<CellPad>
			<CellChrome
				onEdit={() => openEditCell(idxOriginal, field, value ?? "")}
				align={align}
				title={title || value}
				canEdit={canEdit}
			>
				<div className="truncate">{value || ""}</div>
			</CellChrome>
		</CellPad>
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

type EditScope =
	| "one"
	| "bySigner"
	| "bySignature"
	| "byMarked"
	| "byRecipient";

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

	/** Column width state (persisted to localStorage) */
	const [colWidths, setColWidths] = useState<Record<ColKey, number>>(() => ({
		...DEFAULT_COL_WIDTHS
	}));
	/** Dynamically measured minimum widths for header titles (to always fit contents incl. filter & clear buttons) */
	const [headerMinW, setHeaderMinW] = useState<Partial<Record<ColKey, number>>>(
		{}
	);

	const ensureMinWidth = useCallback((key: ColKey, px: number) => {
		const want = Math.min(MAX_COL_WIDTH, Math.ceil(px));
		setHeaderMinW((prev) => {
			if (prev[key] === want) return prev;
			const next = { ...prev, [key]: want };
			// enforce immediately on colWidths if user-resized narrower
			setColWidths((cw) => {
				const minForThis = Math.max(MIN_COL_WIDTH, want);
				if ((cw[key] ?? 0) >= minForThis) return cw;
				return { ...cw, [key]: minForThis };
			});
			return next;
		});
	}, []);

	const tableColsWidth = useMemo(
		() => COL_ORDER.reduce((acc, k) => acc + (colWidths[k] || 0), 0),
		[colWidths]
	);

	/** Current visible container width (for stretch column) */
	const [containerWidth, setContainerWidth] = useState<number>(0);
	const stretchWidth = Math.max(0, containerWidth - tableColsWidth);
	const hasStretch = stretchWidth > 0;

	/** visual lock while dragging (cursor + user-select) */
	const [isResizingCol, setIsResizingCol] = useState(false);

	/** Load saved widths on mount (if any), merge with defaults */
	useEffect(() => {
		try {
			const raw = localStorage.getItem("ks_preview_colwidths");
			if (!raw) return;
			const saved = JSON.parse(raw) as Partial<Record<ColKey, number>>;
			const next: Record<ColKey, number> = { ...DEFAULT_COL_WIDTHS };
			for (const k of COL_ORDER) {
				const w = saved[k];
				if (typeof w === "number" && isFinite(w)) {
					// don't allow below (yet unknown) dynamic header min; clamp later when measured
					next[k] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w));
				}
			}
			setColWidths(next);
		} catch {}
	}, []);

	/** Persist widths when they change */
	useEffect(() => {
		try {
			localStorage.setItem("ks_preview_colwidths", JSON.stringify(colWidths));
		} catch {}
	}, [colWidths]);

	/** Resizing (drag) handling */
	const resizingRef = useRef<{
		key: ColKey;
		startX: number;
		startW: number;
	} | null>(null);

	const startResize = useCallback(
		(key: ColKey, clientX: number) => {
			resizingRef.current = { key, startX: clientX, startW: colWidths[key] };
			setIsResizingCol(true);
			try {
				document.body.style.cursor = "col-resize";
				(document.body.style as any).userSelect = "none";
			} catch {}
		},
		[colWidths]
	);

	useEffect(() => {
		function onMove(e: MouseEvent) {
			const r = resizingRef.current;
			if (!r) return;
			const dx = e.clientX - r.startX;
			const minForThis = Math.max(MIN_COL_WIDTH, headerMinW[r.key] || 0);
			const next = Math.min(MAX_COL_WIDTH, Math.max(minForThis, r.startW + dx));
			setColWidths((prev) => ({ ...prev, [r.key]: next }));
			e.preventDefault();
		}
		function onUp() {
			resizingRef.current = null;
			setIsResizingCol(false);
			try {
				document.body.style.cursor = "";
				(document.body.style as any).userSelect = "";
			} catch {}
		}
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, [headerMinW]);

	const handleResizerMouseDown = useCallback(
		(key: ColKey, e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			startResize(key, e.clientX);
		},
		[startResize]
	);

	const resetWidthToDefault = useCallback(
		(key: ColKey) => {
			setColWidths((prev) => {
				const minForThis = Math.max(MIN_COL_WIDTH, headerMinW[key] || 0);
				return {
					...prev,
					[key]: Math.max(DEFAULT_COL_WIDTHS[key], minForThis)
				};
			});
		},
		[headerMinW]
	);

	// filters
	const [filters, setFilters] = useState<Filters>({});
	const [openFilter, setOpenFilter] = useState<FilterableField | null>(null);

	// Current scroll container
	const previewContainerRef = useRef<HTMLDivElement | null>(null);

	// “Maximize”
	const [isMaximized, setIsMaximized] = useState(false);
	// remember preview scroll (normal vs maximized)
	const savedScrollRef = useRef<{ normal: number; maximized: number }>({
		normal: 0,
		maximized: 0
	});
	const persistPreviewScroll = useCallback(() => {
		const el = previewContainerRef.current;
		if (!el) return;
		if (isMaximized) savedScrollRef.current.maximized = el.scrollTop;
		else savedScrollRef.current.normal = el.scrollTop;
	}, [isMaximized]);

	function toggleMaximize() {
		persistPreviewScroll();
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

	// observe container size (height + width)
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportH, setViewportH] = useState(0);
	useEffect(() => {
		const el = previewContainerRef.current;
		if (!el) return;

		const onScroll = () => {
			setScrollTop(el.scrollTop);
			if (activeTab === "preview") {
				if (isMaximized) savedScrollRef.current.maximized = el.scrollTop;
				else savedScrollRef.current.normal = el.scrollTop;
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		setScrollTop(el.scrollTop);
		setViewportH(el.clientHeight);
		setContainerWidth(el.clientWidth);

		const ro = new ResizeObserver(() => {
			setViewportH(el.clientHeight);
			setContainerWidth(el.clientWidth);
		});
		ro.observe(el);

		return () => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
		};
	}, [isMaximized, previewHeight, activeTab]);

	// Effective rows with overrides applied
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

	/* ===== Undo / Redo ===== */
	const MAX_HISTORY = 10;
	const [undoStack, setUndoStack] = useState<KSPreviewRow[][]>([]);
	const [redoStack, setRedoStack] = useState<KSPreviewRow[][]>([]);

	const cloneRows = useCallback(
		(arr: KSPreviewRow[]) => arr.map((r) => ({ ...r })),
		[]
	);

	const pushUndoSnapshot = useCallback(() => {
		if (!rows) return;
		setUndoStack((prev) => {
			const next = [...prev, cloneRows(rows)];
			return next.length > MAX_HISTORY
				? next.slice(next.length - MAX_HISTORY)
				: next;
		});
		setRedoStack([]); // new change invalidates redo
	}, [rows, cloneRows]);

	const canUndo = undoStack.length > 0;
	const canRedo = redoStack.length > 0;

	const undo = useCallback(() => {
		if (!rows || !canUndo) return;
		const prevState = undoStack[undoStack.length - 1];
		setUndoStack((s) => s.slice(0, -1));
		setRedoStack((s) => {
			const next = [...s, cloneRows(rows)];
			return next.length > MAX_HISTORY
				? next.slice(next.length - MAX_HISTORY)
				: next;
		});
		setRows(cloneRows(prevState));
	}, [rows, canUndo, undoStack, cloneRows, setRows]);

	const redo = useCallback(() => {
		if (!rows || !canRedo) return;
		const nextState = redoStack[redoStack.length - 1];
		setRedoStack((s) => s.slice(0, -1));
		setUndoStack((s) => {
			const next = [...s, cloneRows(rows)];
			return next.length > MAX_HISTORY
				? next.slice(next.length - MAX_HISTORY)
				: next;
		});
		setRows(cloneRows(nextState));
	}, [rows, canRedo, redoStack, cloneRows, setRows]);

	// Keyboard shortcuts: Cmd/Ctrl-Z (undo), Cmd/Ctrl-Shift-Z or Cmd/Ctrl-Y (redo)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const meta = e.metaKey || e.ctrlKey;
			if (!meta) return;
			const key = e.key.toLowerCase();
			if (key === "z" && !e.shiftKey && canUndo) {
				e.preventDefault();
				undo();
			} else if (
				(key === "z" && e.shiftKey && canRedo) ||
				(key === "y" && canRedo)
			) {
				e.preventDefault();
				redo();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [canUndo, canRedo, undo, redo]);

	/* ====== Virtualization state ====== */
	const [rowH, setRowH] = useState(40);
	const overscan = 10;

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
		setEditTarget({ idxOriginal, field, sig, signer, label: field });
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

		// snapshot current rows so this edit is undoable
		pushUndoSnapshot();

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
					if (next[i]?.signer && next[i]?.signer === signer) {
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
			if (mode === "byRecipient") {
				const originalRecipient = getRecipientFromRow(
					prev[idxOriginal]
				)?.trim();
				if (!originalRecipient) return prev;
				for (let i = 0; i < next.length; i++) {
					const rec = getRecipientFromRow(next[i])?.trim();
					if (rec && rec === originalRecipient) {
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
	// highlight/jump helpers
	const lastHighlightTimerRef = useRef<number | null>(null);
	const lastSnapSigRef = useRef<string | null>(null);

	function jumpToSig(sig: string) {
		if (!sig) return;
		setActiveTab("preview");
		setOpenFilter(null);
		const foundInCurrent = displayed.some(({ r }) => extractSig(r) === sig);
		if (!foundInCurrent) {
			setFilters({});
		}
		setHighlightSig(sig);
		lastSnapSigRef.current = null;
		if (lastHighlightTimerRef.current) {
			window.clearTimeout(lastHighlightTimerRef.current);
		}
		lastHighlightTimerRef.current = window.setTimeout(() => {
			setHighlightSig((curr) => (curr === sig ? null : curr));
		}, 6000);
	}

	/* ===================== FILTERS ===================== */
	const optionCounts = useMemo(() => {
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
	const displayed = filtered;

	const previewsReady =
		Array.isArray(effectiveRows) && effectiveRows.length >= 0;

	/* ---------- Resizer ---------- */
	function Resizer({ colKey }: { colKey: ColKey }) {
		return (
			<div
				role="separator"
				aria-orientation="vertical"
				title="Dra for å endre kolonnebredde (dbl-klikk: reset)"
				onMouseDown={(e) => handleResizerMouseDown(colKey, e)}
				onDoubleClick={() => resetWidthToDefault(colKey)}
				className="group/resize absolute top-0 right-0 h-full w-4 cursor-col-resize select-none z-10"
				style={{ touchAction: "none" }}
			>
				<div className="pointer-events-none ml-[calc(50%-0.5px)] h-full w-px bg-slate-200 dark:bg-white/10 group-hover/resize:bg-slate-400 dark:group-hover/resize:bg-white/30" />
			</div>
		);
	}

	// Snap-to-highlighted row
	useEffect(() => {
		if (activeTab !== "preview" || !highlightSig) return;

		const container = previewContainerRef.current;
		if (!container) return;

		if (lastSnapSigRef.current === highlightSig) return;

		const centerOn = (top: number) => {
			const target = Math.max(0, top - Math.floor(container.clientHeight / 2));
			container.scrollTop = target;
		};

		const safeAttr = (sig: string) => {
			const esc = (window as any).CSS?.escape
				? (window as any).CSS.escape(sig)
				: sig.replace(/"/g, '\\"');
			return `tr[data-sig="${esc}"]`;
		};

		const trySnapToRow = (): boolean => {
			const row = container.querySelector<HTMLTableRowElement>(
				safeAttr(highlightSig)
			);
			if (!row) return false;
			centerOn(row.offsetTop);
			lastSnapSigRef.current = highlightSig;
			return true;
		};

		let idx = displayed.findIndex(({ r }) => extractSig(r) === highlightSig);

		if (idx < 0) {
			const allSorted = [...baseIndexed].sort((a, b) => {
				const ta = parseTidspunkt(a.r.Tidspunkt);
				const tb = parseTidspunkt(b.r.Tidspunkt);
				return sortOrder === "desc" ? tb - ta : ta - tb;
			});
			idx = allSorted.findIndex(({ r }) => extractSig(r) === highlightSig);
		}

		if (idx >= 0) {
			centerOn(idx * rowH);
			let tries = 0;
			const tick = () => {
				if (trySnapToRow()) return;
				if (tries++ < 30) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		} else {
			let tries = 0;
			const tick = () => {
				if (trySnapToRow()) return;
				if (tries++ < 30) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		}
	}, [highlightSig, activeTab, displayed, baseIndexed, rowH, sortOrder]);

	// Restore saved scroll when (re)entering preview
	useEffect(() => {
		if (activeTab !== "preview") return;
		const el = previewContainerRef.current;
		if (!el) return;
		if (highlightSig && lastSnapSigRef.current !== highlightSig) return;

		const saved = isMaximized
			? savedScrollRef.current.maximized
			: savedScrollRef.current.normal;

		requestAnimationFrame(() => {
			el.scrollTop = saved;
			setScrollTop(saved);
		});
	}, [activeTab, isMaximized, highlightSig]);

	/* ---------- Header with filter + resizer ---------- */
	function HeaderWithFilter({
		label,
		field,
		colKey
	}: {
		label: string;
		field: FilterableField;
		colKey: ColKey;
	}) {
		const isOpen = openFilter === field;
		const selected = filters[field];
		const active = !!selected && selected.size > 0;

		const opts = useMemo(() => {
			const m = optionCounts[field];
			const arr = Array.from(m.entries());
			arr.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
			return arr;
		}, [field, optionCounts]);

		const btnRef = useRef<HTMLButtonElement | null>(null);
		const popupRef = useRef<HTMLDivElement | null>(null);
		const [pos, setPos] = useState<{
			top: number;
			left: number;
			width: number;
			ready: boolean;
		} | null>(null);

		const computePopupPosition = useCallback(() => {
			if (!isOpen || !btnRef.current) return;
			const PAD = 8;
			const rect = btnRef.current.getBoundingClientRect();

			const desktop = window.matchMedia("(min-width: 640px)").matches;
			const desired = desktop ? 288 : Math.min(window.innerWidth * 0.92, 288);
			const width = Math.max(
				220,
				Math.min(desired, window.innerWidth - PAD * 2)
			);

			let top = rect.bottom + PAD;
			let left = rect.right - width;

			left = Math.max(PAD, Math.min(left, window.innerWidth - PAD - width));

			setPos({ top, left, width, ready: false });

			requestAnimationFrame(() => {
				const el = popupRef.current;
				if (!el) return;

				const h = el.getBoundingClientRect().height || 0;
				const spaceBelow = window.innerHeight - (rect.bottom + PAD);
				const spaceAbove = rect.top - PAD;

				if (h > spaceBelow && spaceAbove > spaceBelow) {
					top = Math.max(PAD, rect.top - PAD - h);
				}

				if (top + h > window.innerHeight - PAD) {
					top = Math.max(PAD, window.innerHeight - PAD - h);
				}
				setPos({ top, left, width, ready: true });
			});
		}, [isOpen]);

		useEffect(() => {
			if (!isOpen) return;
			computePopupPosition();

			const onAnyScroll = () => computePopupPosition();
			const onResize = () => computePopupPosition();

			window.addEventListener("scroll", onAnyScroll, true);
			window.addEventListener("resize", onResize);
			return () => {
				window.removeEventListener("scroll", onAnyScroll, true);
				window.removeEventListener("resize", onResize);
			};
		}, [isOpen, computePopupPosition]);

		useEffect(() => {
			if (!isOpen) return;
			function onDown(e: MouseEvent) {
				const t = e.target as Node;
				if (
					popupRef.current &&
					!popupRef.current.contains(t) &&
					btnRef.current &&
					!btnRef.current.contains(t)
				) {
					setOpenFilter(null);
				}
			}
			function onKey(e: KeyboardEvent) {
				if (e.key === "Escape") setOpenFilter(null);
			}
			document.addEventListener("mousedown", onDown);
			document.addEventListener("keydown", onKey);
			return () => {
				document.removeEventListener("mousedown", onDown);
				document.removeEventListener("keydown", onKey);
			};
		}, [isOpen]);

		// Measure header content to enforce per-column min width
		const contentMeasureRef = useRef<HTMLDivElement | null>(null);
		useEffect(() => {
			const el = contentMeasureRef.current;
			if (!el) return;
			const needed =
				(el.scrollWidth || el.getBoundingClientRect().width || 0) + 16;
			ensureMinWidth(colKey, needed);
		}, [label, active, selected?.size, colKey, ensureMinWidth]);

		const popup = isOpen
			? createPortal(
					<div
						ref={popupRef}
						className="z-[10000] rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-[#0f172a]/95 dark:backdrop-blur"
						style={{
							position: "fixed",
							top: pos?.top ?? -9999,
							left: pos?.left ?? -9999,
							width: pos?.width ?? 288,
							maxHeight: "60vh",
							overflow: "auto",
							visibility: pos?.ready ? "visible" : "hidden"
						}}
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
											<label className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg:white/5 dark:hover:bg-white/5">
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
					</div>,
					document.body
			  )
			: null;

		return (
			<th className="relative" style={{ width: colWidths[colKey], padding: 0 }}>
				<CellPad>
					<div
						ref={contentMeasureRef}
						className="inline-flex items-center gap-1 select-none overflow-hidden"
					>
						<span className="pr-0.5 whitespace-nowrap">{label}</span>

						{active && (
							<span className="ml-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
						)}

						<button
							ref={btnRef}
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setOpenFilter((curr) => (curr === field ? null : field));
							}}
							className="p-0.5 -m-0.5 shrink-0"
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

						{active && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									clearFilter(field);
								}}
								className="p-0.5 -m-0.5 shrink-0"
								aria-label="Nullstill filter"
								title="Nullstill filter"
							>
								<FiX className="h-4 w-4 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 transition-colors" />
							</button>
						)}
					</div>
				</CellPad>

				<Resizer colKey={colKey} />

				{popup}
			</th>
		);
	}

	/* ---------- simple header (also measured to enforce min width) ---------- */
	function PlainHeader({
		label,
		colKey,
		extraClass = ""
	}: {
		label: string;
		colKey: ColKey;
		extraClass?: string;
	}) {
		const contentRef = useRef<HTMLDivElement | null>(null);
		useEffect(() => {
			const el = contentRef.current;
			if (!el) return;
			const needed =
				(el.scrollWidth || el.getBoundingClientRect().width || 0) + 16;
			ensureMinWidth(colKey, needed);
		}, [label, colKey]);

		return (
			<th
				className={`relative ${extraClass}`}
				style={{ width: colWidths[colKey], padding: 0 }}
			>
				<CellPad>
					<div
						ref={contentRef}
						className="select-none overflow-hidden truncate whitespace-nowrap"
					>
						{label}
					</div>
				</CellPad>
				<Resizer colKey={colKey} />
			</th>
		);
	}

	/* ---------- table renderer ---------- */
	function PreviewTable({
		onMeasureRow
	}: {
		onMeasureRow: (h: number) => void;
	}) {
		const total = displayed.length;
		const startIndex = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
		const endIndex = Math.min(
			total - 1,
			Math.ceil((scrollTop + viewportH) / rowH) + overscan
		);
		const visible = total > 0 ? displayed.slice(startIndex, endIndex + 1) : [];

		const measureRowRef = useCallback(
			(el: HTMLTableRowElement | null) => {
				if (!el) return;
				const h = el.getBoundingClientRect().height;
				if (h) onMeasureRow(h);
			},
			[onMeasureRow]
		);

		return (
			<table
				className="table-fixed border-separate border-spacing-0 text-[11px] sm:text-xs"
				style={{ width: tableColsWidth + (hasStretch ? stretchWidth : 0) }}
			>
				<colgroup>
					{COL_ORDER.map((k) => (
						<col key={k} style={{ width: colWidths[k] }} />
					))}
					{hasStretch && <col style={{ width: stretchWidth }} />}
				</colgroup>

				<thead className="sticky top-0 z-20 bg-white dark:bg-[#0e1729] text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25">
					<tr>
						<PlainHeader label="Tidspunkt" colKey="tidspunkt" />
						<HeaderWithFilter label="Type" field="Type" colKey="type" />
						<PlainHeader label="Inn" colKey="inn" extraClass="text-right" />
						<HeaderWithFilter
							label="Inn-Valuta"
							field="Inn-Valuta"
							colKey="innValuta"
						/>
						<PlainHeader label="Ut" colKey="ut" extraClass="text-right" />
						<HeaderWithFilter
							label="Ut-Valuta"
							field="Ut-Valuta"
							colKey="utValuta"
						/>
						<PlainHeader label="Gebyr" colKey="gebyr" extraClass="text-right" />
						<th
							className="relative hidden md:table-cell"
							style={{ width: colWidths.gebyrValuta, padding: 0 }}
						>
							<CellPad>
								<div className="select-none overflow-hidden truncate whitespace-nowrap">
									Gebyr-Valuta
								</div>
							</CellPad>
							<Resizer colKey="gebyrValuta" />
						</th>
						<HeaderWithFilter label="Marked" field="Marked" colKey="marked" />
						<PlainHeader label="Notat" colKey="notat" />
						<th
							className="relative whitespace-nowrap text-center hidden md:table-cell"
							style={{ width: colWidths.explorer }}
						>
							<CellPad>
								<div className="select-none overflow-hidden truncate whitespace-nowrap">
									Explorer
								</div>
							</CellPad>
							<Resizer colKey="explorer" />
						</th>
						{hasStretch && (
							<th
								style={{ width: stretchWidth, padding: 0 }}
								aria-hidden="true"
							/>
						)}
					</tr>
				</thead>

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
						{startIndex > 0 && (
							<tr aria-hidden="true" style={{ height: startIndex * rowH }}>
								<td colSpan={1000} />
							</tr>
						)}

						{visible.map((it, idx) => {
							const r = it.r;
							const idxOriginal = it.i;
							const sig = extractSig(r);
							const solscan = sig ? `https://solscan.io/tx/${sig}` : undefined;
							const rowKey = `${sig ?? "nosig"}-${r.Type}-${r["Inn-Valuta"]}-${
								r["Ut-Valuta"]
							}-${r.Inn}-${r.Ut}-${idxOriginal}`;
							const highlight = sig && highlightSig === sig;
							const globalIndex = startIndex + idx;
							const zebraClass =
								!highlight &&
								(globalIndex % 2 === 1
									? "[&>td]:bg-black/10 dark:[&>td]:bg-white/5"
									: "");

							const attachMeasure = idx === 0 ? { ref: measureRowRef } : {};

							return (
								<tr
									key={rowKey}
									data-sig={sig || undefined}
									data-hl={highlight ? "true" : undefined}
									className={[
										"border-b border-slate-100 dark:border-white/10",
										zebraClass,
										"data-[hl=true]:[&>td]:!bg-amber-50 dark:data-[hl=true]:[&>td]:!bg-amber-500/20"
									].join(" ")}
									{...attachMeasure}
								>
									<td style={{ padding: 0 }}>
										<TidspunktCell
											idxOriginal={idxOriginal}
											value={r.Tidspunkt}
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Type"}
											value={r.Type}
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Inn"}
											value={r.Inn}
											align="right"
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Inn-Valuta"}
											value={r["Inn-Valuta"]}
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Ut"}
											value={r.Ut}
											align="right"
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Ut-Valuta"}
											value={r["Ut-Valuta"]}
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Gebyr"}
											value={r.Gebyr}
											align="right"
											openEditCell={openEditCell}
										/>
									</td>

									<td className="hidden md:table-cell" style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Gebyr-Valuta"}
											value={r["Gebyr-Valuta"]}
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Marked"}
											value={r.Marked}
											title={r.Marked}
											openEditCell={openEditCell}
										/>
									</td>

									<td style={{ padding: 0 }}>
										<EditableCell
											idxOriginal={idxOriginal}
											field={"Notat"}
											value={r.Notat}
											title={r.Notat}
											openEditCell={openEditCell}
										/>
									</td>
									<td className="text-center hidden md:table-cell">
										{solscan ? (
											<Link
												href={solscan}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center justify-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
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

									{hasStretch && (
										<td
											style={{ width: stretchWidth, padding: 0 }}
											aria-hidden="true"
										/>
									)}
								</tr>
							);
						})}

						{endIndex < total - 1 && (
							<tr
								aria-hidden="true"
								style={{ height: (total - endIndex - 1) * rowH }}
							>
								<td colSpan={1000} />
							</tr>
						)}
					</tbody>
				)}
			</table>
		);
	}

	/* ============== RENDER ============== */

	return (
		<section className="mt-6">
			<div
				className={[
					"rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/5 dark:shadow-black/15 ring-1 ring-slate-200/60 dark:ring-slate-800/60",
					isResizingCol ? "select-none cursor-col-resize" : ""
				].join(" ")}
			>
				<div className="p-4 sm:p-10">
					{/* Tabs header */}
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
									persistPreviewScroll();
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
						<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3 max-h-[80vh] sm:max-h-none overflow-y-auto overscroll-contain dark:border-amber-900/40 dark:bg-amber-500/10">
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
											className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm dark:shadow-black/25 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
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
													<span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text:[11px] text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
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
																					className="w-full rounded-md bg-white px-2 py-1.5 text-xs shadow-sm dark:shadow-black/25 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-white/10"
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
						<div className="mt-6">
							{/* Top bar */}
							<div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
									<span>
										Viser {displayed.length} av {effectiveRows.length} rader
										{filterHasAny ? " (filtrert)" : ""}.
									</span>

									{filterHasAny && (
										<button
											type="button"
											onClick={clearAllFilters}
											className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
											title="Nullstill alle filtre"
										>
											Nullstill filtre
										</button>
									)}
								</div>
								<div className="flex flex-wrap items-center gap-2 text-xs">
									<span className="text-slate-600 dark:text-slate-300">
										Sorter:
									</span>
									<select
										value={sortOrder}
										onChange={(e) => setSortOrder(e.target.value as SortOrder)}
										className={SELECT_STYLE}
									>
										<option value="desc">Nyeste først</option>
										<option value="asc">Eldste først</option>
									</select>

									<button
										type="button"
										onClick={undo}
										disabled={!canUndo}
										className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
										title="Angre (Ctrl/⌘+Z)"
									>
										<FiRotateCcw className="h-4 w-4" />
									</button>
									<button
										type="button"
										onClick={redo}
										disabled={!canRedo}
										className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
										title="Gjør om (Ctrl/⌘+Shift+Z eller Ctrl/⌘+Y)"
									>
										<FiRotateCw className="h-4 w-4" />
									</button>

									<button
										type="button"
										onClick={toggleMaximize}
										className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
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

							{/* Embedded preview */}
							{!isMaximized && (
								<>
									<div
										ref={previewContainerRef}
										className={[
											"relative overflow-auto overscroll-contain rounded-t-xl ring-1 ring-slate-200 contain-content dark:ring-white/10",
											isResizingCol ? "select-none cursor-col-resize" : ""
										].join(" ")}
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

							{/* Maximized overlay */}
							{isMaximized && (
								<div
									className="fixed inset-0 z-40 bg-white dark:bg-[#0b1220]"
									onClick={() => setOpenFilter(null)}
								>
									<div className="h-full flex flex-col p-4 sm:p-6">
										<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<div className="text-xs text-slate-600 dark:text-slate-400">
												Viser {displayed.length} av {effectiveRows.length} rader
												{filterHasAny ? " (filtrert)" : ""}.
											</div>
											<div className="flex flex-wrap items-center gap-2 text-xs">
												{filterHasAny && (
													<button
														type="button"
														onClick={clearAllFilters}
														className="rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
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
													className={SELECT_STYLE}
												>
													<option value="desc">Nyeste først</option>
													<option value="asc">Eldste først</option>
												</select>

												<button
													type="button"
													onClick={undo}
													disabled={!canUndo}
													className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
													title="Angre (Ctrl/⌘+Z)"
												>
													<FiRotateCcw className="h-4 w-4" />
												</button>
												<button
													type="button"
													onClick={redo}
													disabled={!canRedo}
													className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
													title="Gjør om (Ctrl/⌘+Shift+Z eller Ctrl/⌘+Y)"
												>
													<FiRotateCw className="h-4 w-4" />
												</button>

												<button
													type="button"
													onClick={toggleMaximize}
													className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
													title="Lukk maksimering"
												>
													<FiMinimize className="h-4 w-4" />
												</button>
											</div>
										</div>

										<div className="flex-1 min-h-0">
											<div
												ref={previewContainerRef}
												className={[
													"h-full overflow-auto overscroll-contain rounded-xl ring-1 ring-slate-200 contain-content dark:ring-white/10",
													isResizingCol ? "select-none cursor-col-resize" : ""
												].join(" ")}
											>
												<PreviewTable onMeasureRow={handleMeasureRow} />
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Actions & help */}
					{previewsReady && (
						<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

					{/* Separated modal editor */}
					<ModalEditor
						open={editOpen}
						onClose={() => setEditOpen(false)}
						rows={rows}
						typeOptions={TYPE_OPTIONS}
						editTarget={editTarget}
						editDraft={editDraft}
						setEditDraft={setEditDraft}
						editScope={editScope}
						setEditScope={setEditScope}
						applyEdit={applyEdit}
					/>

					{/* <div className="mt-6 rounded-xl bg-gradient-to-r from-emerald-50 to-indigo-50 p-4 text-xs text-slate-600 ring-1 ring-slate-200/70 dark:from-[#0b1220] dark:to-[#0b1220] dark:text-slate-300 dark:ring-white/10">
						Mapper: <b>Swaps</b> → <code>Handel</code>, <b>SOL/SPL</b> →{" "}
						<code>Overføring-Inn/Ut</code>, <b>Airdrops</b> →{" "}
						<code>Erverv</code>, <b>staking</b> → <code>Inntekt</code>. Ukjente
						tokens får koden <code>TOKEN-XXXXXX</code>.
					</div> */}
				</div>
			</div>
		</section>
	);
}
