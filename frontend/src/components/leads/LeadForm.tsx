import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  COUNTRIES,
  countryFromPhone,
  diallingCodeFor,
  flagEmoji,
  type Country,
} from "@/data/countries";

/**
 * Leads are international.
 *
 * This form used to offer exactly one dialling option, a hardcoded "+1 (US)",
 * and stored no country at all -- so every lead was implicitly American and a
 * non-US number could only be entered by fighting the prefix. The country is now
 * a real field holding an ISO 3166-1 alpha-2 code, and the dialling prefix is
 * derived from it rather than chosen separately, so the two cannot disagree.
 */

/** Shown when nothing better is known, matching the form's previous default. */
const DEFAULT_COUNTRY = "US";

interface LeadFormData {
  first_name: string;
  last_name: string;
  company: string;
  /** ISO 3166-1 alpha-2 code. Drives the dialling prefix. */
  country: string;
  /** Local part only while editing; combined with the prefix on submit. */
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  source: string;
  status: string;
  campaign_id: string;
}

interface LeadFormProps {
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  initialData?: Partial<LeadFormData> & { country?: string | null };
}

/**
 * Strips a stored international prefix so the input shows the local part.
 *
 * Only strips a prefix that actually matches the selected country, so a number
 * saved under a different country is left intact instead of being mangled.
 */
function localPart(stored: string | undefined, countryCode: string): string {
  if (!stored) return "";
  const value = stored.trim();
  const dial = diallingCodeFor(countryCode);
  if (dial && value.startsWith(dial)) {
    return value.slice(dial.length).replace(/^[\s().-]+/, "");
  }
  return value;
}

/**
 * Resolves the country for an existing lead.
 *
 * Prefers the stored code, then an unambiguous guess from the phone number (for
 * leads saved before `country` existed), then the previous default. A guess is
 * only used when the prefix identifies exactly one country: "+44" resolves to
 * the UK, but "+1" and "+7" do not resolve at all rather than silently picking
 * the United States or Russia.
 */
function initialCountry(initialData?: LeadFormProps["initialData"]): string {
  const stored = initialData?.country;
  if (stored && /^[A-Za-z]{2}$/.test(stored)) return stored.toUpperCase();
  return countryFromPhone(initialData?.phone)?.code ?? DEFAULT_COUNTRY;
}

export function LeadForm({ onClose, onSubmit, initialData }: LeadFormProps) {
  const country = initialCountry(initialData);

  const [formData, setFormData] = useState<LeadFormData>({
    first_name: initialData?.first_name ?? "",
    last_name: initialData?.last_name ?? "",
    company: initialData?.company ?? "",
    country,
    phone: localPart(initialData?.phone, country),
    email: initialData?.email ?? "",
    website: initialData?.website ?? "",
    address: initialData?.address ?? "",
    city: initialData?.city ?? "",
    state: initialData?.state ?? "",
    zip: initialData?.zip ?? "",
    source: initialData?.source ?? "",
    status: initialData?.status ?? "new",
    campaign_id: initialData?.campaign_id ?? "",
  });

  /** Grouped once; 250 flat options are hard to scan, regions are not. */
  const grouped = useMemo(() => {
    const byRegion = new Map<string, Country[]>();
    for (const entry of COUNTRIES) {
      const list = byRegion.get(entry.region) ?? [];
      list.push(entry);
      byRegion.set(entry.region, list);
    }
    return [...byRegion.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const dial = diallingCodeFor(formData.country);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedPhone = formData.phone.trim();
    await onSubmit({
      first_name: formData.first_name,
      last_name: formData.last_name,
      company: formData.company,
      country: formData.country || null,
      // Stored in international format, as before. The local part is kept as
      // typed so extensions and internal formatting are not destroyed.
      phone: trimmedPhone ? `${dial}${trimmedPhone}` : null,
      email: formData.email,
      website: formData.website,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      zip: formData.zip,
      source: formData.source,
      status: formData.status,
      campaign_id: formData.campaign_id || null,
    });
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {initialData?.first_name ? "Edit Lead" : "New Lead"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, first_name: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, last_name: e.target.value }))
                }
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="lead-country" className="block text-sm font-medium text-gray-700 mb-1">
              Country
            </label>
            <select
              id="lead-country"
              value={formData.country}
              onChange={(e) => setFormData((prev) => ({ ...prev, country: e.target.value }))}
              className={`${inputClass} bg-white`}
            >
              {grouped.map(([region, list]) => (
                <optgroup key={region} label={region}>
                  {list.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {flagEmoji(entry.code)} {entry.name}
                      {entry.dial ? `  ${entry.dial}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {COUNTRIES.length} countries. Sets the dialling code below and is stored as an ISO
              3166-1 code.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <div className="flex">
                {/* Derived from the country, not independently editable: two
                    controls for one fact would eventually disagree. */}
                <span
                  className="inline-flex items-center px-2.5 py-2 border border-r-0 border-gray-300 rounded-l-lg text-sm bg-gray-50 text-gray-600 min-w-[3.5rem] justify-center"
                  title={`Dialling code for ${formData.country}`}
                >
                  {dial || "—"}
                </span>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder={dial === "+1" ? "(862) 366-7732" : "local number"}
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-r-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData((prev) => ({ ...prev, website: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              {/* Not every country has states, and not every state is called one. */}
              <label className="block text-sm font-medium text-gray-700 mb-1">State / Region</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData((prev) => ({ ...prev, state: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Postal code</label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData((prev) => ({ ...prev, zip: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
              <input
                type="text"
                value={formData.source}
                onChange={(e) => setFormData((prev) => ({ ...prev, source: e.target.value }))}
                className={inputClass}
                placeholder="e.g. website, referral"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                className={`${inputClass} bg-white`}
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="interested">Interested</option>
                <option value="not_interested">Not Interested</option>
                <option value="callback">Callback</option>
                <option value="converted">Converted</option>
                <option value="do_not_contact">Do Not Contact</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition"
            >
              Save Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
