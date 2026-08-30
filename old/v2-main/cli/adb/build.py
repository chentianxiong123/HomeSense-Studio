from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DIST_DIR = PROJECT_ROOT / "dist"


def main():
    DIST_DIR.mkdir(exist_ok=True)
    print("[build] Placeholder build script")
    print("[build] Target output:", DIST_DIR / "adb-cli.exe")
    print("[build] Replace this stub with PyInstaller or your preferred packager.")


if __name__ == "__main__":
    main()
