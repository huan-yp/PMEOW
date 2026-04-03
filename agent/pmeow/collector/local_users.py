"""Collect bindable local user accounts from the host system."""

from __future__ import annotations

import pwd

from pmeow.models import LocalUserRecord


_DEFAULT_UID_MIN = 1000
_NOLOGIN_SHELLS = {
    "",
    "/bin/false",
    "/sbin/nologin",
    "/usr/bin/false",
    "/usr/sbin/nologin",
}
_EXCLUDED_USERNAMES = {"nobody", "nobody4", "noaccess"}


def _read_uid_min() -> int:
    try:
        with open("/etc/login.defs", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) >= 2 and parts[0] == "UID_MIN":
                    return max(1, int(parts[1]))
    except (OSError, ValueError):
        pass

    return _DEFAULT_UID_MIN


def _is_bindable_user(entry: pwd.struct_passwd, uid_min: int) -> bool:
    username = entry.pw_name.strip()
    if not username or username in _EXCLUDED_USERNAMES:
        return False
    if entry.pw_uid < uid_min:
        return False
    if (entry.pw_shell or "") in _NOLOGIN_SHELLS:
        return False
    return True


def collect_local_users(uid_min: int | None = None) -> list[LocalUserRecord]:
    """Collect bindable local user accounts using passwd/NSS semantics."""
    minimum_uid = _read_uid_min() if uid_min is None else max(1, uid_min)
    users: list[LocalUserRecord] = []

    for entry in pwd.getpwall():
        if not _is_bindable_user(entry, minimum_uid):
            continue
        users.append(LocalUserRecord(
            username=entry.pw_name,
            uid=entry.pw_uid,
            gid=entry.pw_gid,
            gecos=entry.pw_gecos,
            home=entry.pw_dir,
            shell=entry.pw_shell,
        ))

    users.sort(key=lambda user: (user.username, user.uid, user.gid))
    return users