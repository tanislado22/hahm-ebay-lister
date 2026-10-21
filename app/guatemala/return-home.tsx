"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  guatemalaAdminHome,
  leaveIsAllowed,
  UNSAVED_LEAVE_PROMPT,
  type GuatemalaAdminRole,
} from "@/lib/markets/guatemala-return-home";
import "./return-home.css";

type DirtyApi = {
  dirty: boolean;
  setDirty: (id: string, dirty: boolean) => void;
};

const DirtyContext = createContext<DirtyApi | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const setDirty = useCallback((id: string, dirty: boolean) => {
    setFlags((current) => {
      if (Boolean(current[id]) === dirty) return current;
      const next = { ...current };
      if (dirty) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  const dirty = useMemo(() => Object.values(flags).some(Boolean), [flags]);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty, setDirty]);
  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

export function useUnsavedChanges(dirty: boolean) {
  const context = useContext(DirtyContext);
  const id = useId();
  const setDirty = context?.setDirty;
  useEffect(() => {
    if (!setDirty) return;
    setDirty(id, dirty);
    return () => setDirty(id, false);
  }, [setDirty, id, dirty]);
}

export function ReturnHomeBar({ role }: { role: GuatemalaAdminRole }) {
  const context = useContext(DirtyContext);
  const unsaved = context?.dirty ?? false;
  const href = guatemalaAdminHome(role);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!unsaved) return;
    if (leaveIsAllowed({ dirty: true, confirmed: window.confirm(UNSAVED_LEAVE_PROMPT) })) return;
    event.preventDefault();
  }

  return (
    <div className="gt-return-home-bar">
      <a className="btn btn-ghost gt-return-home" href={href} onClick={onClick}>
        Regresar a la pantalla principal
      </a>
    </div>
  );
}
