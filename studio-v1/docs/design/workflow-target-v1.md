# Workflow Target V1

This note distills the archived workflow goals into the current HomeSense Studio codebase.
It is not a legacy blueprint. It is the target shape we are moving toward now.

## What Workflow Is For

- Turn successful Chat/device actions into reusable workflow definitions.
- Let Studio edit, preview, run, inspect, and improve those definitions.
- Keep device-management as the anchor: every device action should resolve against real devices, bindings, and capabilities.
- Keep trace visible to humans and keep internal reasoning out of persistent storage.

## Current Implementation Direction

- `device_capability` is the primary device node.
- Preview validates the target device, binding, capability, and required arguments before execution.
- Runtime rehearses the device capability before real execution.
- Successful workflow runs and device actions can be observed by the memory layer.
- Failed workflow nodes are captured as compensation observation tasks, so later repair/memory work has structured evidence.
- Workflow runs update memory experience paths: success increments `success_count`, failure increments `failure_count`.
- L2 candidate recall uses those counts: successful workflow-origin paths are boosted, failed paths are penalized, and `workflow_id` is visible in trace.
- Chat prompt receives top runtime candidates; workflow candidates instruct the model to preview and run the workflow before falling back to low-level device steps.
- Workflow tools can reuse remembered `workflow_inputs` when the model only supplies a workflow id, so the first preview is not forced to start from empty JSON.
- Chat can save successful execution paths as memory assets.
- Chat can also promote successful paths into workflow drafts for Studio.

## What a Good Workflow Looks Like

1. Start node injects the minimal inputs.
2. Device-capability nodes resolve to real devices and real capability schemas.
3. Subflow / executor fallback still works for compatibility, but the new device-capability path is the preferred one.
4. Preview shows blocked vs ready clearly.
5. Runtime emits trace that the UI can render as process cards.
6. A successful Chat path can become a workflow draft without manual reconstruction.

## Next Targets

- Broaden workflow reuse beyond one-step demos.
- Add real retry / rollback handling on top of the current failure-observation task.
- Add scheduled execution only after the manual runtime is stable.
- Keep the workflow UI focused on readable process cards instead of raw JSON.
