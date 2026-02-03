"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";

export default function VilkarPage() {
	const { tr } = useLocale();
	return (
		<main className="min-h-screen bg-slate-50 dark:bg-[#0b1220] px-4 py-12 flex items-center">
			<div className="mx-auto w-full max-w-3xl flex flex-col">
				<h1 className="text-3xl md:text-4xl font-semibold text-slate-900 dark:text-white mb-6">
					{tr({ no: "Vilkår", en: "Terms" })}
				</h1>
				<p className="text-slate-600 dark:text-slate-300 mb-8">
					{tr({
						no: "Disse vilkårene regulerer bruk av Solana2Kryptosekken.",
						en: "These terms govern the use of Solana2Kryptosekken."
					})}
				</p>

				<section className="space-y-4 text-slate-700 dark:text-slate-200">
					<h2 className="text-xl font-semibold">
						{tr({ no: "1. Tjenestebeskrivelse", en: "1. Service description" })}
					</h2>
					<p>
						{tr({
							no: "Solana2Kryptosekken tilbyr verktøy for eksport og oversikt over transaksjoner og beholdning til bruk i rapportering.",
							en: "Solana2Kryptosekken provides tools for exporting and reviewing transactions and holdings for reporting."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "2. Brukeransvar", en: "2. User responsibility" })}
					</h2>
					<p>
						{tr({
							no: "Du er ansvarlig for korrekt bruk av tjenesten og for å verifisere at rapportene er korrekte før innsending til myndigheter eller tredjeparter.",
							en: "You are responsible for proper use of the service and for verifying that reports are correct before submitting them to authorities or third parties."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "3. Begrensning av ansvar", en: "3. Limitation of liability" })}
					</h2>
					<p>
						{tr({
							no: "Tjenesten leveres som den er. Vi er ikke ansvarlige for indirekte tap eller følger av bruk av tjenesten, inkludert feil i data fra tredjeparter.",
							en: "The service is provided as-is. We are not liable for indirect losses or consequences of using the service, including errors in third-party data."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "4. Endringer", en: "4. Changes" })}
					</h2>
					<p>
						{tr({
							no: "Vi kan oppdatere vilkårene fra tid til annen. Vesentlige endringer varsles gjennom tjenesten.",
							en: "We may update the terms from time to time. Material changes will be communicated through the service."
						})}
					</p>

				</section>

				<div className="mt-10 self-start">
					<Link
						href="/"
						className="inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-white/10 transition"
					>
						{tr({ no: "Tilbake til forsiden", en: "Back to landing page" })}
					</Link>
				</div>
			</div>
		</main>
	);
}
