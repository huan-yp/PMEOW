"""Docker container collector."""

from __future__ import annotations

import subprocess

from pmeow.models import DockerContainer

# Format string for `docker ps`. Fields separated by a delimiter unlikely in data.
_SEP = "|||"
_FORMAT = _SEP.join([
    "{{.ID}}",
    "{{.Names}}",
    "{{.Image}}",
    "{{.Status}}",
    "{{.State}}",
    "{{.Ports}}",
    "{{.CreatedAt}}",
])


def collect_docker() -> list[DockerContainer]:
    """Collect running Docker containers.

    Returns an empty list if Docker is unavailable.
    """
    try:
        out = subprocess.run(
            ["docker", "ps", "-a", "--no-trunc", f"--format={_FORMAT}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if out.returncode != 0:
            return []
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return []

    containers: list[DockerContainer] = []
    for line in out.stdout.strip().splitlines():
        parts = line.split(_SEP)
        if len(parts) < 7:
            continue
        containers.append(DockerContainer(
            id=parts[0],
            name=parts[1],
            image=parts[2],
            status=parts[3],
            state=parts[4],
            ports=parts[5],
            created_at=parts[6],
        ))

    return containers
