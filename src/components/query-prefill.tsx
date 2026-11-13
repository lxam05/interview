"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Fills the search blank from ?q= after load, but only while it is still
 * empty, so it never wipes what someone has started typing.
 */
export function QueryPrefill({ inputId }: { inputId: string }) {
  const q = useSearchParams().get("q") ?? "";
  useEffect(() => {
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (el && !el.value && q) el.value = q.slice(0, 80);
  }, [inputId, q]);
  return null;
}
