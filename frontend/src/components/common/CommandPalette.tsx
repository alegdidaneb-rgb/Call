import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CornerDownLeft,
  Minimize2,
  Monitor,
  Moon,
  Phone,
  Search,
  Sun,
  Users,
} from "lucide-react";
import { useLeads } from "@/hooks/useLeads";
import { usePreferences } from "@/components/common/PreferencesProvider";
import { visibleNavItems } from "@/components/common/navigation";
import type { AppRole } from "@/types/app";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  selected?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/** Substring match with a cheap relevance order: prefix, then anywhere. */
function relevance(query: string, label: string, keywords: string[]): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.startsWith(needle)) return 0;
  if (lowerLabel.includes(needle)) return 1;
  if (keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return 2;
  return null;
}

function leadName(lead: {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
}): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.company || lead.phone || "Unnamed lead";
}

interface CommandPaletteProps {
  role: AppRole;
  onClose: () => void;
}

/**
 * The single entry point for moving around the app.
 *
 * Replaces a search input that rendered but was never wired to anything: this
 * one navigates, finds a lead by name, company, phone or email, and changes the
 * theme and density without a trip into settings.
 */
export function CommandPalette({ role, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { data: leads, isLoading: leadsLoading } = useLeads();
  const { theme, density, setTheme, setDensity } = usePreferences();

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };

    const nav: Command[] = visibleNavItems(role).map((item) => ({
      id: `nav-${item.to}`,
      group: "Go to",
      label: item.label,
      hint: item.to,
      icon: item.icon,
      run: go(item.to),
    }));

    const leadCommands: Command[] = (leads ?? []).map((lead) => ({
      id: `lead-${lead.id}`,
      group: "Leads",
      label: leadName(lead),
      hint: [lead.phone, lead.company].filter(Boolean).join(" · ") || undefined,
      icon: Users,
      run: go(`/leads/${lead.id}`),
    }));

    const appearance: Command[] = [
      {
        id: "theme-dark",
        group: "Appearance",
        label: "Dark theme",
        selected: theme === "dark",
        icon: Moon,
        run: () => {
          setTheme("dark");
          onClose();
        },
      },
      {
        id: "theme-light",
        group: "Appearance",
        label: "Light theme",
        selected: theme === "light",
        icon: Sun,
        run: () => {
          setTheme("light");
          onClose();
        },
      },
      {
        id: "theme-system",
        group: "Appearance",
        label: "Match system theme",
        selected: theme === "system",
        icon: Monitor,
        run: () => {
          setTheme("system");
          onClose();
        },
      },
      {
        id: "density-comfortable",
        group: "Appearance",
        label: "Comfortable density",
        hint: "Larger text and spacing",
        selected: density === "comfortable",
        icon: Sun,
        run: () => {
          setDensity("comfortable");
          onClose();
        },
      },
      {
        id: "density-compact",
        group: "Appearance",
        label: "Compact density",
        hint: "More rows on screen",
        selected: density === "compact",
        icon: Minimize2,
        run: () => {
          setDensity("compact");
          onClose();
        },
      },
    ];

    return [...nav, ...leadCommands, ...appearance];
  }, [role, leads, navigate, onClose, theme, density, setTheme, setDensity]);

  const matches = useMemo(() => {
    const scored = commands
      .map((command) => {
        const keywords = [command.hint ?? "", command.group, command.id.replace(/^[a-z]+-/, "")];
        return { command, rank: relevance(query, command.label, keywords) };
      })
      .filter((entry): entry is { command: Command; rank: number } => entry.rank !== null);

    // With no query, show everything except the lead list, which is long and
    // only useful once there is something to narrow it by.
    if (!query.trim()) {
      return scored.filter((entry) => entry.command.group !== "Leads").map((entry) => entry.command);
    }
    return scored
      .sort((a, b) => a.rank - b.rank || a.command.label.localeCompare(b.command.label))
      .slice(0, 40)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function runAt(index: number) {
    const command = matches[index];
    if (command) command.run();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (matches.length === 0 ? 0 : (index + 1) % matches.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (matches.length === 0 ? 0 : (index - 1 + matches.length) % matches.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runAt(activeIndex);
    }
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let renderedGroup = "";
  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-floating"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search leads or jump to a page…"
            aria-label="Search leads or jump to a page"
            className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-faint"
          />
          <kbd className="hidden shrink-0 rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
          {matches.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted">
              {leadsLoading ? "Loading leads…" : `Nothing matches “${query}”.`}
            </p>
          )}

          {matches.map((command) => {
            const showGroup = command.group !== renderedGroup;
            renderedGroup = command.group;
            flatIndex += 1;
            const index = flatIndex;
            const Icon = command.icon;
            const isActive = index === activeIndex;

            return (
              <React.Fragment key={command.id}>
                {showGroup && (
                  <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint first:pt-1">
                    {command.group}
                  </p>
                )}
                <button
                  type="button"
                  data-index={index}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runAt(index)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? "bg-accent/15 text-ink" : "text-muted hover:bg-hover"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-accent" : "text-faint"}`} />
                  <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                  {command.hint && (
                    <span className="hidden max-w-[45%] truncate font-mono text-xs text-faint sm:block">
                      {command.hint}
                    </span>
                  )}
                  {command.selected ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Active" />
                  ) : null}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-inset px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1.5">
            <CornerDownLeft className="h-3 w-3" /> to open · ↑↓ to move · esc to close
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <Phone className="h-3 w-3" />
            {leads?.length ?? 0} leads indexed
          </span>
        </div>
      </div>
    </div>
  );
}
