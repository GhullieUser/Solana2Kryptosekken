"use client";

import Link from "next/link";
import {
	FiExternalLink,
	FiDownload,
	FiUploadCloud,
	FiFileText
} from "react-icons/fi";
import type { IconType } from "react-icons";

type Props = {
	cardClassName?: string;
	importHref?: string;
};

type Step = {
	n: number;
	label: React.ReactNode;
	Icon: IconType;
};

export default function KryptosekkenImportCard({
	cardClassName = "rounded-3xl bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/5 dark:shadow-black/15 ring-1 ring-slate-200/60 dark:ring-slate-800/60",
	importHref = "https://www.kryptosekken.no/regnskap/importer-csv-generisk"
}: Props) {
	const steps: readonly Step[] = [
		{
			n: 1,
			label: (
				<>
					Trykk <b>Last ned CSV</b> fra denne siden.
				</>
			),
			Icon: FiDownload
		},
		{
			n: 2,
			label: (
				<>
					Åpne <b>Kryptosekken → Generisk import</b>.
				</>
			),
			Icon: FiFileText
		},
		{
			n: 3,
			label: (
				<>
					<b>Dra og slipp</b> CSV-filen og fullfør importen.
				</>
			),
			Icon: FiUploadCloud
		}
	];

	const numBadge =
		"flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white dark:bg-indigo-500 text-sm font-semibold shadow-sm";
	const iconBox = "inline-grid place-items-center h-5 w-5";
	const iconCn = "h-4 w-4 shrink-0";
	const lineCn = "h-[2px] w-full bg-slate-200 dark:bg-slate-700 rounded";

	function StepText({ step }: { step: Step }) {
		const Icon = step.Icon;
		return (
			<div className="inline-flex items-center gap-2 text-sm leading-6 text-slate-700 dark:text-slate-300 max-w-[22rem] justify-center">
				<span className={iconBox}>
					<Icon className={iconCn} aria-hidden />
				</span>
				<span>{step.label}</span>
			</div>
		);
	}

	return (
		<div className={cardClassName}>
			<div className="p-4 sm:p-6">
				{/* Header */}
				<div className="mb-5 flex items-start justify-between gap-3 ">
					<h2 className="text-base sm:text-lg font-semibold text-slate-800 dark:text-slate-100">
						Importer i Kryptosekken
					</h2>
					<div className="shrink-0">
						<Link
							href={importHref}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-slate-50 dark:hover:bg-white/10"
						>
							Åpne Kryptosekken import
							<FiExternalLink className="h-4 w-4" aria-hidden />
						</Link>
					</div>
				</div>

				{/* MOBILE: vertical list (badge + text per row) */}
				<ol className="sm:hidden space-y-3" aria-label="Import-steg">
					{steps.map((step) => (
						<li
							key={step.n}
							className="grid grid-cols-[36px_1fr] items-start gap-3"
						>
							<span className={numBadge}>{step.n}</span>
							<StepText step={step} />
						</li>
					))}
				</ol>

				{/* DESKTOP: equal-width columns; badges on row 1, text on row 2 */}
				<div
					className="relative hidden sm:grid grid-cols-[1fr_auto_1fr_auto_1fr] auto-rows-auto gap-x-4"
					aria-label="Import-steg"
				>
					{/* Row 1: badges + connecting lines */}
					<div className="col-[1/2] flex justify-center">
						<span className={numBadge}>{steps[0].n}</span>
					</div>
					<div className="col-[2/3] self-center">
						<div className={lineCn} />
					</div>
					<div className="col-[3/4] flex justify-center">
						<span className={numBadge}>{steps[1].n}</span>
					</div>
					<div className="col-[4/5] self-center">
						<div className={lineCn} />
					</div>
					<div className="col-[5/6] flex justify-center">
						<span className={numBadge}>{steps[2].n}</span>
					</div>

					{/* Row 2: text under each badge */}
					<div className="col-[1/2] mt-3 flex justify-center">
						<StepText step={steps[0]} />
					</div>
					<div className="col-[3/4] mt-3 flex justify-center">
						<StepText step={steps[1]} />
					</div>
					<div className="col-[5/6] mt-3 flex justify-center">
						<StepText step={steps[2]} />
					</div>
				</div>
			</div>
		</div>
	);
}
