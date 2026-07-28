import React, { useState } from "react";

export function UserCard({ user }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div onClick={() => setExpanded(!expanded)}>
      <h3>{user.name}</h3>
      {expanded && <p>{user.bio}</p>}
    </div>
  );
}
