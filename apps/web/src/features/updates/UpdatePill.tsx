import { Link } from "@tanstack/react-router";
import { ArrowUpCircle } from "lucide-react";

import { useUpdates } from "~/stores/updates";

/** A quiet notice in the status bar while a newer version is waiting. */
export function UpdatePill() {
  const status = useUpdates((state) => state.status);
  if (status.state !== "available" && status.state !== "ready") return null;
  return (
    <Link
      to="/settings"
      title={status.state === "ready" ? "Restart to install" : "Open Settings to update"}
      className="flex items-center gap-1 rounded px-1 text-primary transition-colors hover:bg-primary/10"
    >
      <ArrowUpCircle className="size-2.5" strokeWidth={2} aria-hidden />
      {status.state === "ready" ? `restart for ${status.version}` : `${status.version} available`}
    </Link>
  );
}
