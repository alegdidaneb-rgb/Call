import React from "react";
import { useLeads } from "@/hooks/useLeads";
import { useCallLogs } from "@/hooks/useCallLogs";
import {
  Users,
  Phone,
  Clock,
  CheckCircle,
  XCircle,
  PhoneMissed,
  TrendingUp,
} from "lucide-react";

export function DashboardPage() {
  const { data: leads, isLoading: leadsLoading } = useLeads();
  const { data: callLogs, isLoading: logsLoading } = useCallLogs();

  const totalLeads = leads?.length ?? 0;
  const newLeads = leads?.filter((l) => l.status === "new").length ?? 0;
  const contactedLeads = leads?.filter((l) => l.status === "contacted").length ?? 0;
  const interestedLeads = leads?.filter((l) => l.status === "interested").length ?? 0;
  const convertedLeads = leads?.filter((l) => l.status === "converted").length ?? 0;
  const totalCalls = callLogs?.length ?? 0;
  const answeredCalls = (callLogs ?? []).filter((l) => l.outcome === "answered").length ?? 0;
  const avgDuration =
    totalCalls > 0 && callLogs
      ? Math.round(
          callLogs.reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0) /
            totalCalls
        )
      : 0;

  const stats = [
    {
      label: "Total Leads",
      value: totalLeads,
      icon: Users,
      color: "brand",
      bgClass: "bg-accent/12",
      iconClass: "text-accent",
    },
    {
      label: "New Today",
      value: newLeads,
      icon: TrendingUp,
      color: "emerald",
      bgClass: "bg-success/12",
      iconClass: "text-success",
    },
    {
      label: "Interested",
      value: interestedLeads,
      icon: CheckCircle,
      color: "amber",
      bgClass: "bg-warning/12",
      iconClass: "text-warning",
    },
    {
      label: "Total Calls",
      value: totalCalls,
      icon: Phone,
      color: "blue",
      bgClass: "bg-info/12",
      iconClass: "text-info",
    },
    {
      label: "Answered",
      value: answeredCalls,
      icon: Phone,
      color: "green",
      bgClass: "bg-success/12",
      iconClass: "text-success",
    },
    {
      label: "Avg Duration",
      value: `${avgDuration}s`,
      icon: Clock,
      color: "purple",
      bgClass: "bg-alt/12",
      iconClass: "text-alt",
    },
  ];

  if (leadsLoading || logsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-panel rounded-xl p-5 border border-line shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted">{stat.label}</p>
                  <p className="text-2xl font-bold text-ink mt-1">
                    {stat.value}
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${stat.bgClass}`}>
                  <Icon className={`w-6 h-6 ${stat.iconClass}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-panel rounded-xl p-5 border border-line shadow-sm">
          <h2 className="text-lg font-semibold text-ink mb-4">
            Lead Status Distribution
          </h2>
          <div className="space-y-3">
            {[
              { label: "New", count: newLeads, color: "bg-accent" },
              { label: "Contacted", count: contactedLeads, color: "bg-info" },
              { label: "Interested", count: interestedLeads, color: "bg-warning" },
              { label: "Not Interested", count: (leads ?? []).filter((l) => l.status === "not_interested").length, color: "bg-steel" },
              { label: "Converted", count: convertedLeads, color: "bg-success" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                <span className="flex-1 text-sm text-muted">{item.label}</span>
                <span className="text-sm font-semibold text-ink">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-panel rounded-xl p-5 border border-line shadow-sm">
          <h2 className="text-lg font-semibold text-ink mb-4">
            Recent Activity
          </h2>
          {callLogs?.length === 0 ? (
            <p className="text-sm text-muted">No call activity yet</p>
          ) : (
            <div className="space-y-3">
              {(callLogs ?? [])
                .sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() -
                    new Date(a.created_at).getTime()
                )
                .slice(0, 5)
                .map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-app"
                  >
                    <div className="w-8 h-8 rounded-full bg-accent/12 flex items-center justify-center">
                      <Phone className="w-4 h-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {log.outcome}
                      </p>
                      <p className="text-xs text-muted">
                        {log.duration_seconds}s
                      </p>
                    </div>
                    <span className="text-xs text-faint">
                      {new Date(log.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
