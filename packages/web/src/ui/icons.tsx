import type { ComponentProps } from "react";

type IconProps = Omit<ComponentProps<"svg">, "children">;

// 16 px, drawn in currentColor, hidden from screen readers: the control that holds an icon names it.
function Icon({ children, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A cog: eight teeth round a hub. */
export const GearIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.43 2.94L6.85 1.3h2.3l.42 1.64.9.37 1.46-.86 1.62 1.62-.86 1.46.37.9 1.64.42v2.3l-1.64.42-.37.9.86 1.46-1.62 1.62-1.46-.86-.9.37-.42 1.64h-2.3l-.42-1.64-.9-.37-1.46.86-1.62-1.62.86-1.46-.37-.9L1.3 9.15v-2.3l1.64-.42.37-.9-.86-1.46 1.62-1.62 1.46.86z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);
export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6l4 4 4-4" />
  </Icon>
);
export const SendIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </Icon>
);
export const StopIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);
export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" />
    <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
  </Icon>
);
/** A page with an arrow leaving it: open this somewhere else. */
export const OpenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 2.5h4v4" />
    <path d="M13.5 2.5L7.5 8.5" />
    <path d="M11.5 9v3A1.5 1.5 0 0 1 10 13.5H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5h3" />
  </Icon>
);
export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3.5 3.5" />
  </Icon>
);
/** A clock face: something that started on a schedule. */
export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.2l2 1.3" />
  </Icon>
);
export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
  </Icon>
);
export const PanelIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M10 3v10" />
  </Icon>
);
/** Three bars: the menu that opens the sidebar on a narrow window. */
export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </Icon>
);
/** Three bars of different reach, as a trace's waterfall. */
export const InspectIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 4h6M5 8h7M7.5 12h6" />
  </Icon>
);
export const MoreIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
  </Icon>
);
export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Icon>
);
export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" />
    <path d="M13 2.5v3h-3" />
  </Icon>
);
export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </Icon>
);
/** Three sliders: a line each, with a knob on it. */
export const SlidersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 4h4M10 4h4M2 8h1M7 8h7M2 12h6M12 12h2" />
    <circle cx="8" cy="4" r="1.5" />
    <circle cx="5" cy="8" r="1.5" />
    <circle cx="10" cy="12" r="1.5" />
  </Icon>
);
/** A padlock: a shackle over a body. */
export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);
/** A chip: a square with pins on each side. */
export const CpuIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
    <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
  </Icon>
);
/** A plug: two prongs, a body, a cable. */
export const PlugIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 1.5v3M10 1.5v3M4 4.5h8V7a4 4 0 0 1-8 0zM8 11v3.5" />
  </Icon>
);
/** An arrow that turns back: the undo button. */
export const UndoIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6.5H10a3 3 0 010 6H6M3.5 6.5l3-3M3.5 6.5l3 3" />
  </Icon>
);
/** A speech bubble: the sessions. */
export const SessionsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11h-1.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z" />
  </Icon>
);
/** A tray with a dip: what waits for you. */
export const InboxIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 9.5l1.7-5.2A1.5 1.5 0 0 1 5.1 3.3h5.8a1.5 1.5 0 0 1 1.4 1L14 9.5v2.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    <path d="M2 9.5h3.5l.8 1.5h3.4l.8-1.5H14" />
  </Icon>
);
/** A small table: a header row and two columns. */
export const DataIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12M6.5 6.5V13" />
  </Icon>
);
/** A clock: things that run on a schedule. */
export const RoutinesIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.2l2 1.3" />
  </Icon>
);
/** Boxes joined by a line: steps in order. */
export const WorkflowsIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="4" height="4" rx="1" />
    <rect x="10" y="9.5" width="4" height="4" rx="1" />
    <path d="M6 4.5h2.5A1.5 1.5 0 0 1 10 6v3.5" />
  </Icon>
);
/** A play triangle in a ring: a run that has started. */
export const RunsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M6.8 5.8v4.4L10.4 8z" />
  </Icon>
);

// Settings sidebar icons: the 1.4 stroke of the mock.
/** A letter i in a ring. */
export const SettingsInfoIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.9v.1" />
  </Icon>
);
/** A speech bubble. */
export const SettingsChatIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M2.5 3h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H8l-3.2 2.5V11.5H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
  </Icon>
);
/** A half-filled disc. */
export const SettingsAppearanceIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <circle cx="8" cy="8" r="6.5" /><path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />
  </Icon>
);
/** A bell. */
export const SettingsNotificationsIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14h3" />
  </Icon>
);
/** A path that turns. */
export const SettingsRoutingIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M3 13V9a3 3 0 0 1 3-3h7M10.5 3.5 13 6l-2.5 2.5M3 3v2" />
  </Icon>
);
/** A window with lines. */
export const SettingsContextIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <rect x="2" y="3" width="12" height="10" rx="2" /><path d="M5 6.5h6M5 9.5h3.5" />
  </Icon>
);
/** Three bars. */
export const SettingsUsageIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />
  </Icon>
);
/** Three boxes and a plus. */
export const SettingsMcpIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><path d="M11.25 9v4.5M9 11.25h4.5" />
  </Icon>
);
/** A phone. */
export const SettingsDevicesIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12.5h2" />
  </Icon>
);
/** A star. */
export const SettingsSkillsIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M8 2l1.7 3.6 3.8.5-2.8 2.7.7 3.8L8 10.8l-3.4 1.8.7-3.8L2.5 6.1l3.8-.5z" />
  </Icon>
);
/** Two people. */
export const SettingsAgentsIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <circle cx="5.5" cy="6" r="2.2" /><circle cx="11" cy="6.5" r="1.8" /><path d="M1.8 13a3.8 3.8 0 0 1 7.4 0M9.2 10.4a3 3 0 0 1 5 2.6" />
  </Icon>
);
/** Stacked cards. */
export const SettingsMemoryIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M5 2.5h6M4 5.5h8M3 8.5h10v5H3z" />
  </Icon>
);
/** A shield with a tick. */
export const SettingsRulesIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M8 1.8 13 4v4c0 3-2.2 5.2-5 6.2C5.2 13.2 3 11 3 8V4z" /><path d="m5.8 8 1.6 1.6 3-3" />
  </Icon>
);
/** A file with lines. */
export const SettingsConfigIcon = (props: IconProps) => (
  <Icon strokeWidth="1.4" {...props}>
    <path d="M4 2h5.5L12 4.5V14H4z" /><path d="M9.5 2v2.5H12M6 8h4M6 10.5h4" />
  </Icon>
);
/** A shield: the permission mode. */
export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4z" />
  </Icon>
);
/** A short list: a plan. */
export const PlanIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4h8M5 8h8M5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </Icon>
);

/** A git branch: two nodes joined by a line, with a third that forks off it. */
export const BranchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-2.5 2.5-5.5 3.5" />
  </Icon>
);
