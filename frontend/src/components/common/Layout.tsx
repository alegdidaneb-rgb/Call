import React, { Suspense, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Monitor,
  Moon,
  Phone,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { usePreferences } from "@/components/common/PreferencesProvider";
import { NAV_GROUPS, visibleNavItems } from "@/components/common/navigation";
import { signOut } from "@/lib/auth";
import { useSipBootstrap } from "@/hooks/useSip";
import type { SipConnectionStatus } from "@/sip/engine";
import { CallBar } from "@/components/softphone/CallBar";
import { IncomingCallModal } from "@/components/softphone/IncomingCallModal";

// Loaded on first use: the palette carries its own icon set and the lead query,
// and none of it is needed to paint the shell.
const CommandPalette = React.lazy(() =>
  import("@/components/common/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);

/** True when a keystroke should reach a form field rather than a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const SIP_STATUS: Record<SipConnectionStatus, { label: string; dot: string; text: string }> = {
  registered: { label: "Registered", dot: "bg-success", text: "text-success" },
  registering: { label: "Registering", dot: "bg-warning animate-pulse", text: "text-warning" },
  connecting: { label: "Connecting", dot: "bg-warning animate-pulse", text: "text-warning" },
  disconnected: { label: "Offline", dot: "bg-steel", text: "text-muted" },
  unconfigured: { label: "No trunk", dot: "bg-steel", text: "text-muted" },
  error: { label: "SIP error", dot: "bg-danger", text: "text-danger" },
};

function useModifierLabel(): string {
  return useMemo(() => {
    if (typeof navigator === "undefined") return "Ctrl";
    return /Mac|iPod|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
  }, []);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { user } = useAuth();
  // Register the softphone once, here at the shell, so an agent stays reachable
  // while moving between leads and an inbound call rings on any page.
  const sip = useSipBootstrap();
  const { theme, resolvedTheme, density, cycleTheme, toggleDensity } = usePreferences();
  const navigate = useNavigate();
  const modifier = useModifierLabel();

  const role = user?.role ?? "agent";
  const isAdmin = role === "admin";
  const navItems = visibleNavItems(role);
  const sipStatus = SIP_STATUS[sip.status];

  // Global shortcuts. The palette is the only way to search, so it is reachable
  // from anywhere without the mouse.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;
      if (modified && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "/" && !modified && !isTypingTarget(event.target)) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Never leave the mobile drawer covering the page an agent just navigated to.
  const { pathname } = useLocation();

  /**
   * Screens that manage their own height and scrolling.
   *
   * The calling workspace is a set of independently scrolling panes filling the
   * viewport. Giving it the shell's padding and page scroll produces a second
   * scrollbar and, worse, a percentage-height pane that cannot resolve against a
   * parent with no definite height.
   */
  const isFullBleed = pathname === "/workspace";
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const ThemeIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;
  const initials = (user?.fullName ?? user?.email ?? "U")
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex h-screen overflow-hidden bg-app">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-line bg-panel transition-transform duration-200 lg:static lg:inset-auto lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <NavLink to="/workspace" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-inverse">
              <Phone className="h-3.5 w-3.5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">Cold Dialer</span>
          </NavLink>
          <button
            className="rounded-md p-1 text-faint hover:bg-hover hover:text-ink lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
          {NAV_GROUPS.map((group) => {
            const items = navItems.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mt-4 first:mt-2">
                <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/dashboard"}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
                            isActive
                              ? "bg-accent/14 font-semibold text-accent"
                              : "font-medium text-muted hover:bg-hover hover:text-ink"
                          }`
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-2.5">
          <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/16 text-xs font-semibold text-accent">
              {initials || "U"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">
                {user?.fullName ?? user?.email ?? "User"}
              </p>
              <p className="truncate text-[11px] capitalize text-faint">{role}</p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-faint transition hover:bg-danger/12 hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 lg:px-6">
          <button
            className="rounded-lg p-2 text-muted transition hover:bg-hover hover:text-ink lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-inset px-3 text-left text-[13px] text-faint transition hover:border-line-strong hover:text-muted sm:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">Search leads or jump to a page…</span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] sm:block">
              {modifier} K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => isAdmin && navigate("/phone")}
              title={
                isAdmin
                  ? `Trunk: ${sip.accountLabel ?? "none"} — open Phone settings`
                  : `Trunk: ${sip.accountLabel ?? "none"}`
              }
              className={`flex h-9 items-center gap-2 rounded-lg border border-line bg-inset px-2.5 text-xs font-medium transition ${
                isAdmin ? "hover:border-line-strong hover:text-ink" : "cursor-default"
              } ${sipStatus.text}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${sipStatus.dot}`} />
              <span className="hidden sm:inline">{sipStatus.label}</span>
            </button>

            <button
              onClick={cycleTheme}
              title={`Theme: ${theme} — click to cycle`}
              aria-label={`Theme: ${theme}, click to cycle`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-ink"
            >
              <ThemeIcon className="h-4 w-4" />
            </button>

            <button
              onClick={toggleDensity}
              title={`Density: ${density} — click to toggle`}
              aria-label={`Density: ${density}, click to toggle`}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-ink sm:flex"
            >
              {density === "compact" ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        <main className={isFullBleed ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex-1 overflow-y-auto p-4 lg:p-6"}>
          {children}
        </main>
      </div>

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette role={role} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      <CallBar />
      <IncomingCallModal />
    </div>
  );
}
