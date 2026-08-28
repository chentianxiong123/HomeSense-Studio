import sys


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "run":
        from adb_cli.cli import cli_main
        cli_main(sys.argv[2:])
        return

    print('Usage: adb-cli run \'<json>\'')
    print('Example: adb-cli run \'{"action":"list_devices"}\'')
    sys.exit(1)


if __name__ == "__main__":
    main()