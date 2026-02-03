"use client";

import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState
} from "react";

export type Locale = "no" | "en";

type TrDict = { no: string; en: string };

type LocaleContextValue = {
	locale: Locale;
	setLocale: (l: Locale) => void;
	tr: (d: TrDict) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>("no");

	useEffect(() => {
		try {
			const saved = localStorage.getItem("locale");
			if (saved === "no" || saved === "en") {
				setLocaleState(saved);
				return;
			}

			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
			const lang = (navigator.language || "").toLowerCase();
			const isNorway =
				lang.startsWith("no") ||
				lang.startsWith("nb") ||
				lang.startsWith("nn") ||
				tz === "Europe/Oslo";

			if (!isNorway) {
				setLocaleState("en");
			}
		} catch {}
	}, []);

	useEffect(() => {
		try {
			document.documentElement.lang = locale;
			localStorage.setItem("locale", locale);
		} catch {}
	}, [locale]);

	const setLocale = useCallback((l: Locale) => setLocaleState(l), []);

	const tr = useCallback(
		(d: TrDict) => {
			return locale === "en" ? d.en : d.no;
		},
		[locale]
	);

	const value = useMemo(
		() => ({ locale, setLocale, tr }),
		[locale, setLocale, tr]
	);

	return (
		<LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
	);
}

export function useLocale() {
	const ctx = useContext(LocaleContext);
	if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
	return ctx;
}
