import sqlite3; conn = sqlite3.connect("packages/web/data/monitor.db"); print(conn.execute("SELECT sql FROM sqlite_master WHERE name='alerts'").fetchone()[0]); conn.close()
