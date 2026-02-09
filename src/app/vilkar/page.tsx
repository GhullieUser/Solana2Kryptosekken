"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";

export default function VilkarPage() {
	const { tr } = useLocale();
	return (
		<main className="min-h-screen bg-slate-50 dark:bg-[#0b1220] px-4 pt-24 sm:pt-28 pb-12">
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
						{tr({ no: "3. Salgsvilkår", en: "3. Sales terms" })}
					</h2>
					<ul className="list-disc pl-6 space-y-2">
						<li>
							{tr({
								no: "Parter: Avtalen inngås mellom kunden og ARTBYMI.",
								en: "Parties: The agreement is between the customer and ARTBYMI."
							})}
						</li>
						<li>
							{tr({
								no: "Betaling: Betaling skjer via tilgjengelige betalingsmetoder ved kjøp.",
								en: "Payment: Payment is made using the available payment methods at checkout."
							})}
						</li>
						<li>
							{tr({
								no: "Levering: Tjenesten leveres digitalt og er tilgjengelig umiddelbart etter bekreftet betaling.",
								en: "Delivery: The service is delivered digitally and is available immediately after confirmed payment."
							})}
						</li>
						<li>
							{tr({
								no: "Angrerett: Angrerett følger angrerettloven. Dersom levering av digitalt innhold starter umiddelbart etter ditt samtykke, kan angreretten bortfalle.",
								en: "Right of withdrawal: This follows the Norwegian Right of Withdrawal Act. If delivery of digital content starts immediately after your consent, the right of withdrawal may be waived."
							})}
						</li>
						<li>
							{tr({
								no: "Retur: Digitale tjenester/credits kan ikke returneres etter bruk.",
								en: "Returns: Digital services/credits cannot be returned after use."
							})}
						</li>
					</ul>

					<h2 className="text-xl font-semibold">
						{tr({
							no: "4. Produktinformasjon og priser",
							en: "4. Product information and pricing"
						})}
					</h2>
					<p>
						{tr({
							no: "Vi tilbyr omfattende søk i Solana-blokkjeden for å hjelpe kunder med å finne transaksjonshistorikken sin og spare tid på skattemeldingen. Sol2KS Lommebok Skanner er skreddersydd for å fungere med skatterapporteringssystemet kryptosekken.no.",
							en: "We provide a software-as-a-service that performs extensive searches of the Solana blockchain so users can retrieve their transaction history for tax reporting. The Sol2KS Wallet Scanner is tailored to work with the tax reporting system kryptosekken.no."
						})}
					</p>
					<p>
						{tr({
							no: "TX credits fungerer som valuta for den digitale tjenesten. Hver rå transaksjon som skannes forbruker 1 TX credit, og du kan kjøpe pakker med credits ved behov.",
							en: "TX credits act as the usage-based currency for the digital service. Each raw transaction scanned consumes 1 TX credit, and you can purchase packages as needed."
						})}
					</p>
					<p>
						<Link
							href="/pricing"
							className="text-indigo-600 dark:text-indigo-300 hover:underline"
						>
							{tr({ no: "Se priser", en: "View pricing" })}
						</Link>
					</p>

					<h2 className="text-xl font-semibold">
						{tr({
							no: "6. Begrensning av ansvar",
							en: "6. Limitation of liability"
						})}
					</h2>
					<p>
						{tr({
							no: "Tjenesten leveres som den er. Vi er ikke ansvarlige for indirekte tap eller følger av bruk av tjenesten, inkludert feil i data fra tredjeparter.",
							en: "The service is provided as-is. We are not liable for indirect losses or consequences of using the service, including errors in third-party data."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "7. Endringer", en: "7. Changes" })}
					</h2>
					<p>
						{tr({
							no: "Vi kan oppdatere vilkårene fra tid til annen. Vesentlige endringer varsles gjennom tjenesten.",
							en: "We may update the terms from time to time. Material changes will be communicated through the service."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({
							no: "8. Firma- og kontaktinformasjon",
							en: "8. Company and contact information"
						})}
					</h2>
					<ul className="list-disc pl-6 space-y-2">
						<li>
							{tr({ no: "Firmanavn: ARTBYMI", en: "Company name: ARTBYMI" })}
						</li>
						<li>
							{tr({
								no: "Organisasjonsnummer: 926077090",
								en: "Organization number: 926077090"
							})}
						</li>
						<li>
							{tr({
								no: "Adresse: Juliuanus Holms veg 12, 7041 Trondheim",
								en: "Address: Juliuanus Holms veg 12, 7041 Trondheim"
							})}
						</li>
						<li>{tr({ no: "Telefon: 41299488", en: "Phone: 41299488" })}</li>
						<li>
							{tr({
								no: "E-post: hello@sol2ks.no",
								en: "Email: hello@sol2ks.no"
							})}
						</li>
					</ul>
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
