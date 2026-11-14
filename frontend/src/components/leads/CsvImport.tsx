import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { bindShortcuts, keyName, pushOverlay } from "@/lib/keys";

/**
 * CSV import.
 *
 * The mapping step used to present thirteen dropdowns, every one of them empty,
 * and ask the operator to fill them in. In practice the columns in an exported
 * lead list are already called `first_name` and `phone`, so almost every import
 * began with a minute of matching names that are identical. Headers are now
 * matched automatically — exactly first, then by alias — and the operator only
 * intervenes for the ones that did not match.
 *
 * Two defects went with that. The chosen file was stored in state and never
 * displayed, so after picking a file the dialog gave no confirmation of what it
 * had taken; and "Change file" cleared the parsed rows without clearing the
 * input, so choosing the same file again fired no change event and the dialog
 * sat there looking broken.
 */

interface CsvRow {
  first_name?: string;
  last_name?: string;
  company?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** ISO 3166-1 alpha-2 code, e.g. "GB". Lowercase and full names are accepted. */
  country?: string;
  source?: string;
  status?: string;
  [key: string]: string | undefined;
}

interface CsvImportProps {
  onClose: () => void;
  /** Rows to import, and the campaign to attribute them to. */
  onImport: (rows: CsvRow[], campaignId: string | null) => Promise<void>;
  /** Offered so an import can be attributed to a campaign instead of landing unassigned. */
  campaigns?: { id: string; name: string }[];
  defaultCampaignId?: string | null;
}

/** The database columns a row can be written to, in the order they are asked for. */
const COLUMNS = [
  "first_name",
  "last_name",
  "company",
  "phone",
  "email",
  "website",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "source",
  "status",
] as const;

type Column = (typeof COLUMNS)[number];

const COLUMN_LABELS: Record<Column, string> = {
  first_name: "First name",
  last_name: "Last name",
  company: "Company",
  phone: "Phone",
  email: "Email",
  website: "Website",
  address: "Address",
  city: "City",
  state: "State or region",
  zip: "Postcode",
  country: "Country",
  source: "Source",
  status: "Status",
};

/** What a column is called in files that did not come out of this app. */
const ALIASES: Record<Column, string[]> = {
  first_name: ["firstname", "fname", "givenname", "forename", "first"],
  last_name: ["lastname", "lname", "surname", "familyname", "last"],
  company: ["company", "companyname", "organisation", "organization", "business", "employer", "account"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "cell", "msisdn", "directdial", "number"],
  email: ["email", "emailaddress", "mail", "e-mail"],
  website: ["website", "web", "url", "site", "homepage", "domain"],
  address: ["address", "street", "streetaddress", "address1", "addr", "line1"],
  city: ["city", "town", "locality", "suburb", "municipality"],
  state: ["state", "province", "region", "county", "stateorprovince"],
  zip: ["zip", "zipcode", "postal", "postalcode", "postcode", "zippostalcode", "pincode"],
  country: ["country", "countrycode", "countryname", "nation", "isocountry"],
  source: ["source", "leadsource", "origin", "channel", "list"],
  status: ["status", "leadstatus", "disposition"],
};

/** Headers that hold a first and last name in one cell. */
const FULL_NAME_HEADERS = ["name", "fullname", "contactname", "customername", "prospectname"];

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match headers to columns without asking.
 *
 * Exact matches are taken first so a file with both `name` and `first_name`
 * cannot steal the exact column with a looser one. A header is never used twice.
 */
function autoMap(headers: string[]): {
  mapping: Partial<Record<Column, string>>;
  fullNameHeader: string | null;
} {
  const mapping: Partial<Record<Column, string>> = {};
  const used = new Set<string>();

  for (const column of COLUMNS) {
    const exact = headers.find((header) => !used.has(header) && normalise(header) === column);
    if (exact) {
      mapping[column] = exact;
      used.add(exact);
    }
  }

  for (const column of COLUMNS) {
    if (mapping[column]) continue;
    const aliased = headers.find(
      (header) => !used.has(header) && ALIASES[column].includes(normalise(header)),
    );
    if (aliased) {
      mapping[column] = aliased;
      used.add(aliased);
    }
  }

  const needsNameSplit = !mapping.first_name && !mapping.last_name;
  const fullNameHeader = needsNameSplit
    ? (headers.find((header) => !used.has(header) && FULL_NAME_HEADERS.includes(normalise(header))) ??
      null)
    : null;
  if (fullNameHeader) used.add(fullNameHeader);

  return { mapping, fullNameHeader };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CsvImport({
  onClose,
  onImport,
  campaigns = [],
  defaultCampaignId = null,
}: CsvImportProps) {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Column, string>>>({});
  const [fullNameHeader, setFullNameHeader] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(defaultCampaignId);

  useEffect(() => pushOverlay(), []);
  useEffect(
    () =>
      bindShortcuts(
        (event) => {
          if (keyName(event) === "Escape") {
            event.preventDefault();
            onClose();
          }
        },
        { allowInOverlay: true },
      ),
    [onClose],
  );

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setError("");
    setParsedData([]);
    setHeaders([]);
    setMapping({});
    setFullNameHeader(null);

    Papa.parse<CsvRow>(chosen, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const found = results.meta.fields ?? [];
        setHeaders(found);
        setParsedData(results.data as CsvRow[]);
        const auto = autoMap(found);
        setMapping(auto.mapping);
        setFullNameHeader(auto.fullNameHeader);
        if (found.length === 0) {
          setError("That file has no header row, so there is nothing to match columns against.");
        }
      },
      error(err: Error) {
        setError(`Could not read that file: ${err.message}`);
      },
    });
  }, []);

  function resetFile() {
    // Clearing the input matters: without it, choosing the same file again fires
    // no change event and the dialog appears to ignore the click.
    if (inputRef.current) inputRef.current.value = "";
    setFile(null);
    setParsedData([]);
    setHeaders([]);
    setMapping({});
    setFullNameHeader(null);
    setError("");
  }

  /** Apply the mapping to one parsed row. */
  const projectRow = useCallback(
    (row: CsvRow): CsvRow => {
      const projected: CsvRow = {};
      for (const column of COLUMNS) {
        const sourceKey = mapping[column];
        if (sourceKey && row[sourceKey] !== undefined) {
          projected[column] = row[sourceKey];
        }
      }
      if (fullNameHeader) {
        const whole = (row[fullNameHeader] ?? "").trim();
        if (whole) {
          const splitAt = whole.indexOf(" ");
          projected.first_name =
            splitAt === -1 ? whole : whole.slice(0, splitAt).trim() || undefined;
          projected.last_name = splitAt === -1 ? undefined : whole.slice(splitAt + 1).trim() || undefined;
        }
      }
      return projected;
    },
    [mapping, fullNameHeader],
  );

  async function handleImport() {
    if (parsedData.length === 0) return;
    setLoading(true);
    try {
      await onImport(parsedData.map(projectRow), campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import failed.");
      setLoading(false);
    }
  }

  const matchedCount = COLUMNS.filter((column) => mapping[column]).length + (fullNameHeader ? 1 : 0);
  const unmatchedHeaders = headers.filter((header) => {
    if (header === fullNameHeader) return false;
    return !COLUMNS.some((column) => mapping[column] === header);
  });
  const rowsWithoutPhone = mapping.phone
    ? parsedData.filter((row) => !(row[mapping.phone as string] ?? "").trim()).length
    : parsedData.length;
  const preview = parsedData.slice(0, 3).map(projectRow);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-line-strong bg-panel shadow-floating animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              Import leads from a CSV
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {file
                ? `${file.name} · ${formatBytes(file.size)} · ${parsedData.length} row${parsedData.length === 1 ? "" : "s"} parsed`
                : "Columns are matched for you; correct anything that was not."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm -mr-1.5 -mt-1 !px-1.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {parsedData.length === 0 ? (
            <div>
              <label
                htmlFor={inputId}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-inset px-6 py-10 text-center transition-colors hover:border-accent hover:bg-accent/12"
              >
                <span className="rounded-lg bg-accent/12 p-2.5 text-accent">
                  <Upload className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-ink">Choose a CSV file</span>
                <span className="text-xs text-muted">Or drop it here</span>
                <span className="text-2xs text-faint">
                  Comma, semicolon and tab separated · quoted fields and multi-line cells are handled
                </span>
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileChange}
                className="sr-only"
              />
              {error ? (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/12 p-3 text-sm text-danger" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {!mapping.phone ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/12 p-3 text-xs text-warning" role="status">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    No column is mapped to <strong className="font-semibold">Phone</strong>. A lead
                    without a phone number cannot be dialled, so these rows will import but stay out
                    of the calling queue.
                  </span>
                </p>
              ) : rowsWithoutPhone > 0 ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/12 p-3 text-xs text-warning" role="status">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {rowsWithoutPhone} of {parsedData.length} rows have an empty{" "}
                    <strong className="font-semibold">{mapping.phone}</strong> column. They will
                    import but cannot be dialled.
                  </span>
                </p>
              ) : null}

              {fullNameHeader ? (
                <p className="rounded-lg border border-line bg-inset p-3 text-xs text-muted">
                  <strong className="font-semibold text-ink">{fullNameHeader}</strong> will be split
                  at the first space into first and last name.
                </p>
              ) : null}

              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="pane-title">Column mapping</h3>
                  <span className="text-2xs text-faint">
                    {matchedCount} matched automatically of {COLUMNS.length + (fullNameHeader ? 1 : 0)}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {COLUMNS.map((column) => (
                    <div key={column} className="flex items-center gap-2">
                      <label className="w-28 shrink-0 truncate text-xs text-muted" title={COLUMN_LABELS[column]}>
                        {COLUMN_LABELS[column]}
                      </label>
                      <select
                        value={mapping[column] ?? ""}
                        onChange={(event) =>
                          setMapping((previous) => ({
                            ...previous,
                            [column]: event.target.value || undefined,
                          }))
                        }
                        aria-label={`Column for ${COLUMN_LABELS[column]}`}
                        className="input !py-1.5 !text-xs"
                      >
                        <option value="">Not imported</option>
                        {headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {campaigns.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="label !mb-0" htmlFor={`${titleId}-campaign`}>
                    Add to campaign
                  </label>
                  <select
                    id={`${titleId}-campaign`}
                    value={campaignId ?? ""}
                    onChange={(event) => setCampaignId(event.target.value || null)}
                    className="input !w-auto !py-1.5 !text-xs"
                  >
                    <option value="">No campaign</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-2xs text-faint">
                    Campaigns are how results are compared later
                  </span>
                </div>
              ) : null}

              {unmatchedHeaders.length > 0 ? (
                <p className="text-xs text-faint">
                  Not used: {unmatchedHeaders.slice(0, 8).join(", ")}
                  {unmatchedHeaders.length > 8 ? ` and ${unmatchedHeaders.length - 8} more` : ""}
                </p>
              ) : null}

              <div>
                <h3 className="pane-title mb-2">First three rows as they will be saved</h3>
                <div className="overflow-hidden rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="bg-inset">
                      <tr>
                        {["Name", "Phone", "Email", "City", "Country"].map((heading) => (
                          <th key={heading} className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-faint">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {preview.map((row, index) => (
                        <tr key={index}>
                          <td className="max-w-[10rem] truncate px-3 py-1.5 text-ink">
                            {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="tabular max-w-[9rem] truncate px-3 py-1.5 text-muted">
                            {row.phone || "—"}
                          </td>
                          <td className="max-w-[10rem] truncate px-3 py-1.5 text-muted">
                            {row.email || "—"}
                          </td>
                          <td className="max-w-[7rem] truncate px-3 py-1.5 text-muted">{row.city || "—"}</td>
                          <td className="max-w-[6rem] truncate px-3 py-1.5 text-muted">
                            {row.country || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {error ? (
                  <p className="mt-3 rounded-lg border border-danger/30 bg-danger/12 p-3 text-xs text-danger" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>

        {parsedData.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
            <button type="button" onClick={resetFile} className="btn btn-ghost btn-sm">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Choose another file
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={loading}>
                Cancel
              </button>
              <button type="button" onClick={handleImport} disabled={loading} className="btn btn-primary btn-sm">
                {loading ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-inverse border-t-transparent" aria-hidden="true" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    Import {parsedData.length} row{parsedData.length === 1 ? "" : "s"}
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
