const PROVINCE_PRUIDS = Object.freeze({
  AB: "48",
  BC: "59",
  MB: "46",
  NB: "13",
  NL: "10",
  NS: "12",
  NT: "61",
  NU: "62",
  ON: "35",
  PE: "11",
  QC: "24",
  SK: "47",
  YT: "60",
});

export class RealtimeScopeError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = "RealtimeScopeError";
    this.statusCode = statusCode;
  }
}

export function provinceToPruid(province) {
  return PROVINCE_PRUIDS[String(province ?? "").trim().toUpperCase()] ?? null;
}

export function deriveRealtimeScope({ profile, user }) {
  const profileId = String(profile?.id ?? user?.id ?? "").trim();
  const storedRole = String(profile?.role ?? "public_user").trim().toLowerCase();
  const role = storedRole === "user" ? "public_user" : storedRole;

  if (!profileId || profileId !== String(user?.id ?? "").trim()) {
    throw new RealtimeScopeError("The verified profile does not match the session.");
  }

  if (role === "public_user") {
    return Object.freeze({
      channels: Object.freeze([`user:${profileId}:submissions`]),
      kind: "user",
      profileId,
      pruid: null,
      role,
    });
  }

  if (role !== "commissioner") {
    throw new RealtimeScopeError("The verified profile role cannot use realtime.");
  }

  const pruid = provinceToPruid(profile?.province);
  if (!pruid) {
    throw new RealtimeScopeError("The Commissioner profile has no supported province scope.");
  }

  return Object.freeze({
    channels: Object.freeze([
      `province:${pruid}:submissions`,
      `province:${pruid}:workspace`,
      `province:${pruid}:archive`,
      `province:${pruid}:heatmap`,
    ]),
    kind: "province",
    profileId,
    pruid,
    role,
  });
}

