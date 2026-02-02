"use client";

import { useEffect } from "react";

export default function AccountPage() {
	useEffect(() => {
		window.location.replace("/user");
	}, []);

	return null;
}
