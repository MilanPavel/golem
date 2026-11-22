import type { ReactNode } from "react";
import type { ListedModel } from "../../../store/models.ts";
import { cn } from "../../../ui/cn.ts";
import { ProviderIcon } from "../../../ui/provider-icons.tsx";
import { Badge } from "../../../ui/badge.tsx";
import { isStarred, modelsOf, type ProviderEntry, type ProviderGroups } from "./derive.ts";

export const ALL = "all";

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="px-2 pt-3 pb-1 text-meta font-semibold tracking-wide text-faint uppercase">{children}</h3>;
}

function Row({
  selected,
  onSelect,
  mark,
  name,
  tail,
  dim = false,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  mark: ReactNode;
  name: string;
  tail: ReactNode;
  dim?: boolean;
  label: string;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2",
          selected ? "bg-surface font-semibold text-ink shadow-soft" : dim ? "text-muted" : "text-ink",
        )}
      >
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-sm bg-sunken text-muted">
          {mark}
        </span>
        <span aria-hidden="true" className="min-w-0 flex-1 truncate">
          {name}
        </span>
        <span aria-hidden="true" className="text-meta font-normal text-faint">
          {tail}
        </span>
      </button>
    </li>
  );
}

export type ProviderListProps = {
  groups: ProviderGroups;
  selected: string;
  onSelect: (id: string) => void;
  /** How many models the model menu lists. */
  starredCount: number;
  models: readonly ListedModel[] | null;
};

/** The providers on the left, in the groups of the page. "All starred models" comes first. */
export function ProviderList({ groups, selected, onSelect, starredCount, models }: ProviderListProps) {
  const row = (provider: ProviderEntry, unset = false) => {
    if (provider.kind === "later") {
      return (
        <Row
          key={provider.id}
          label={`${provider.name}, later`}
          selected={selected === provider.id}
          onSelect={() => {
            onSelect(provider.id);
          }}
          mark={<ProviderIcon provider={provider.id} name={provider.name} width="12" height="12" />}
          name={provider.name}
          tail={<Badge className="px-1.5 py-0 text-meta">later</Badge>}
          dim
        />
      );
    }
    const listed = modelsOf(models ?? [], provider.id);
    const count = `${listed.filter(isStarred).length}/${listed.length}`;
    return (
      <Row
        key={provider.id}
        label={unset ? `${provider.name}, set up` : `${provider.name}, ${listed.filter(isStarred).length} of ${listed.length} starred`}
        selected={selected === provider.id}
        onSelect={() => {
          onSelect(provider.id);
        }}
        mark={<ProviderIcon provider={provider.id} name={provider.name} width="12" height="12" />}
        name={provider.name}
        tail={unset ? "set up" : count}
        dim={unset}
      />
    );
  };
  return (
    <div role="group" aria-label="Providers" className="flex flex-col p-2">
      <ul className="flex flex-col gap-px">
        <Row
          label={`All starred models, ${starredCount}`}
          selected={selected === ALL}
          onSelect={() => {
            onSelect(ALL);
          }}
          mark="★"
          name="All starred models"
          tail={String(starredCount)}
        />
      </ul>
      <Heading>On this Mac</Heading>
      <ul className="flex flex-col gap-px">{groups.local.map((provider) => row(provider))}</ul>
      {groups.hosted.length === 0 ? null : (
        <>
          <Heading>Hosted</Heading>
          <ul className="flex flex-col gap-px">{groups.hosted.map((provider) => row(provider))}</ul>
        </>
      )}
      {groups.unset.length === 0 ? null : (
        <>
          <Heading>{`Not set up · ${groups.unset.length}`}</Heading>
          <ul className="flex flex-col gap-px">{groups.unset.map((provider) => row(provider, true))}</ul>
        </>
      )}
    </div>
  );
}
