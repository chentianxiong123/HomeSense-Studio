import sys


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "run":
        from media_cli.cli import cli_main
        cli_main(sys.argv[2:])
        return
    if len(sys.argv) >= 2 and sys.argv[1] == "serve":
        from media_cli.cli import serve_main
        serve_main()
        return

    print('Usage: media-cli run \'<json>\'')
    print('Example: media-cli run \'{"action":"search_bilibili","keyword":"lofi"}\'')
    sys.exit(1)


if __name__ == "__main__":
    main()
