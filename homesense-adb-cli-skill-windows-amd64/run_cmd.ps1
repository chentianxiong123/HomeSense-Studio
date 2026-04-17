$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir\adb-cli.cmd" @args
