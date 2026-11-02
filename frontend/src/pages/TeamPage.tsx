import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { UserPlus, Users, Shield, AlertCircle, CheckCircle2 } from "lucide-react";
import { createUser, listTeamMembers, type NewUserInput } from "@/lib/auth";
import type { AppRole } from "@/types/app";

/**
 * Team management: the only place an account can be created.
 *
 * Route-guarded to `admin` in `App.tsx`, but that guard is cosmetic. The real
 * control is server-side: creating a user needs the service role key, which
 * lives in the `admin-users` edge function, and that function verifies the
 * caller's JWT and requires `profiles.role = 'admin'`. A non-admin who calls it
 * directly gets a 403.
 */

const newUserSchema = z
  .object({
    fullName: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    password: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .regex(/[a-zA-Z]/, "Password must contain a letter")
      .regex(/[0-9]/, "Password must contain a number"),
    role: z.enum(["admin", "manager", "agent"]),
  });

type FieldErrors = Partial<Record<"fullName" | "email" | "password" | "role", string>>;

const ROLE_OPTIONS: { value: AppRole; label: string; hint: string }[] = [
  { value: "agent", label: "Agent", hint: "Works their own leads and the unassigned pool" },
  { value: "manager", label: "Manager", hint: "Sees all leads, cannot manage accounts" },
  { value: "admin", label: "Admin", hint: "Full access, including creating accounts" },
];

const roleBadge: Record<AppRole, string> = {
  admin: "bg-purple-50 text-purple-700 border-purple-200",
  manager: "bg-blue-50 text-blue-700 border-blue-200",
  agent: "bg-gray-50 text-gray-700 border-gray-200",
};

export function TeamPage() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("agent");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; role: AppRole } | null>(null);

  const { data: members, isLoading, error } = useQuery({
    queryKey: ["team"],
    queryFn: listTeamMembers,
  });

  const createMutation = useMutation({
    mutationFn: (input: NewUserInput) => createUser(input),
    onSuccess: (user) => {
      setCreated({ email: user.email ?? email, role: user.role });
      setFormError(null);
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("agent");
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (err: unknown) => {
      setCreated(null);
      setFormError(err instanceof Error ? err.message : "Unable to create the account");
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setCreated(null);

    const parsed = newUserSchema.safeParse({ fullName, email, password, role });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setFieldErrors({});
    createMutation.mutate(parsed.data);
  }

  const inputClass = (invalid?: string) =>
    `w-full px-3 py-2.5 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition text-sm ${
      invalid ? "border-red-300 bg-red-50" : "border-gray-300"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="text-sm text-gray-500 mt-1">
          Accounts can only be created here, by an administrator. There is no public sign-up.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* --- Create account --------------------------------------------- */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-5 h-5 text-brand-600" />
              <h2 className="text-base font-semibold text-gray-900">Add a team member</h2>
            </div>

            {created && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong className="font-semibold">{created.email}</strong> was created as{" "}
                  {created.role}. They can sign in now with the password you set -- share it over a
                  secure channel and ask them to change it.
                </span>
              </div>
            )}

            {formError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="team-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Full name
                </label>
                <input
                  id="team-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="off"
                  className={inputClass(fieldErrors.fullName)}
                />
                {fieldErrors.fullName && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.fullName}</p>
                )}
              </div>

              <div>
                <label htmlFor="team-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="team-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  className={inputClass(fieldErrors.email)}
                />
                {fieldErrors.email && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="team-password"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Temporary password
                </label>
                <input
                  id="team-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className={inputClass(fieldErrors.password)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  At least 10 characters, including a letter and a number. Shown as text so you can
                  copy it into a password manager to hand over.
                </p>
                {fieldErrors.password && (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.password}</p>
                )}
              </div>

              <div>
                <span className="block text-sm font-medium text-gray-700 mb-1">Role</span>
                <div className="space-y-2">
                  {ROLE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                        role === option.value
                          ? "border-brand-500 bg-brand-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option.value}
                        checked={role === option.value}
                        onChange={() => setRole(option.value)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">
                          {option.label}
                        </span>
                        <span className="block text-xs text-gray-500">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {fieldErrors.role && <p className="text-xs text-red-600 mt-1">{fieldErrors.role}</p>}
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 transition flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Create account
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* --- Roster ------------------------------------------------------ */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-400" />
                <h2 className="text-base font-semibold text-gray-900">Accounts</h2>
              </div>
              <span className="text-sm text-gray-500">{members?.length ?? 0}</span>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
              </div>
            ) : error ? (
              <div className="px-5 py-10 text-sm text-red-600">
                Unable to load accounts. Only an administrator can view this list.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Email</th>
                      <th className="px-5 py-3">Role</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Added</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(members ?? []).map((member) => (
                      <tr key={member.id} className="hover:bg-gray-50/60">
                        <td className="px-5 py-3 font-medium text-gray-900">
                          {member.fullName || "—"}
                        </td>
                        <td className="px-5 py-3 text-gray-600">{member.email ?? "—"}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${roleBadge[member.role]}`}
                          >
                            {member.role === "admin" && <Shield className="w-3 h-3" />}
                            {member.role}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {member.provisioned ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <AlertCircle className="w-3.5 h-3.5" />
                              No access
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-500">
                          {member.createdAt
                            ? new Date(member.createdAt).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-3">
            An account marked <strong>No access</strong> authenticated without being created here --
            for example through the Supabase Auth API directly. It can sign in but RLS gives it no
            data. Recreate it from this page, or delete it in the Supabase dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
