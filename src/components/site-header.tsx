import { Sparkles } from "lucide-react";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-7 sm:px-10">
      <Link href="/" aria-label="Curafind home" className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="size-5" aria-hidden="true" />
        </span>
        curafind<span className="-ml-2 text-primary">.</span>
      </Link>
      <nav aria-label="Main navigation" className="flex items-center gap-5 text-sm font-medium">
        <Link href="/" className="rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Home</Link>
        <Link href="/games" className="rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Games</Link>
      </nav>
    </header>
  );
}
