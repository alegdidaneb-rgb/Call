import React from "react";

interface StatusBadgeProps {
  status: string;
}

const statusColors: Record<string, string> = {
  new: "bg-accent/12 text-accent",
  contacted: "bg-info/12 text-info",
  interested: "bg-warning/12 text-warning",
  not_interested: "bg-hover text-ink",
  callback: "bg-alt/12 text-alt",
  converted: "bg-success/12 text-success",
  do_not_contact: "bg-danger/12 text-danger",
  active: "bg-success/12 text-success",
  paused: "bg-warning/12 text-warning",
  scheduled: "bg-accent/12 text-accent",
  completed: "bg-success/12 text-success",
  cancelled: "bg-danger/12 text-danger",
  rescheduled: "bg-warning/12 text-warning",
  answered: "bg-success/12 text-success",
  no_answer: "bg-hover text-ink",
  busy: "bg-danger/12 text-danger",
  voicemail: "bg-warning/12 text-warning",
  dnc: "bg-danger/12 text-danger",
  wrong_number: "bg-hover text-ink",
  disconnected: "bg-hover text-ink",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = statusColors[status] ?? "bg-hover text-ink";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}