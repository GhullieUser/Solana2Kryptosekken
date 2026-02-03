"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/locale-provider";

export default function PersonvernPage() {
	const { tr } = useLocale();
	return (
		<main className="min-h-screen bg-slate-50 dark:bg-[#0b1220] px-4 py-12 flex items-center">
			<div className="mx-auto w-full max-w-3xl flex flex-col">
				<h1 className="text-3xl md:text-4xl font-semibold text-slate-900 dark:text-white mb-6">
					{tr({ no: "Personvern", en: "Privacy" })}
				</h1>
				<p className="text-slate-600 dark:text-slate-300 mb-8">
					{tr({
						no: "Denne siden beskriver hvordan Solana2Kryptosekken behandler personopplysninger.",
						en: "This page explains how Solana2Kryptosekken processes personal data."
					})}
				</p>

				<section className="space-y-4 text-slate-700 dark:text-slate-200">
					<h2 className="text-xl font-semibold">
						{tr({ no: "Behandlingsansvarlig", en: "Data controller" })}
					</h2>
					<p>
						{tr({
							no: "Solana2Kryptosekken er behandlingsansvarlig for personopplysninger som samles inn via tjenesten.",
							en: "Solana2Kryptosekken is the data controller for personal data collected through the service."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "Hvilke data vi samler inn", en: "What data we collect" })}
					</h2>
					<ul className="list-disc pl-6 space-y-1">
						<li>
							{tr({
								no: "Kontoinformasjon (e-postadresse og eventuelle profilopplysninger).",
								en: "Account information (email address and any profile details)."
							})}
						</li>
						<li>
							{tr({
								no: "Bruksdata knyttet til generering av rapporter og eksport.",
								en: "Usage data related to report generation and exports."
							})}
						</li>
						<li>
							{tr({
								no: "Teknisk informasjon som IP-adresse, nettlesertype og enhetsinformasjon.",
								en: "Technical information such as IP address, browser type, and device information."
							})}
						</li>
					</ul>

					<h2 className="text-xl font-semibold">
						{tr({ no: "Formål", en: "Purpose" })}
					</h2>
					<ul className="list-disc pl-6 space-y-1">
						<li>{tr({ no: "Levere og forbedre tjenesten.", en: "Deliver and improve the service." })}</li>
						<li>{tr({ no: "Feilsøking og sikkerhet.", en: "Troubleshooting and security." })}</li>
						<li>
							{tr({
								no: "Kommunikasjon om konto og tjenesteendringer.",
								en: "Communication about your account and service changes."
							})}
						</li>
					</ul>

					<h2 className="text-xl font-semibold">
						{tr({ no: "Behandlingsgrunnlag", en: "Legal basis" })}
					</h2>
					<p>
						{tr({
							no: "Vi behandler personopplysninger basert på avtale, rettslige forpliktelser og berettiget interesse.",
							en: "We process personal data based on contract, legal obligations, and legitimate interests."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "Lagring og sikkerhet", en: "Storage and security" })}
					</h2>
					<p>
						{tr({
							no: "Data lagres så lenge det er nødvendig for formålet og i samsvar med gjeldende lovgivning.",
							en: "Data is stored as long as necessary for the purpose and in accordance with applicable laws."
						})}
					</p>

					<h2 className="text-xl font-semibold">
						{tr({ no: "Dine rettigheter", en: "Your rights" })}
					</h2>
					<p>
						{tr({
							no: "Du har rett til innsyn, retting og sletting. Du kan slette dataene dine på profilsiden.",
							en: "You have the right of access, rectification, and deletion. You can delete your data from the profile page."
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
