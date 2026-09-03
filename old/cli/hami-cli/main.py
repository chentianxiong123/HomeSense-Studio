def main():
    import argparse

    parser = argparse.ArgumentParser(description="HomeSense HAMI CLI")
    parser.add_argument("command", nargs="?", default="run", choices=["run"])
    parser.add_argument("payload", nargs="?", help="JSON object/array, or '-' to read stdin")

    args = parser.parse_args()

    if not args.payload:
        parser.print_help()
        return

    from hami_cli.cli import cli_main
    cli_main(args.payload)


if __name__ == "__main__":
    main()
