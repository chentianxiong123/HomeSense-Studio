import sys


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "run":
        from mi_cli.cli import cli_main
        cli_main(sys.argv[2:])
        return
    if len(sys.argv) >= 2 and sys.argv[1] == "serve":
        from mi_cli.cli import serve_main
        serve_main()
        return

    print('Usage: mi-cli run \'<json>\'')
    print('Example: mi-cli run \'{"action":"discover"}\'')
    sys.exit(1)


if __name__ == "__main__":
    main()
