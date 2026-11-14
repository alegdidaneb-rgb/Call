import React from "react";
import { useLeads } from "@/hooks/useLeads";
import { useCallLogs } from "@/hooks/useCallLogs";
import { BarChart3, Users, Phone, TrendingUp, Clock } from "lucide-react";

export function AdminPage() {
  const { data: leads } = useLeads();
  const { data: callLogs } = useCallLogs();

  const totalLeads = leads?.length ?? 0;
  const newLeads = leads?.filter((l) => l.status === "new").length ?? 0;
  const totalCalls = callLogs?.length ?? 0;
  const answeredCalls = (callLogs ?? []).filter((l) => l.outcome === "answered").length ?? 0;
  const avgDuration =
    totalCalls > 0
      ? Math.round(
          (callLogs ?? []).reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0) / totalCalls
        )
      : 0;
  const conversionRate =
    totalLeads > 0
      ? Math.round(((leads?.filter((l) => l.status === "converted").length ?? 0) / totalLeads) * 100)
      : 0;

  const statusBreakdown = [
    { label: "New", count: newLeads, color: "bg-info" },
    { label: "Contacted", count: leads?.filter((l) => l.status === "contacted").length ?? 0, color: "bg-info" },
    { label: "Interested", count: leads?.filter((l) => l.status === "interested").length ?? 0, color: "bg-warning" },
    { label: "Converted", count: leads?.filter((l) => l.status === "converted").length ?? 0, color: "bg-success" },
    { label: "DNC", count: leads?.filter((l) => l.status === "do_not_contact").length ?? 0, color: "bg-danger" },
  ];

  const outcomeBreakdown = [
    { label: "Answered", count: answeredCalls, color: "bg-success" },
    { label: "No Answer", count: (callLogs ?? []).filter((l) => l.outcome === "no_answer").length ?? 0, color: "bg-steel" },
    { label: "Busy", count: (callLogs ?? []).filter((l) => l.outcome === "busy").length ?? 0, color: "bg-danger" },
    { label: "Voicemail", count: (callLogs ?? []).filter((l) => l.outcome === "voicemail").length ?? 0, color: "bg-warning" },
  ];

  const maxOutcome = Math.max(...outcomeBreakdown.map((o) => o.count), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Administration</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: totalLeads, icon: Users, bgClass: "bg-info/12", iconClass: "text-info" },
          { label: "New Leads", value: newLeads, icon: TrendingUp, bgClass: "bg-success/12", iconClass: "text-success" },
          { label: "Total Calls", value: totalCalls, icon: Phone, bgClass: "bg-alt/12", iconClass: "text-alt" },
          { label: "Avg Duration", value: `${avgDuration}s`, icon: Clock, bgClass: "bg-warning/12", iconClass: "text-warning" },
          { label: "Conversion Rate", value: `${conversionRate}%`, icon: BarChart3, bgClass: "bg-success/12", iconClass: "text-success" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-panel rounded-xl p-5 border border-line shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted">{stat.label}</p>
                  <p className="text-2xl font-bold text-ink mt-1">{stat.value}</p>
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
          <h2 className="text-lg font-semibold text-ink mb-4">Call Outcomes</h2>
          <div className="space-y-3">
            {outcomeBreakdown.map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="w-20 text-xs text-muted">{item.label}</span>
                <div className="flex-1 bg-hover rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color} transition-all`}
                    style={{ width: `${(item.count / maxOutcome) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-ink w-8 text-right">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-panel rounded-xl p-5 border border-line shadow-sm">
          <h2 className="text-lg font-semibold text-ink mb-4">Lead Status Breakdown</h2>
          <div className="space-y-3">
            {statusBreakdown.map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                <span className="flex-1 text-sm text-muted">{item.label}</span>
                <span className="text-sm font-semibold text-ink">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
