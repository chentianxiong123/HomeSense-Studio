ERROR_CODE_MAP = {
    "-10000": "UNKNOWN_ERROR",
    "-10007": "DEVICE_OFFLINE",
    "-10030": "TOKEN_EXPIRED",
    "-10020": "DEVICE_NOT_FOUND",
    "-10010": "INVALID_PARAMS",
    "-10008": "RATE_LIMIT",
    "-10006": "NETWORK_TIMEOUT",
    "-10001": "AUTH_FAILED",
    "-10014": "SPEC_NOT_FOUND",
    "-10015": "ACTION_NOT_FOUND",
}


def _map_error_code(code) -> str:
    return ERROR_CODE_MAP.get(str(code), "CLI_ERROR")
