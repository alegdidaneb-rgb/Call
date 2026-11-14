import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

/**
 * Lead-shaped logic shared by the queue, the grid and the export.
 *
 * Three screens needed the same four things — a display name, a search match, a
 * sort order and a CSV row — and the first two were already duplicated between
 * the queue and the lead list with subtly different behaviour. A lead whose
 * company matched in one place and not the other is the kind of inconsistency
 * nobody reports and everybody notices.
 */

/** A lead always has something to be called, even with no contact name. */
export function leadName(lead: Lead): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.company || "Unnamed lead";
}

export function leadInitials(lead: Lead): string {
  const first = (lead.first_name ?? "").trim().charAt(0);
  const last = (lead.last_name ?? "").trim().charAt(0);
  const fromCompany = (lead.company ?? "").trim().charAt(0);
  return (first + last || fromCompany || "?").toUpperCase();
}

/**
 * Search across everything an operator might remember about a lead.
 *
 * Every term must appear somewhere, so "acme london" narrows the list instead of
 * widening it — the behaviour people expect from a search box and the one that
 * `some()` would silently get wrong.
 */
export function matchesLead(lead: Lead, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  // Digits are matched against the phone number with punctuation stripped, so
  // searching "3406729" finds "+39 340 672 9832".
  const digits = (lead.phone ?? "").replace(/\D/g, "");

  const haystack = [
    lead.first_name,
    lead.last_name,
    lead.company,
    lead.phone,
    lead.email,
    lead.city,
    lead.state,
    lead.country,
    lead.source,
    ...(lead.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term) || (digits.length > 0 && /\d/.test(term) && digits.includes(term.replace(/\D/g, ""))));
}

export type SortKey =
  | "name"
  | "company"
  | "phone"
  | "country"
  | "status"
  | "calls"
  | "lastCalled"
  | "created";

export type SortDirection = "asc" | "desc";

function time(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compare(a: Lead, b: Lead, key: SortKey): number {
  switch (key) {
    case "name":
      return leadName(a).localeCompare(leadName(b));
    case "company":
      return (a.company ?? "").localeCompare(b.company ?? "");
    case "phone":
      return (a.phone ?? "").localeCompare(b.phone ?? "");
    case "country":
      return (a.country ?? "").localeCompare(b.country ?? "");
    case "status":
      return (a.status ?? "").localeCompare(b.status ?? "");
    case "calls":
      return (a.call_count ?? 0) - (b.call_count ?? 0);
    case "lastCalled":
      return time(a.last_called_at) - time(b.last_called_at);
    case "created":
      return time(a.created_at) - time(b.created_at);
    default:
      return 0;
  }
}

/**
 * Sort without mutating, and with a stable tiebreak.
 *
 * The tiebreak matters: two leads with the same company name would otherwise
 * swap places between renders whenever the source array order changed, which
 * looks like the grid is flickering.
 */
export function sortLeads(leads: Lead[], key: SortKey, direction: SortDirection): Lead[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    const primary = compare(a, b, key) * factor;
    if (primary !== 0) return primary;
    return a.id.localeCompare(b.id);
  });
}

/* ------------------------------------------------------------------- export */

const EXPORT_COLUMNS: Array<{ header: string; value: (lead: Lead) => string | number | null }> = [
  { header: "First name", value: (lead) => lead.first_name },
  { header: "Last name", value: (lead) => lead.last_name },
  { header: "Company", value: (lead) => lead.company },
  { header: "Phone", value: (lead) => lead.phone },
  { header: "Email", value: (lead) => lead.email },
  { header: "Country", value: (lead) => lead.country },
  { header: "City", value: (lead) => lead.city },
  { header: "State", value: (lead) => lead.state },
  { header: "Postcode", value: (lead) => lead.zip },
  { header: "Status", value: (lead) => lead.status },
  { header: "Source", value: (lead) => lead.source },
  { header: "Calls", value: (lead) => lead.call_count ?? 0 },
  { header: "Last called", value: (lead) => lead.last_called_at },
  { header: "Do not contact", value: (lead) => (lead.dnc ? "yes" : "no") },
  { header: "Created", value: (lead) => lead.created_at },
  { header: "Notes", value: (lead) => lead.notes },
];

/**
 * RFC 4180 quoting.
 *
 * Notes are free text and routinely contain commas, quotes and newlines. Without
 * this the export opens in Excel with the columns shifted and nobody notices
 * until they have worked from it.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadsToCsv(leads: Lead[]): string {
  const header = EXPORT_COLUMNS.map((column) => csvCell(column.header)).join(",");
  const rows = leads.map((lead) =>
    EXPORT_COLUMNS.map((column) => csvCell(column.value(lead))).join(","),
  );
  // A leading byte-order mark, or Excel opens UTF-8 names as mojibake.
  return `\uFEFF${[header, ...rows].join("\r\n")}`;
}

/** Trigger a download without a server round trip. */
export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking in the same tick cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
