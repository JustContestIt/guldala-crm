import type { Status } from "@/lib/calc";
import { STATUS_LABEL } from "@/lib/status";

const STATUS_CLS: Record<Status, string> = {
  new: "bg-warn-bg text-warn",
  confirmed: "bg-mint text-accent-dark",
  prepaid: "bg-accent text-white",
  ready: "bg-accent-dark text-white",
  issued: "bg-surface text-muted",
  expired: "bg-up-bg text-up",
  cancelled: "bg-surface text-muted line-through",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
