#!/usr/bin/env python3
"""ESXtop Lens launcher.

    python3 start.py                 # local server, first free port, open browser
    python3 start.py --no-browser    # server only
    python3 start.py --port 8080     # try 8080 first
    python3 start.py --host 0.0.0.0  # reachable from the LAN (be deliberate)

No third-party packages are required.
"""

from __future__ import annotations

import sys

from esxtop_perf.server import main

if __name__ == "__main__":
    sys.exit(main())
