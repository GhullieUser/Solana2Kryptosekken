// src/lib/kryptosekken.ts
import { formatInTimeZone } from "date-fns-tz";

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
	Tidspunkt: string; // YYYY-MM-DD HH:mm:ss (UTC or Europe/Oslo)
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

export function toNorwayTimeString(
	dateIso: string | number | Date,
	useOslo: boolean
): string {
	const tz = useOslo ? "Europe/Oslo" : "UTC";
	return formatInTimeZone(new Date(dateIso), tz, "yyyy-MM-dd HH:mm:ss");
}

export function toAmountString(n: number | string): string {
	const s = typeof n === "string" ? n : n.toString();
	const [i = "0", f = ""] = s.split(".");
	const cleanI = i.replace(/[^0-9-]/g, "");
	const cleanF = f.replace(/[^0-9]/g, "").slice(0, 18);
	return cleanF ? `${cleanI}.${cleanF}` : cleanI;
}

export function currencyCode(raw: string): string {
	const up = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
	return up.slice(0, 16) || "UNKNOWN";
}

function csvEscape(v: string): string {
	if (v.includes(",") || v.includes("\n") || v.includes('"')) {
		return `"${v.replace(/"/g, '""')}"`;
	}
	return v;
}

export function rowsToCSV(rows: KSRow[]): string {
	const header = [
		"Tidspunkt",
		"Type",
		"Inn",
		"Inn-Valuta",
		"Ut",
		"Ut-Valuta",
		"Gebyr",
		"Gebyr-Valuta",
		"Marked",
		"Notat"
	].join(",");
	const body = rows
		.map((r) =>
			[
				r.Tidspunkt,
				r.Type,
				r.Inn,
				r["Inn-Valuta"],
				r.Ut,
				r["Ut-Valuta"],
				r.Gebyr,
				r["Gebyr-Valuta"],
				r.Marked,
				r.Notat
			]
				.map(csvEscape)
				.join(",")
		)
		.join("\n");
	return `${header}\n${body}\n`;
}
