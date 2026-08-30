# Device Capability JSON V1

This is the current framework map for turning device integrations into structured capabilities that the LLM, sandbox, device management UI, and real executor can share.

## Flow

```text
CLI / integration source
  - mi-cli
  - adb-cli
  - future MCP skills
      |
      v
user_devices table
  - id, name, device_type
  - room_id
  - mi_did / adb_ip / ip_address
      |
      v
device card projection
  - display fields
  - room
  - online / ping
  - bindings
      |
      v
device-capability-registry
  - normalized capability_id
  - source
  - input_schema
  - output_schema
  - risk
  - executor metadata
      |
      +--> device management API
      +--> LLM tool: get_device_capabilities
      +--> sandbox rehearsal
      +--> real execution
```

## Capability Shape

```json
{
  "capability_id": "adb.launch_app",
  "name": "启动应用",
  "kind": "action",
  "source": "adb",
  "input_schema": {
    "type": "object",
    "required": ["package"],
    "properties": {
      "package": { "type": "string" }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "package": { "type": "string" }
    }
  },
  "risk": "normal",
  "metadata": {
    "adb_action": "launch_app"
  }
}
```

## Current Rule

The capability registry is the source for structured device capabilities.

- Device management UI may keep legacy display fields, but should read from the registry.
- LLM tools call `get_device_capabilities`, which reads from the registry.
- Sandbox rehearsal resolves the same `capability_id` before simulating.
- Real execution resolves the same `capability_id` before calling `adb-cli` or `mi-cli`.

## Boundaries

- Device cards describe what the device is and whether it is reachable.
- Device skills describe how the LLM should think and plan for a device type.
- Device capabilities describe what can be called with JSON arguments.
- Sandbox rehearsal validates a proposed call against the same capability JSON without mutating the real device.

## Next

The legacy device-management execute endpoint now routes through the same registry-backed execution path with a small compatibility adapter for old `params: string` payloads.

The device detail page now sends `capability_id` and structured `arguments` when the capability registry provides them. The old `capability + params` fields remain in the payload for compatibility and history display.

Next cleanup:

- Move sandbox home projections closer to the capability registry so rehearsal cards can show before/after state.
- Remove compatibility exports once devtest and older panels stop importing legacy ADB helper names.
