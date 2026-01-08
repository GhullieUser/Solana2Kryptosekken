"use client";

import React from "react";
import { LocaleProvider } from "./locale-provider";

export default function AppProviders({
	children
}: {
	children: React.ReactNode;
}) {
	return <LocaleProvider>{children}</LocaleProvider>;
}
