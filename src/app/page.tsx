"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ResearchRequest } from "@/components/research-request";

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col bg-[#faf9f6]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
        <Link href="/" aria-label="Curafind home" className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-5" aria-hidden="true" /></span>
          curafind<span className="-ml-2 text-primary">.</span>
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-12 has-[[data-results-reader]]:max-w-4xl sm:px-8 sm:py-16">
        <div className="mb-9 text-center">
          <h1 className="font-heading text-4xl leading-[1.12] font-medium tracking-[-0.045em] sm:text-[54px]">Explore research.</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">Find clinical trials and drug research related to your condition.</p>
        </div>
        <ResearchRequest />
      </main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground sm:px-10">
        <span>Made to help those in need.</span>
        <span className="flex items-center gap-1.5"><Sparkles className="size-3" aria-hidden="true" />A little research goes a long way.</span>
      </footer>
    </div>
  );
}
