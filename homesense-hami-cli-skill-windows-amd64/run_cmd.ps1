$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir\hami-cli.cmd" @args
