import type { ComponentType } from "react";
import {
  Clock,
  FileText,
  Headset,
  LayoutDashboard,
  PhoneCall,
  Shield,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import type { AppRole } from "@/types/app";

export type NavGroup = "Work" | "Manage" | "Admin";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  group: NavGroup;
  /** When set, the entry is only shown to these roles. */
  roles?: AppRole[];
}

/**
 * Ordered by how the job actually flows: work the queue and review calls, then
 * manage the campaigns and scripts that feed it, then administer the system.
 */
export const NAV_ITEMS: NavItem[] = [
  // The workspace comes first because it is the screen the job is done on;
  // everything below it is preparation or review.
  { to: "/workspace", label: "Workspace", icon: Headset, group: "Work" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Work" },
  { to: "/leads", label: "Leads", icon: Users, group: "Work" },
  { to: "/history", label: "Call history", icon: Clock, group: "Work" },
  { to: "/campaigns", label: "Campaigns", icon: Target, group: "Manage" },
  { to: "/scripts", label: "Scripts", icon: FileText, group: "Manage" },
  { to: "/phone", label: "Phone", icon: PhoneCall, group: "Admin", roles: ["admin"] },
  { to: "/team", label: "Team", icon: UserPlus, group: "Admin", roles: ["admin"] },
  { to: "/admin", label: "Administration", icon: Shield, group: "Admin", roles: ["admin"] },
];

export const NAV_GROUPS: NavGroup[] = ["Work", "Manage", "Admin"];

export function visibleNavItems(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
