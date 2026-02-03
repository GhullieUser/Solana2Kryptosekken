"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLocale } from "@/app/components/locale-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { FiMoon, FiSun, FiUser, FiChevronDown, FiLogOut } from "react-icons/fi";

function useTheme() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const saved =
			typeof window !== "undefined" ? localStorage.getItem("theme") : null;
		const systemPrefersDark =
			typeof window !== "undefined" &&
			window.matchMedia &&
			window.matchMedia("(prefers-color-scheme: dark)").matches;

		const dark = saved ? saved === "dark" : systemPrefersDark;
		document.documentElement.classList.toggle("dark", dark);
		setIsDark(dark);
	}, []);

	const toggle = () => {
		setIsDark((prev) => {
			const next = !prev;
			document.documentElement.classList.toggle("dark", next);
			try {
				localStorage.setItem("theme", next ? "dark" : "light");
			} catch {}
			return next;
		});
	};

	return { isDark, toggle };
}

function ThemePill() {
	const { tr } = useLocale();
	const { isDark, toggle } = useTheme();
	return (
		<button
			type="button"
			onClick={toggle}
			className="inline-flex h-[28px] sm:h-[32px] w-[36px] sm:w-[40px] items-center justify-center rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
			title={tr({ no: "Bytt lys/mørk", en: "Toggle light/dark" })}
			aria-label={tr({ no: "Bytt lys/mørk", en: "Toggle light/dark" })}
		>
			{isDark ? <FiMoon className="h-4 w-4 sm:h-5 sm:w-5" /> : <FiSun className="h-4 w-4 sm:h-5 sm:w-5" />}
		</button>
	);
}

function LocalePill() {
	const { locale, setLocale, tr } = useLocale();
	const baseBtn =
		"inline-flex h-[22px] sm:h-[24px] w-[26px] sm:w-[28px] items-center justify-center rounded-full leading-none transition";
	const selected = "opacity-100 saturate-150";
	const unselected =
		"opacity-60 saturate-0 hover:opacity-100 hover:saturate-100";

	return (
		<div
			className="inline-flex h-[28px] sm:h-[32px] items-center gap-1 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-1.5 py-1 text-xs font-medium shadow-sm dark:shadow-black/25"
			aria-label={tr({ no: "Språk", en: "Language" })}
		>
			<button
				type="button"
				onClick={() => setLocale("no")}
				className={`${baseBtn} ${locale === "no" ? selected : unselected}`}
				aria-label={tr({ no: "Norsk", en: "Norwegian" })}
				title={tr({ no: "Norsk", en: "Norwegian" })}
			>
				<Image
					src="/flag-no.svg"
					alt={tr({ no: "Norsk", en: "Norwegian" })}
					width={20}
					height={15}
					className="block w-[18px] h-[13px] sm:w-[20px] sm:h-[15px]"
					priority
				/>
			</button>
			<button
				type="button"
				onClick={() => setLocale("en")}
				className={`${baseBtn} ${locale === "en" ? selected : unselected}`}
				aria-label={tr({ no: "English", en: "English" })}
				title={tr({ no: "English", en: "English" })}
			>
				<Image
					src="/flag-gb.svg"
					alt={tr({ no: "English", en: "English" })}
					width={20}
					height={15}
					className="block w-[18px] h-[13px] sm:w-[20px] sm:h-[15px]"
					priority
				/>
			</button>
		</div>
	);
}

export default function AppHeader() {
	const pathname = usePathname();
	const { tr } = useLocale();
	const supabase = useMemo(() => createSupabaseBrowserClient(), []);
	const [isAuthed, setIsAuthed] = useState(false);
	const [userEmail, setUserEmail] = useState<string | null>(null);
	const [userMenuOpen, setUserMenuOpen] = useState(false);
	const userMenuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let active = true;
		(async () => {
			const { data } = await supabase.auth.getUser();
			if (!active) return;
			setIsAuthed(!!data?.user);
			setUserEmail(data?.user?.email ?? null);
		})();
		return () => {
			active = false;
		};
	}, [supabase]);

	useEffect(() => {
		function onDocClick(e: MouseEvent) {
			if (!userMenuRef.current) return;
			if (!userMenuRef.current.contains(e.target as Node)) {
				setUserMenuOpen(false);
			}
		}
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, []);

	async function signOut() {
		await supabase.auth.signOut();
		window.location.href = "/";
	}

	return (
		<header className="fixed top-0 inset-x-0 z-40 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
			<div className="relative mx-auto max-w-6xl px-4 py-3 sm:py-4 flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 sm:gap-3 font-medium text-slate-800 dark:text-slate-200">
					<Image
						src="/Sol2KS_logo.svg"
						alt="Sol2KS"
						width={32}
						height={32}
						className="block w-6 h-6 sm:w-8 sm:h-8"
					/>
					<Link
						href="/"
						className="inline-flex items-center rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 sm:px-4 py-1 sm:py-1.5 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition text-xs sm:text-sm"
					>
						Solana → Kryptosekken
					</Link>
				</div>

				<nav className="hidden sm:flex absolute left-1/2 -translate-x-1/2 items-center justify-center gap-2 font-medium text-slate-700 dark:text-slate-200 text-sm">
					<Link
						href="/"
						className={`rounded-full px-4 py-1.5 transition ${
							pathname === "/"
								? "text-slate-900 dark:text-white"
								: "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
						}`}
					>
						{tr({ no: "Hjem", en: "Home" })}
					</Link>
					<Link
						href="/csvgenerator"
						className={`rounded-full px-4 py-1.5 transition ${
							pathname === "/csvgenerator"
								? "text-slate-900 dark:text-white"
								: "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
						}`}
					>
						{tr({ no: "CSV Generator", en: "CSV Generator" })}
					</Link>
				</nav>

				<div className="flex items-center gap-2">
					<LocalePill />
					<ThemePill />
					{isAuthed ? (
						<div className="relative" ref={userMenuRef}>
							<button
								type="button"
								onClick={() => setUserMenuOpen((v) => !v)}
							className="inline-flex h-[28px] sm:h-[32px] items-center justify-center gap-1 rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 sm:px-4 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
						>
							<FiUser className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
							<span className="max-w-[120px] truncate">
								{userEmail ?? tr({ no: "Bruker", en: "User" })}
							</span>
							<FiChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 opacity-70" />
							</button>
							{userMenuOpen && (
								<div className="absolute right-0 mt-2 min-w-full w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0e1729] shadow-xl shadow-slate-900/10 dark:shadow-black/35 overflow-hidden z-50">
									<Link
										href="/user"
										className="flex items-center gap-2 px-3 py-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
										onClick={() => setUserMenuOpen(false)}
									>
										<FiUser className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
										{tr({ no: "Vis profil", en: "View profile" })}
									</Link>
									<button
										type="button"
										onClick={signOut}
										className="flex w-full items-center gap-2 px-3 py-2 text-xs sm:text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
									>
										<FiLogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
										{tr({ no: "Logg ut", en: "Sign out" })}
									</button>
								</div>
							)}
						</div>
					) : (
						<Link
							href="/signin"
							className="inline-flex h-[28px] sm:h-[32px] items-center justify-center rounded-full bg-white/90 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 px-3 sm:px-4 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-black/25 hover:bg-white dark:hover:bg-white/10 transition"
						>
							{tr({ no: "Logg inn", en: "Sign in" })}
						</Link>
					)}
				</div>
			</div>
		</header>
	);
}
