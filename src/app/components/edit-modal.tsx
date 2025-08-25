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

/* ---------- Compact MetaBox (always renders; copy button matches WalletHoldings) ---------- */
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

	const displayValue = isAvailable ? shorten12(raw) : "Ikke tilgjengelig";
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
			{/* Row 1: label + small buttons (copy + open) */}
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

			{/* Row 2: one-line truncated value */}
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
	| "byRecipient";

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
	applyEdit: (mode: EditScope) => void;
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
	const modalCardRef = useRef<HTMLDivElement | null>(null);

	// close on ESC
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open || !editTarget) return null;

	// compute meta values for the three boxes (always render the boxes)
	const currentRow = rows?.[editTarget.idxOriginal];
	const sig =
		editTarget.sig ??
		(currentRow ? extractSig(currentRow as KSPreviewRow) : undefined);
	const signer =
		editTarget.signer ??
		(currentRow && (currentRow as KSPreviewRow).signer) ??
		undefined;
	const recipient = currentRow ? getRecipientFromRow(currentRow) : undefined;

	return (
		<div
			className="fixed inset-0 z-50 bg-black/30 dark:bg-black/40 flex items-center justify-center p-3 sm:p-4"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-dialog-title"
		>
			<div
				ref={modalCardRef}
				className="w-full sm:max-w-2xl rounded-2xl overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-[linear-gradient(180deg,#0e1729_0%,#0b1220_100%)] dark:ring-white/10 flex flex-col max-h-[90vh]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-white/10 dark:bg-[#0e1729]/80">
					<h3
						id="edit-dialog-title"
						className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100"
					>
						Rediger felt: <code className="font-mono">{editTarget.label}</code>
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
						aria-label="Lukk"
					>
						<IoCloseOutline className="h-5 w-5" />
					</button>
				</div>

				<div className="px-3 sm:px-4 py-3 sm:py-4 overflow-y-auto">
					{/* Meta row: ALWAYS show the three boxes (even when missing) */}
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
						<MetaBox
							label="Signatur"
							value={sig}
							link={sig ? `https://solscan.io/tx/${sig}` : undefined}
						/>
						<MetaBox
							label="Signer-adresse"
							value={signer}
							link={signer ? `https://solscan.io/address/${signer}` : undefined}
						/>
						<MetaBox
							label="Mottaker-adresse"
							value={recipient}
							link={
								recipient
									? `https://solscan.io/address/${recipient}`
									: undefined
							}
						/>
					</div>

					<div className="mt-3">
						{editTarget.field === "Type" ? (
							<select
								value={editDraft}
								onChange={(e) => setEditDraft(e.target.value)}
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-900/40"
							>
								{typeOptions.map((t) => (
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
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 font-mono whitespace-pre-wrap break-words min-h-[7rem] dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
								placeholder="Ny verdi…"
							/>
						)}
					</div>
				</div>

				<ModalActions
					rows={rows}
					editScope={editScope}
					setEditScope={setEditScope}
					editTarget={editTarget}
					applyEdit={applyEdit}
					modalRef={modalCardRef}
				/>
			</div>
		</div>
	);
}

/* ===== Modal actions (tooltip via PORTAL so it always shows) ===== */
function ModalActions({
	editScope,
	setEditScope,
	editTarget,
	rows,
	applyEdit,
	modalRef
}: {
	editScope: EditScope;
	setEditScope: (v: EditScope) => void;
	editTarget: EditTarget;
	rows: KSPreviewRow[] | null;
	applyEdit: (mode: EditScope) => void;
	modalRef: React.RefObject<HTMLDivElement | null>;
}) {
	const [open, setOpen] = useState(false);
	const infoBtnRef = useRef<HTMLButtonElement | null>(null);
	const tooltipRef = useRef<HTMLDivElement | null>(null);
	const [coords, setCoords] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);

	// detect if current row has a recipient to enable the "byRecipient" option
	const hasRecipient = useMemo(() => {
		if (!rows || !editTarget) return false;
		const r = rows[editTarget.idxOriginal];
		const v = getRecipientFromRow(r);
		return !!(typeof v === "string" && v.trim());
	}, [rows, editTarget]);

	const computePosition = useCallback(() => {
		if (!open) return;
		const desktop = window.matchMedia("(min-width: 640px)").matches;
		if (desktop && infoBtnRef.current) {
			const r = infoBtnRef.current.getBoundingClientRect();
			setCoords({
				top: r.bottom + 8,
				left: r.left + r.width / 2,
				width: Math.min(352, Math.floor(window.innerWidth * 0.9))
			});
		} else if (!desktop && modalRef.current) {
			const r = modalRef.current.getBoundingClientRect();
			setCoords({
				top: r.bottom + 8,
				left: window.innerWidth / 2,
				width: Math.min(360, Math.floor(window.innerWidth - 24))
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
							transform: "translateX(-50%)",
							width: coords.width,
							zIndex: 100000
						}}
						className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl dark:border-white/10 dark:bg-[#0f172a] dark:text-slate-200"
					>
						<p className="mb-1 font-medium">Hva betyr valgene?</p>
						<ul className="list-disc space-y-1 pl-4">
							<li>
								<b>Bare dette feltet</b> – endrer kun denne cellen (én rad).
							</li>
							<li>
								<b>Alle fra samme signer-adresse</b> – endrer alle rader der
								samme underskriver (signer) har signert.
							</li>
							<li>
								<b>Alle med samme signatur</b> – endrer alle rader som tilhører
								samme transaksjon (signatur).
							</li>
							<li>
								<b>Alle fra samme marked</b> – endrer alle rader med samme verdi
								i <code className="ml-1">Marked</code>-feltet.
							</li>
							<li>
								<b>Alle med samme mottaker-adresse</b> – endrer alle rader som
								har samme mottaker (recipient).
							</li>
						</ul>
					</div>,
					document.body
			  )
			: null;

	return (
		<div className="sticky bottom-0 z-10 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-white/10 dark:bg-[#0e1729]/80">
			<div className="flex flex-col sm:flex-row sm:items-center gap-3">
				<div className="text-[11px] text-slate-500 dark:text-slate-400">
					Velg hvor endringen skal gjelde.
				</div>

				<div className="flex w-full items-center gap-2 sm:gap-3">
					<select
						value={editScope}
						onChange={(e) => setEditScope(e.target.value as EditScope)}
						className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:shadow-black/25 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:ring-indigo-900/40"
					>
						<option value="one">Bare dette feltet</option>
						<option value="bySigner" disabled={!editTarget?.signer}>
							Alle med samme signer-adresse
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
						<option value="byRecipient" disabled={!hasRecipient}>
							Alle med samme mottaker-adresse
						</option>
					</select>

					<button
						ref={infoBtnRef}
						type="button"
						aria-label="Forklaring av alternativer"
						onClick={() => setOpen((v) => !v)}
						className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 dark:focus:bg-white/5"
					>
						<IoInformationCircleOutline className="h-5 w-5" />
					</button>

					{/* push 'Lagre' right */}
					<div className="ml-auto" />

					<button
						type="button"
						onClick={() => applyEdit(editScope)}
						disabled={
							(editScope === "bySigner" && !editTarget?.signer) ||
							(editScope === "bySignature" && !editTarget?.sig) ||
							(editScope === "byRecipient" && !hasRecipient)
						}
						className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
					>
						Lagre
					</button>
				</div>
			</div>

			{tooltipNode}
		</div>
	);
}
