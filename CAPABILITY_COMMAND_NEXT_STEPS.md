# Capability / Command Next Steps

## Immediate implementation order

1. Add `CapabilityCommandV0` type to backend shared state/types.
2. Add a `capability -> ToolAction` adapter layer.
3. Map existing `adb` and `hami` actions first.
4. Convert selected graph outputs to emit capability commands before ToolAction.
5. Upgrade skills metadata to reference capabilities explicitly.

## Best first scope

Start with these capabilities:
- `device.tv.navigate.back`
- `device.tv.navigate.home`
- `home.voice.execute`
- `device.tv.ui.inspect.tree`
- `device.tv.ui.find_text`
- `device.tv.ui.click_element`
- `agent.fast.rule.match`
- `agent.fast.intent.match`
- `agent.fast.success_path.search`
- `agent.deep.plan`

## Not yet

Do not do these first:
- full registry implementation
- visual workflow builder
- self-orchestration engine
- full migration of every tool in one pass
