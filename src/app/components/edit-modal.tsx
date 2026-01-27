"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
	IoCloseOutline,
	IoInformationCircleOutline,
	IoCopyOutline,
	IoCheckmarkCircle,
	IoOpenOutline
} from "react-icons/io5";

import type { KSRow, KSPreviewRow } from "../page";
import StyledSelect from "./styled-select";
import { useLocale } from "./locale-provider";

/* ---------- utils ---------- */
function extractSig(row: KSPreviewRow): string | undefined {
	if (row.signature) return row.signature;
	const m = row.Notat?.match(/sig:([1-9A-HJ-NP-Za-km-z]+)/);
	return m?.[1];
}

/** Try to read a recipient/mottaker field from a row (extend key list if needed). */
function getRecipientFromRow(row: KSPreviewRow | any): string | undefined {
	if (!row) return undefined;
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

/** Try to read a program ID field from a row. */
function getProgramIdFromRow(row: KSPreviewRow | any): string | undefined {
	if (!row) return undefined;
	// Check explicit programId field first (populated from transaction data)
	const v =
		row.programId ??
		row.program_id ??
		row.ProgramId ??
		row["Program ID"] ??
		row.program ??
		row.Program;
	return typeof v === "string" && v.trim() ? v : undefined;
}

function getProgramNameFromRow(row: KSPreviewRow | any): string | undefined {
	if (!row) return undefined;
	const v = row.programName ?? row.program_name ?? row.ProgramName;
	return typeof v === "string" && v.trim() ? v : undefined;
}

function getProgramAddressFromRow(row: KSPreviewRow | any): string | undefined {
	const v = getProgramIdFromRow(row);
	if (!v) return undefined;
	const s = v.trim();
	return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) ? s : undefined;
}

/* ---------- tiny badge for Type ---------- */
function TypeBadge({ type }: { type?: string }) {
	const base =
		"inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1";
	const cls =
		type === "Handel"
			? "ring-indigo-200 bg-indigo-100 text-indigo-700 dark:ring-indigo-900/40 dark:bg-indigo-500/15 dark:text-indigo-300"
			: type === "Overføring-Inn"
			? "ring-emerald-200 bg-emerald-100 text-emerald-700 dark:ring-emerald-900/40 dark:bg-emerald-500/15 dark:text-emerald-300"
			: type === "Overføring-Ut"
			? "ring-rose-200 bg-rose-100 text-rose-700 dark:ring-rose-900/40 dark:bg-rose-500/15 dark:text-rose-300"
			: type === "Erverv"
			? "ring-sky-200 bg-sky-100 text-sky-700 dark:ring-sky-900/40 dark:bg-sky-500/15 dark:text-sky-300"
			: type === "Tap"
			? "ring-amber-200 bg-amber-100 text-amber-800 dark:ring-amber-900/40 dark:bg-amber-500/15 dark:text-amber-300"
			: type === "Inntekt"
			? "ring-green-200 bg-green-100 text-green-700 dark:ring-green-900/40 dark:bg-green-500/15 dark:text-green-300"
			: "ring-slate-200 bg-slate-100 text-slate-700 dark:ring-white/10 dark:bg-white/10 dark:text-slate-200";
	return <span className={`${base} ${cls}`}>{type || "—"}</span>;
}

/* ---------- ONE-LINE row preview (NO gebyr / NO notat) ---------- */
function OneLineRowPreview({ row }: { row: KSPreviewRow | null | undefined }) {
	const { tr } = useLocale();
	if (!row) return null;

	const type = (row as any).Type as string | undefined;
	const marked = (row as any).Marked as string | undefined;
	const time = (row as any).Tidspunkt as string | undefined;

	const innAmt = (row as any).Inn as string | undefined;
	const innSym = (row as any)["Inn-Valuta"] as string | undefined;
	const utAmt = (row as any).Ut as string | undefined;
	const utSym = (row as any)["Ut-Valuta"] as string | undefined;

	const hasVal = (s?: string) =>
		typeof s === "string" && s.trim() && s.replace(/[,\s]/g, ".") !== "0";

	const innText = hasVal(innAmt) ? `${innAmt} ${innSym || ""}`.trim() : "";
	const utText = hasVal(utAmt) ? `${utAmt} ${utSym || ""}`.trim() : "";

	const titleParts = [
		type ? `${tr({ no: "Type", en: "Type" })}: ${type}` : "",
		marked ? `${tr({ no: "Marked", en: "Market" })}: ${marked}` : "",
		time ? `${tr({ no: "Tid", en: "Time" })}: ${time}` : "",
		innText ? `${tr({ no: "Inn", en: "In" })}: ${innText}` : "",
		utText ? `${tr({ no: "Ut", en: "Out" })}: ${utText}` : ""
	].filter(Boolean);
	const title = titleParts.join(" • ");

	return (
		<div
			className="mt-2 rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white/70 dark:border-white/10 dark:bg-white/5"
			title={title}
		>
			{/* key changes: allow wrapping on mobile, no overflow clipping */}
			<div className="flex items-center gap-2 flex-wrap sm:flex-nowrap whitespace-normal sm:whitespace-nowrap overflow-visible">
				<TypeBadge type={type} />

				{/* INN chip */}
				{innText ? (
					<span className="min-w-0 max-w-full sm:max-w-[34%] truncate inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-emerald-200 bg-emerald-50 text-emerald-700 dark:ring-emerald-900/40 dark:bg-emerald-500/10 dark:text-emerald-300">
						<span className="opacity-70">{tr({ no: "Inn", en: "In" })}</span>
						<span className="font-mono truncate">{innText}</span>
					</span>
				) : null}

				{/* UT chip */}
				{utText ? (
					<span className="min-w-0 max-w-full sm:max-w-[34%] truncate inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-rose-200 bg-rose-50 text-rose-700 dark:ring-rose-900/40 dark:bg-rose-500/10 dark:text-rose-300">
						<span className="opacity-70">{tr({ no: "Ut", en: "Out" })}</span>
						<span className="font-mono truncate">{utText}</span>
					</span>
				) : null}

				{/* Market tag (small) */}
				{marked ? (
					<span className="hidden sm:inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-slate-200 bg-slate-100 text-slate-700 dark:ring-white/10 dark:bg-white/10 dark:text-slate-200 truncate max-w-[18%]">
						{marked}
					</span>
				) : null}

				{/* Time — on mobile it wraps to its own line at the end */}
				<span className="order-last w-full mt-1 text-right text-[12px] text-slate-600 dark:text-slate-300 sm:order-none sm:w-auto sm:mt-0 sm:ml-auto sm:text-inherit sm:truncate sm:max-w-[22%]">
					{time || ""}
				</span>

				{!innText && !utText ? (
					<span className="text-[12px] text-slate-500 dark:text-slate-400">
						—
					</span>
				) : null}
			</div>
		</div>
	);
}

/* ---------- Compact address display ---------- */
function CompactAddress({
	label,
	value,
	copyValue,
	link
}: {
	label: string;
	value?: string | null;
	copyValue?: string | null;
	link?: string;
}) {
	const { tr } = useLocale();
	const [justCopied, setJustCopied] = useState(false);
	const isAvailable = typeof value === "string" && value.trim().length > 0;
	const raw = (value || "").trim();
	const copyRaw = (copyValue ?? raw).trim();

	const shorten = (s: string) => {
		if (s.length <= 13) return s;
		// Check if it's an address
		if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) {
			return `${s.slice(0, 5)}…${s.slice(-5)}`;
		}
		return s;
	};

	const displayValue = isAvailable ? shorten(raw) : "—";

	const onCopy = useCallback(async () => {
		if (!isAvailable) return;
		try {
			await navigator.clipboard.writeText(copyRaw || raw);
			setJustCopied(true);
			setTimeout(() => setJustCopied(false), 1200);
		} catch {}
	}, [isAvailable, copyRaw, raw]);

	return (
		<div className="rounded border border-slate-200 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-white/5 group">
			<div className="flex items-center justify-between gap-2">
				<div className="flex-1 min-w-0">
					<div className="text-[9px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
						{label}
					</div>
					<div
						className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate"
						title={
							isAvailable
								? copyRaw && copyRaw !== raw
									? `${raw} (${copyRaw})`
									: raw
								: tr({ no: "Ikke tilgjengelig", en: "Not available" })
						}
					>
						{displayValue}
					</div>
				</div>
				<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
					<button
						type="button"
						onClick={onCopy}
						disabled={!isAvailable}
						className="p-0.5 hover:bg-slate-200 dark:hover:bg-white/20 rounded disabled:opacity-30"
						title={
							justCopied
								? tr({ no: "Kopiert!", en: "Copied!" })
								: tr({ no: "Kopier", en: "Copy" })
						}
					>
						{justCopied ? (
							<IoCheckmarkCircle className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
						) : (
							<IoCopyOutline className="h-3 w-3" />
						)}
					</button>
					{link && isAvailable && (
						<Link
							href={link}
							target="_blank"
							rel="noopener noreferrer"
							className="p-0.5 hover:bg-slate-200 dark:hover:bg-white/20 rounded"
							title={tr({ no: "Åpne i explorer", en: "Open in explorer" })}
						>
							<IoOpenOutline className="h-3 w-3" />
						</Link>
					)}
				</div>
			</div>
		</div>
	);
}

/* ---------- Compact MetaBox (copy + open) ---------- */
function MetaBox({
	label,
	value,
	link
}: {
	label: string;
	value?: string | null;
	link?: string;
}) {
	const [justCopied, setJustCopied] = useState(false);

	const btnSm =
		"inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] " +
		"ring-1 ring-slate-200 hover:bg-slate-100 " +
		"dark:ring-slate-700 dark:hover:bg-white/10 " +
		"disabled:opacity-50 disabled:cursor-not-allowed";

	const isAvailable = typeof value === "string" && value.trim().length > 0;
	const raw = (value || "").trim();

	const shorten12 = (s: string, start = 6, end = 6) => {
		if (s.length <= start + end + 1) return s;
		return `${s.slice(0, start)}…${s.slice(-end)}`;
	};

	// Only shorten if it looks like a Solana address (base58, 32-44 chars)
	const looksLikeAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw);
	const displayValue = isAvailable
		? looksLikeAddress
			? shorten12(raw)
			: raw
		: "Ikke tilgjengelig";
	const titleValue = isAvailable ? raw : "Ikke tilgjengelig";

	const onCopy = useCallback(async () => {
		if (!isAvailable) return;
		try {
			await navigator.clipboard.writeText(raw);
		} catch {
			// Fallback for older browsers
			const ta = document.createElement("textarea");
			ta.value = raw;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand("copy");
			} finally {
				document.body.removeChild(ta);
			}
		}
		setJustCopied(true);
		setTimeout(() => setJustCopied(false), 1200);
	}, [isAvailable, raw]);

	return (
		<div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 dark:border-white/10 dark:bg-white/5">
			<div className="flex items-center justify-between gap-2">
				<div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
					{label}
				</div>
				<div className="shrink-0 inline-flex items-center gap-1">
					<button
						type="button"
						onClick={onCopy}
						className={btnSm}
						aria-label={isAvailable ? "Kopier" : "Ikke tilgjengelig"}
						title={
							isAvailable
								? justCopied
									? "Kopiert!"
									: "Kopier"
								: "Ikke tilgjengelig"
						}
						disabled={!isAvailable}
					>
						{justCopied ? (
							<IoCheckmarkCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
						) : (
							<IoCopyOutline className="h-3.5 w-3.5" />
						)}
					</button>

					{link ? (
						isAvailable ? (
							<Link
								href={link}
								target="_blank"
								rel="noopener noreferrer"
								className={btnSm}
								aria-label="Åpne i explorer"
								title="Åpne i explorer"
							>
								<IoOpenOutline className="h-3.5 w-3.5" />
							</Link>
						) : (
							<button
								type="button"
								className={btnSm}
								aria-label="Ikke tilgjengelig"
								title="Ikke tilgjengelig"
								disabled
							>
								<IoOpenOutline className="h-3.5 w-3.5" />
							</button>
						)
					) : null}
				</div>
			</div>

			<div
				className={
					"mt-1 font-mono text-[12px] truncate whitespace-nowrap " +
					(isAvailable
						? "text-slate-800 dark:text-slate-200"
						: "text-slate-400 italic")
				}
				title={titleValue}
			>
				{displayValue}
			</div>
		</div>
	);
}

/* ---------- types for the modal ---------- */
export type EditScope =
	| "one"
	| "bySigner"
	| "bySignature"
	| "byMarked"
	| "byRecipient"
	| "bySender"
	| "byProgramId"
	| "byVisible";

export type TextEditMode = "replace" | "prefix" | "suffix";

type FieldKey = keyof KSRow;

export type EditTarget = {
	idxOriginal: number;
	field: FieldKey;
	sig?: string;
	signer?: string;
	label: string;
} | null;

type Props = {
	open: boolean;
	onClose: () => void;

	/** data/context */
	rows: KSPreviewRow[] | null;
	typeOptions: readonly string[];

	/** edit state */
	editTarget: EditTarget;
	editDraft: string;
	setEditDraft: (v: string) => void;

	editScope: EditScope;
	setEditScope: (v: EditScope) => void;

	/** apply */
	applyEdit: (
		mode: EditScope,
		textEditMode?: TextEditMode,
		valueOverride?: string
	) => void;
};

export default function ModalEditor({
	open,
	onClose,
	rows,
	typeOptions,
	editTarget,
	editDraft,
	setEditDraft,
	editScope,
	setEditScope,
	applyEdit
}: Props) {
	const { tr } = useLocale();
	const modalCardRef = useRef<HTMLDivElement | null>(null);
	const backdropMouseDownRef = useRef(false);
	const [mounted, setMounted] = useState(false);
	const [textEditMode, setTextEditMode] = useState<TextEditMode>("replace");
	const currentRow = useMemo(() => {
		if (!rows || !editTarget) return undefined;
		return rows[editTarget.idxOriginal];
	}, [rows, editTarget]);
	const currentFieldValue = useMemo(() => {
		if (!currentRow || !editTarget) return "";
		const v = (currentRow as any)[editTarget.field];
		return typeof v === "string" ? v : v == null ? "" : String(v);
	}, [currentRow, editTarget]);
	const notatPreviewValue = useMemo(() => {
		if (!editTarget || editTarget.field !== "Notat") return "";
		if (textEditMode === "replace") return editDraft;
		if (textEditMode === "prefix") return `${editDraft}${currentFieldValue}`;
		return `${currentFieldValue}${editDraft}`;
	}, [editTarget, textEditMode, editDraft, currentFieldValue]);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!open) return;
		setTextEditMode("replace");
	}, [open, editTarget?.field]);

	useEffect(() => {
		if (!open) return;
		if (editTarget?.field !== "Notat") return;
		if (textEditMode === "replace") {
			setEditDraft(currentFieldValue);
		} else {
			setEditDraft("");
		}
	}, [open, editTarget?.field, textEditMode, currentFieldValue, setEditDraft]);

	// close on ESC
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!mounted || typeof document === "undefined" || !open || !editTarget)
		return null;

	// meta values (shown above the preview)
	const sig =
		editTarget.sig ??
		(currentRow ? extractSig(currentRow as KSPreviewRow) : undefined);
	const signer =
		editTarget.signer ??
		(currentRow && (currentRow as KSPreviewRow).signer) ??
		undefined;
	const recipient = currentRow ? getRecipientFromRow(currentRow) : undefined;
	const programAddress = currentRow
		? getProgramAddressFromRow(currentRow)
		: undefined;
	const programName = currentRow
		? getProgramNameFromRow(currentRow)
		: undefined;
	const programDisplay = programAddress || undefined;

	return createPortal(
		<div
			className="fixed inset-0 z-50 bg-black/30 dark:bg-black/40 flex items-center justify-center p-3 sm:p-4"
			onMouseDown={(e) => {
				backdropMouseDownRef.current = e.target === e.currentTarget;
			}}
			onMouseUp={(e) => {
				if (backdropMouseDownRef.current && e.target === e.currentTarget) {
					onClose();
				}
				backdropMouseDownRef.current = false;
			}}
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-dialog-title"
		>
			<div
				ref={modalCardRef}
				className="w-full sm:max-w-2xl rounded-2xl overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-[linear-gradient(180deg,#0e1729_0%,#0b1220_100%)] dark:ring-white/10 flex flex-col max-h[90vh]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-white/10 dark:bg-[#0e1729]/80">
					<h3
						id="edit-dialog-title"
						className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100"
					>
						{tr({ no: "Rediger felt:", en: "Edit field:" })}{" "}
						<code className="font-mono">{editTarget.label}</code>
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
						aria-label={tr({ no: "Lukk", en: "Close" })}
					>
						<IoCloseOutline className="h-5 w-5" />
					</button>
				</div>

				<div className="px-3 sm:px-4 py-3 sm:py-4 overflow-y-auto">
					{/* Transaction metadata - compact layout */}
					<div className="space-y-2 mb-3">
						{/* Signature */}
						<MetaBox
							label="Signatur"
							value={sig}
							link={sig ? `https://solscan.io/tx/${sig}` : undefined}
						/>

						{/* Compact address row */}
						<div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
							<CompactAddress
								label="Signer"
								value={signer}
								link={
									signer ? `https://solscan.io/address/${signer}` : undefined
								}
							/>
							<CompactAddress
								label="Avsender"
								value={getSenderFromRow(currentRow)}
								link={
									getSenderFromRow(currentRow)
										? `https://solscan.io/address/${getSenderFromRow(
												currentRow
										  )}`
										: undefined
								}
							/>
							<CompactAddress
								label="Mottaker"
								value={recipient}
								link={
									recipient
										? `https://solscan.io/address/${recipient}`
										: undefined
								}
							/>
							<CompactAddress
								label="Program ID"
								value={programDisplay}
								copyValue={programAddress}
								link={
									programAddress
										? `https://solscan.io/account/${programAddress}`
										: undefined
								}
							/>
						</div>
					</div>

					{/* ONE-LINE preview (no Gebyr / no Notat) */}
					<OneLineRowPreview row={currentRow} />

					<div className="mt-3">
						{editTarget.field === "Type" ? (
							<StyledSelect
								value={editDraft}
								onChange={(v) => setEditDraft(v)}
								usePortal
								placement="bottom"
								buttonClassName="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 bg-white shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-900/40"
								options={typeOptions.map((t) => ({ value: t, label: t }))}
								ariaLabel="Velg type"
							/>
						) : (
							<>
								{editTarget.field === "Notat" ? (
									<div className="mb-2 flex items-center gap-2">
										<label className="text-xs text-slate-600 dark:text-slate-300">
											Modus
										</label>
										<StyledSelect
											value={textEditMode}
											onChange={(v) => setTextEditMode(v as TextEditMode)}
											buttonClassName="min-w-[9.5rem] inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
											options={[
												{ value: "replace", label: "Erstatt" },
												{ value: "prefix", label: "Prefiks" },
												{ value: "suffix", label: "Suffiks" }
											]}
											ariaLabel="Hvordan Notat skal endres"
										/>
									</div>
								) : null}

								{editTarget.field === "Notat" && textEditMode !== "replace" ? (
									<div className="grid grid-cols-1 gap-2">
										{textEditMode === "prefix" ? (
											<>
												<textarea
													rows={3}
													autoFocus
													value={editDraft}
													onChange={(e) => setEditDraft(e.target.value)}
													className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 font-mono whitespace-pre-wrap break-words dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
													placeholder="Skriv prefiks (ny tekst før)…"
												/>
												<textarea
													rows={4}
													readOnly
													tabIndex={-1}
													value={notatPreviewValue}
													className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-500 shadow-sm dark:shadow-black/25 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
													aria-readonly="true"
												/>
											</>
										) : (
											<>
												<textarea
													rows={4}
													readOnly
													tabIndex={-1}
													value={notatPreviewValue}
													className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-500 shadow-sm dark:shadow-black/25 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
													aria-readonly="true"
												/>
												<textarea
													rows={3}
													autoFocus
													value={editDraft}
													onChange={(e) => setEditDraft(e.target.value)}
													className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 font-mono whitespace-pre-wrap break-words dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
													placeholder="Skriv suffiks (ny tekst etter)…"
												/>
											</>
										)}
									</div>
								) : (
									<textarea
										rows={6}
										autoFocus
										value={editDraft}
										onChange={(e) => setEditDraft(e.target.value)}
										className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 font-mono whitespace-pre-wrap break-words min-h-[7rem] dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
										placeholder="Ny verdi…"
									/>
								)}
							</>
						)}
					</div>
				</div>

				<ModalActions
					rows={rows}
					editScope={editScope}
					setEditScope={setEditScope}
					editTarget={editTarget}
					textEditMode={editTarget.field === "Notat" ? textEditMode : "replace"}
					applyEdit={applyEdit}
					modalRef={modalCardRef}
				/>
			</div>
		</div>,
		document.body
	);
}

/* ===== Modal actions (tooltip via PORTAL so it always shows) ===== */
function ModalActions({
	editScope,
	setEditScope,
	editTarget,
	rows,
	textEditMode,
	applyEdit,
	modalRef
}: {
	editScope: EditScope;
	setEditScope: (v: EditScope) => void;
	editTarget: EditTarget;
	rows: KSPreviewRow[] | null;
	textEditMode: TextEditMode;
	applyEdit: (
		mode: EditScope,
		textEditMode?: TextEditMode,
		valueOverride?: string
	) => void;
	modalRef: React.RefObject<HTMLDivElement | null>;
}) {
	const { tr } = useLocale();
	const [open, setOpen] = useState(false);
	const infoBtnRef = useRef<HTMLButtonElement | null>(null);
	const tooltipRef = useRef<HTMLDivElement | null>(null);
	const [coords, setCoords] = useState<{
		top: number;
		left: number;
		width: number;
		openUp: boolean;
	} | null>(null);

	// detect if current row has a recipient to enable the "byRecipient" option
	const hasRecipient = useMemo(() => {
		if (!rows || !editTarget) return false;
		const r = rows[editTarget.idxOriginal];
		const v = getRecipientFromRow(r);
		return !!(typeof v === "string" && v.trim());
	}, [rows, editTarget]);

	// detect if current row has a sender to enable the "bySender" option
	const hasSender = useMemo(() => {
		if (!rows || !editTarget) return false;
		const r = rows[editTarget.idxOriginal];
		const v = getSenderFromRow(r);
		return !!(typeof v === "string" && v.trim());
	}, [rows, editTarget]);

	// detect if current row has a program ID to enable the "byProgramId" option
	const hasProgramId = useMemo(() => {
		if (!rows || !editTarget) return false;
		const r = rows[editTarget.idxOriginal];
		const v = getProgramIdFromRow(r);
		return !!(typeof v === "string" && v.trim());
	}, [rows, editTarget]);

	const computePosition = useCallback(() => {
		if (!open) return;
		const desktop = window.matchMedia("(min-width: 640px)").matches;
		if (desktop && infoBtnRef.current) {
			const r = infoBtnRef.current.getBoundingClientRect();
			const spaceBelow = window.innerHeight - r.bottom;
			const spaceAbove = r.top;
			const openUp = spaceBelow < spaceAbove;
			setCoords({
				top: openUp ? r.top - 8 : r.bottom + 8,
				left: r.left + r.width / 2,
				width: Math.min(352, Math.floor(window.innerWidth * 0.9)),
				openUp
			});
		} else if (!desktop && modalRef.current) {
			const r = modalRef.current.getBoundingClientRect();
			const spaceBelow = window.innerHeight - r.bottom;
			const spaceAbove = r.top;
			const openUp = spaceBelow < spaceAbove;
			setCoords({
				top: openUp ? r.top - 8 : r.bottom + 8,
				left: window.innerWidth / 2,
				width: Math.min(360, Math.floor(window.innerWidth - 24)),
				openUp
			});
		}
	}, [open, modalRef]);

	useEffect(() => {
		if (!open) return;
		computePosition();
		const onScroll = () => computePosition();
		const onResize = () => computePosition();
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		};
	}, [open, computePosition]);

	useEffect(() => {
		function onDown(e: MouseEvent) {
			if (!open) return;
			const t = e.target as Node;
			if (
				tooltipRef.current &&
				!tooltipRef.current.contains(t) &&
				infoBtnRef.current &&
				!infoBtnRef.current.contains(t)
			) {
				setOpen(false);
			}
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const tooltipNode =
		open && coords
			? createPortal(
					<div
						ref={tooltipRef}
						role="tooltip"
						style={{
							position: "fixed",
							top: coords.top,
							left: coords.left,
							transform: coords.openUp
								? "translate(-50%, -100%)"
								: "translateX(-50%)",
							width: coords.width,
							zIndex: 100000
						}}
						className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl dark:border-white/10 dark:bg-[#0f172a] dark:text-slate-200"
					>
						<p className="mb-1 font-medium">
							{tr({
								no: "Hva betyr valgene?",
								en: "What do these options mean?"
							})}
						</p>
						<ul className="list-disc space-y-1 pl-4">
							<li>
								<b>{tr({ no: "Bare dette feltet", en: "Only this field" })}</b>{" "}
								–{" "}
								{tr({
									no: "endrer kun denne cellen (én rad).",
									en: "changes only this cell (one row)."
								})}
							</li>
							<li>
								<b>
									{tr({
										no: "Alle med samme signer-adresse",
										en: "All with same signer address"
									})}
								</b>{" "}
								–{" "}
								{tr({
									no: "endrer alle rader der samme underskriver (signer) har signert.",
									en: "changes all rows signed by the same signer."
								})}
							</li>
							<li>
								<b>
									{tr({
										no: "Alle med samme avsender-adresse",
										en: "All with same sender address"
									})}
								</b>{" "}
								–{" "}
								{tr({
									no: "endrer alle rader som har samme avsender/fra-adresse.",
									en: "changes all rows with the same sender/from address."
								})}
							</li>
							<li>
								<b>
									{tr({
										no: "Alle med samme signatur",
										en: "All with same signature"
									})}
								</b>{" "}
								–{" "}
								{tr({
									no: "endrer alle rader som tilhører samme transaksjon (signatur).",
									en: "changes all rows belonging to the same transaction (signature)."
								})}
							</li>
							<li>
								<b>
									{tr({
										no: "Alle fra samme marked",
										en: "All from same market"
									})}
								</b>{" "}
								–{" "}
								{tr({
									no: "endrer alle rader med samme verdi i ",
									en: "changes all rows with the same value in the "
								})}
								<code className="ml-1">Marked</code>
								{tr({ no: "-feltet.", en: " field." })}
							</li>
							<li>
								<b>
									{tr({
										no: "Alle med samme mottaker-adresse",
										en: "All with same recipient address"
									})}
								</b>{" "}
								–{" "}
								{tr({
									no: "endrer alle rader som har samme mottaker (recipient).",
									en: "changes all rows with the same recipient."
								})}
							</li>
							<li>
								<b>
									{tr({
										no: "Alle med samme program ID",
										en: "All with same program ID"
									})}
								</b>{" "}
								–{" "}
								{tr({
									no: "endrer alle rader som har samme program-adresse (Program ID).",
									en: "changes all rows with the same program address (program ID)."
								})}
							</li>
							<li>
								<b>{tr({ no: "Kun synlige", en: "Only visible" })}</b> –{" "}
								{tr({
									no: "endrer alle rader som er synlige etter gjeldende filtre.",
									en: "changes all rows currently visible after filters."
								})}
							</li>
						</ul>
					</div>,
					document.body
			  )
			: null;

	return (
		<div className="sticky bottom-0 z-10 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-white/10 dark:bg-[#0e1729]/80">
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<div className="text-[11px] text-slate-500 dark:text-slate-400">
						{tr({
							no: "Velg hvor endringen skal gjelde.",
							en: "Choose where the change should apply."
						})}
					</div>
					<button
						ref={infoBtnRef}
						type="button"
						aria-label={tr({
							no: "Forklaring av alternativer",
							en: "Explain options"
						})}
						onClick={() => setOpen((v) => !v)}
						className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10 dark:focus:bg-white/10"
					>
						<IoInformationCircleOutline className="h-5 w-5" />
					</button>
				</div>

				<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
					<StyledSelect
						value={editScope}
						onChange={(v) => setEditScope(v as EditScope)}
						usePortal
						placement="auto"
						buttonClassName="w-full sm:flex-1 min-w-[280px] sm:min-w-[420px] inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
						options={[
							{ value: "one", label: "Bare dette feltet" },
							{
								value: "bySigner",
								label: "Alle med samme signer-adresse",
								disabled: !editTarget?.signer
							},
							{
								value: "bySender",
								label: "Alle med samme avsender-adresse",
								disabled: !hasSender
							},
							{
								value: "bySignature",
								label: "Alle med samme signatur",
								disabled: !editTarget?.sig
							},
							{
								value: "byMarked",
								label: "Alle fra samme marked",
								disabled: !rows?.[editTarget?.idxOriginal ?? 0]?.Marked?.trim()
							},
							{
								value: "byRecipient",
								label: "Alle med samme mottaker-adresse",
								disabled: !hasRecipient
							},
							{
								value: "byProgramId",
								label: "Alle med samme program ID",
								disabled: !hasProgramId
							},
							{ value: "byVisible", label: "Kun synlige" }
						]}
						ariaLabel={tr({ no: "Velg omfang", en: "Choose scope" })}
					/>

					{(() => {
						const scopeDisabled =
							(editScope === "bySigner" && !editTarget?.signer) ||
							(editScope === "bySender" && !hasSender) ||
							(editScope === "bySignature" && !editTarget?.sig) ||
							(editScope === "byRecipient" && !hasRecipient) ||
							(editScope === "byProgramId" && !hasProgramId);
						return (
							<div className="flex items-center gap-2 sm:ml-auto">
								<button
									type="button"
									onClick={() => applyEdit(editScope, textEditMode)}
									disabled={scopeDisabled}
									className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
								>
									{tr({ no: "Lagre", en: "Save" })}
								</button>
							</div>
						);
					})()}
				</div>
			</div>

			{tooltipNode}
		</div>
	);
}

/** Try to read a sender/avsender field from a row (extend key list if needed). */
function getSenderFromRow(row: KSPreviewRow | any): string | undefined {
	if (!row) return undefined;
	// For Overføring-Inn (incoming), the sender is the 'other party' (not signer)
	// For Overføring-Ut (outgoing), the sender is the signer (self)
	// For other types, sender is typically the signer
	if (row.Type === "Overføring-Inn") {
		// For incoming transfers, we need to find who sent it (not who received it)
		// The recipient field for Overføring-Inn is self, so sender would be the counterparty
		// But this info isn't directly stored, so try fallback fields
		const v =
			row.sender ??
			row.Sender ??
			row.fra ??
			row.Fra ??
			row.from ??
			row.From ??
			row["Avsender-adresse"] ??
			row["Fra-adresse"] ??
			row["sender-adresse"];
		return typeof v === "string" && v.trim() ? v : undefined;
	}
	// For outgoing or other types, signer is the sender
	return row.signer && typeof row.signer === "string" && row.signer.trim()
		? row.signer
		: undefined;
}
