// src/components/UserBadge.tsx
"use client";

import { useState, useRef } from "react";
import type { GristUser } from "@/lib/grist/hooks";

interface UserBadgeProps {
  user: GristUser | null;
  onSetName: (name: string) => void;
}

/**
 * Affiche le nom de l'utilisateur courant dans la top bar.
 * Si l'utilisateur est inconnu, propose une saisie inline mémorisée
 * dans le localStorage (aucun appel réseau).
 */
export function UserBadge({ user, onSetName }: UserBadgeProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(value: string) {
    const name = value.trim();
    if (name) onSetName(name);
    setEditing(false);
  }

  if (user) {
    return (
      <div className="app-header__user" title={user.email || user.name}>
        <i className="fa-solid fa-circle-user" />
        <span>{user.name}</span>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="app-header__user app-header__user--editing">
        <i className="fa-solid fa-circle-user" />
        <input
          ref={inputRef}
          className="app-header__user-input"
          autoFocus
          placeholder="Votre prénom…"
          onBlur={e => commit(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === "Enter")  commit((e.target as HTMLInputElement).value);
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <button
      className="app-header__user app-header__user--unknown"
      title="Cliquer pour indiquer votre nom"
      onClick={() => setEditing(true)}
    >
      <i className="fa-solid fa-circle-question" />
      <span>Identifier</span>
    </button>
  );
}
