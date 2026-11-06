import { ThemeSwitch } from "../../theme-switch.tsx";
import { settingsPath } from "../../store/router.ts";
import { useNavigate } from "../../store/page-context.tsx";
import { Link } from "../../ui/link.tsx";
import { SECTIONS } from "./sections.ts";
import { SetupSection } from "./setup-section.tsx";

function Body({ section }: { section: string }) {
  switch (section) {
    case "setup":
      return <SetupSection />;
    case "appearance":
      return <ThemeSwitch />;
    default:
      return null;
  }
}

/** The settings page: the list of sections, and the section's body beside it. */
export function SettingsScreen({ section }: { section: string }) {
  const navigate = useNavigate();
  const current = SECTIONS.find((item) => item.id === section);
  return (
    <div data-screen="settings" className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Settings</h1>
        <div className="flex flex-col gap-5 md:flex-row">
          <nav aria-label="Settings sections" className="flex shrink-0 gap-1 md:w-44 md:flex-col">
            {SECTIONS.map((item) => (
              <Link
                key={item.id}
                href={settingsPath(item.id)}
                onNavigate={navigate}
                aria-current={item.id === section ? "page" : undefined}
                className="rounded-md px-3 py-1.5 text-sm text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2 aria-[current=page]:bg-sunken aria-[current=page]:text-ink"
              >
                {item.title}
              </Link>
            ))}
          </nav>
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            {current === undefined ? (
              <>
                <p>There is no such section.</p>
                <Link href={settingsPath()} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
                  Go to Settings
                </Link>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold tracking-tight">{current.title}</h2>
                <Body section={current.id} />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
