"use client";

import { useEffect } from "react";

export default function AuthPage() {
	useEffect(() => {
		window.location.replace("/signin");
	}, []);

	return null;
}
