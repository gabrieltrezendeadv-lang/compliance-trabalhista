"use client";

import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OrgSwitcherProps {
  orgName: string;
}

export function OrgSwitcher({ orgName }: OrgSwitcherProps) {
  // TODO: implement multi-org switching when user belongs to multiple orgs
  return (
    <Button
      variant="ghost"
      className="w-full justify-start gap-2 px-3 text-left"
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
        {orgName.charAt(0).toUpperCase()}
      </div>
      <span className="flex-1 truncate text-sm font-medium">{orgName}</span>
      <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Button>
  );
}
