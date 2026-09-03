<script setup lang="ts">
import { computed } from 'vue'
import PlanPreviewCard from '../PlanPreviewCard.vue'
import {
  formatNodeCategory,
  formatNodeDescription,
  formatNodeFieldLabel,
  formatNodeLabel,
} from '../../features/studio/studioNodeDisplay'
import {
  formatBindingKind,
  formatCapability,
  formatExecutionMode,
  formatVariableMode,
  formatVariableSource,
} from '../../features/studio/studioViewDisplay'
import {
  formatAgentAdapterCategory,
  formatAgentAdapterMode,
  formatAgentAdapterStatus,
  formatAgentAdapterTransport,
  formatCliExecutorProtocol,
  formatCliExecutorSource,
  formatExecutorKind,
} from '../../features/studio/studioExecutorDisplay'
import { buildWorkflowStepSummary } from '../../features/studio/workflowRunSummary'

const props = defineProps<{
  selectedNode: any
  selectedNodeIndex: number | null
  selectedNodeDefinition: any
  selectedConfigFields: any[]
  selectedOutputFields: any[]
  selectedNodeTrace: any
  availableVariableBindings: any[]
  variableFieldTargets: any[]
  selectedVariableTarget: string
  selectedBindingSummary: any[]
  runtimeExecutors: any[]
  runtimeAgentAdapters: any[]
  availablePlans: any[]
  availableCliExecutors: any[]
  selectedExecutorName: string
  selectedExecutorParams: any
  selectedExecutorDescriptor: any
  selectedCliExecutor: any
  selectedCliActions: any[]
  selectedCliActionDetail: any
  selectedCliParamEntries: any[]
  selectedAgentTargets: string[]
  selectedAgentAdapter: any
  runtimeDeviceManifest: any[]
  runtimeDeviceManifestLoading: boolean
  availableSubflowWorkflows: any[]
  workflows: any[]
  executorParamsText: string
  inspectorCopy: any
  hasUnsavedVariableSources: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  (e: 'update:selectedVariableTarget', value: string): void
  (e: 'update:executorParamsText', value: string): void
  (e: 'remove-node'): void
  (e: 'update-label', value: string): void
  (e: 'update-config', key: string, value: any): void
  (e: 'update-executor-param', key: string, value: any): void
  (e: 'update-executor-object-param', key: string, raw: string): void
  (e: 'apply-executor-preset', executorName: string): void
  (e: 'apply-executor-plan', planId: string): void
  (e: 'apply-cli-executor', cliName: string): void
  (e: 'apply-cli-action', action: string): void
  (e: 'apply-agent-adapter', target: string): void
  (e: 'apply-agent-sample'): void
  (e: 'refresh-runtime-device-manifest'): void
  (e: 'update-cli-param', key: string, type: string, value: any): void
  (e: 'update-cli-json-param', key: string, raw: string): void
  (e: 'update-node-object-config', key: string, raw: string): void
  (e: 'commit-executor-params', raw: string): void
  (e: 'commit-node-config', raw: string): void
  (e: 'update-number-config', key: string, raw: string): void
  (e: 'update-select-config', field: any, raw: string): void
  (e: 'retarget-binding', row: any, nextTemplate: string): void
  (e: 'remove-binding', row: any): void
  (e: 'insert-variable-json', targetId: string, binding: any): void
  (e: 'insert-variable-template', targetId: string, template: string): void
}>()

const localVariableTarget = computed({
  get: () => props.selectedVariableTarget,
  set: (val) => emit('update:selectedVariableTarget', val)
})

const localExecutorParamsText = computed({
  get: () => props.executorParamsText,
  set: (val) => emit('update:executorParamsText', val)
})

function formatTraceJson(value: any): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function formatJsonConfigValue(value: any): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

const selectedDeviceCapabilityDeviceId = computed(() => {
  const raw = props.selectedNode?.config?.device_id
  const id = Number(raw)
  return Number.isFinite(id) && props.runtimeDeviceManifest.some((device) => device.id === id) ? id : ''
})

const selectedDeviceCapabilityDevice = computed(() =>
  props.runtimeDeviceManifest.find((device) => device.id === selectedDeviceCapabilityDeviceId.value) ?? null,
)

const selectedDeviceCapabilities = computed(() =>
  (selectedDeviceCapabilityDevice.value?.capabilities ?? []) as any[],
)

const selectedConcreteCapabilityId = computed(() => {
  const capabilityId = String(props.selectedNode?.config?.capability_id ?? '')
  return selectedDeviceCapabilities.value.some((capability) => capability.capability_id === capabilityId)
    ? capabilityId
    : ''
})

const selectedDeviceCapability = computed(() =>
  selectedDeviceCapabilities.value.find((capability) => capability.capability_id === selectedConcreteCapabilityId.value) ?? null,
)

const selectedTraceSummary = computed(() => {
  const trace = props.selectedNodeTrace
  if (!trace) return null
  return buildWorkflowStepSummary({
    nodeId: String(trace.node_id ?? ''),
    nodeType: String(trace.node_type ?? props.selectedNode?.type ?? ''),
    status: trace.status ?? 'skipped',
    outputs: trace.outputs ?? {},
    error: trace.error,
    durationMs: trace.duration_ms,
  }, props.label)
})

function isTemplateLike(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith('{{') && value.trim().endsWith('}}')
}

function deviceLabel(device: any): string {
  return [device.name, device.room?.name, device.device_type].filter(Boolean).join(' · ')
}

function handleDeviceCapabilityDeviceChange(raw: string) {
  if (!raw) {
    emit('update-config', 'device_id', null)
    return
  }
  const id = Number(raw)
  emit('update-config', 'device_id', Number.isFinite(id) ? id : raw)
  const device = props.runtimeDeviceManifest.find((item) => item.id === id)
  const capabilities = (device?.capabilities ?? []) as any[]
  const firstCapability = capabilities[0]
  if (firstCapability) {
    emit('update-config', 'capability_id', firstCapability.capability_id)
    emit('update-config', 'capability', firstCapability.name)
    if (isEmptyObject(props.selectedNode?.config?.arguments)) {
      emit('update-config', 'arguments', firstCapability.sample_arguments ?? {})
    }
  }
}

function handleDeviceCapabilityChange(capabilityId: string) {
  const capability = selectedDeviceCapabilities.value.find((item) => item.capability_id === capabilityId)
  emit('update-config', 'capability_id', capabilityId)
  emit('update-config', 'capability', capability?.name ?? '')
  if (capability && isEmptyObject(props.selectedNode?.config?.arguments)) {
    emit('update-config', 'arguments', capability.sample_arguments ?? {})
  }
}

function applyDeviceCapabilitySampleArguments() {
  if (!selectedDeviceCapability.value) return
  emit('update-config', 'arguments', selectedDeviceCapability.value.sample_arguments ?? {})
}

function isEmptyObject(value: unknown): boolean {
  return !value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)
}
</script>

<template>
  <aside class="node-inspector custom-scrollbar">
    <div class="inspector-header">
      <div class="header-main">
        <span class="eyebrow">{{ formatNodeLabel(selectedNode.type, selectedNode.type, label) }}</span>
        <h3 class="node-title">{{ selectedNode.label }}</h3>
      </div>
      <button class="remove-btn" @click="emit('remove-node')">
        {{ label('删除', 'Remove') }}
      </button>
    </div>

    <div class="inspector-body">
      <!-- Basic Info Section -->
      <section class="inspector-section">
        <div class="section-head">
          <h5>{{ inspectorCopy.basicInfo }}</h5>
        </div>

        <div class="form-group">
          <label>{{ label('显示名称', 'Label') }}</label>
          <input
            :value="selectedNode.label"
            class="styled-input"
            @input="emit('update-label', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div v-if="selectedNodeDefinition" class="glass-card contract-card">
          <div class="card-head">
            <span class="card-label">{{ label('节点契约', 'Node Contract') }}</span>
            <span class="type-badge">{{ formatNodeCategory(selectedNodeDefinition.category, label) }}</span>
          </div>
          <p class="node-description">{{ formatNodeDescription(selectedNodeDefinition.type, selectedNodeDefinition.description, label) }}</p>

          <div v-if="selectedConfigFields.length > 0" class="contract-subsection">
            <div class="subsection-title">{{ label('配置项', 'Config') }}</div>
            <div
              v-for="field in selectedConfigFields"
              :key="`config-${field.key}`"
              class="contract-row"
            >
              <span class="row-key">{{ formatNodeFieldLabel(field.key, field.key, label) }}</span>
              <span class="row-type">{{ field.control }}</span>
            </div>
          </div>

          <div v-if="selectedOutputFields.length > 0" class="contract-subsection">
            <div class="subsection-title">{{ label('输出', 'Outputs') }}</div>
            <div
              v-for="field in selectedOutputFields"
              :key="`output-${field.key}`"
              class="contract-row"
            >
              <span class="row-key">{{ formatNodeFieldLabel(field.key, field.key, label) }}</span>
              <span class="row-type">{{ field.type }}</span>
              <p v-if="field.description" class="row-help">{{ field.description }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Run Trace Section -->
      <section v-if="selectedNodeTrace" class="inspector-section">
        <div class="section-head">
          <h5>{{ inspectorCopy.runTrace }}</h5>
        </div>
        <div class="glass-card trace-card">
          <div class="card-head">
            <span class="card-label">{{ label('最近运行', 'Last Run') }}</span>
            <span :class="['status-chip', selectedNodeTrace.status]">{{ selectedNodeTrace.status }}</span>
          </div>
          <div class="trace-meta">
            <span>{{ selectedNodeTrace.duration_ms }}ms</span>
            <span class="node-id-hint">ID: {{ selectedNodeTrace.node_id }}</span>
          </div>
          <div v-if="selectedNodeTrace.error" class="trace-error">{{ selectedNodeTrace.error }}</div>

          <div v-if="selectedTraceSummary" :class="['trace-summary-card', selectedTraceSummary.kind, selectedTraceSummary.tone]">
            <div class="trace-summary-title">{{ selectedTraceSummary.title }}</div>
            <div v-if="selectedTraceSummary.device" class="trace-summary-device">
              <span :class="['trace-device-dot', selectedTraceSummary.device.status]"></span>
              <div>
                <strong>{{ selectedTraceSummary.device.name }}</strong>
                <span v-if="selectedTraceSummary.device.detail">{{ selectedTraceSummary.device.detail }}</span>
              </div>
            </div>
            <div v-if="selectedTraceSummary.phases?.length" class="trace-phase-row">
              <span
                v-for="phase in selectedTraceSummary.phases"
                :key="phase.label"
                :class="['trace-phase-chip', phase.tone]"
              >
                <em>{{ phase.label }}</em>
                <strong>{{ phase.value }}</strong>
              </span>
            </div>
            <div v-if="selectedTraceSummary.effect" class="trace-effect">{{ selectedTraceSummary.effect }}</div>
            <div v-if="selectedTraceSummary.changedFields?.length" class="trace-changed-fields">
              <span
                v-for="field in selectedTraceSummary.changedFields"
                :key="field"
              >
                {{ field }}
              </span>
            </div>
            <div class="trace-summary-rows">
              <div
                v-for="row in selectedTraceSummary.rows"
                :key="row.label"
                class="trace-summary-row"
              >
                <span>{{ row.label }}</span>
                <strong>{{ row.value }}</strong>
              </div>
            </div>
          </div>

          <div class="trace-details-list">
            <details class="styled-details">
              <summary>{{ inspectorCopy.rawInputs }}</summary>
              <pre class="json-block">{{ formatTraceJson(selectedNodeTrace.inputs) }}</pre>
            </details>
            <details v-if="selectedNodeTrace.resolved_inputs" class="styled-details">
              <summary>{{ inspectorCopy.resolvedInputs }}</summary>
              <pre class="json-block">{{ formatTraceJson(selectedNodeTrace.resolved_inputs) }}</pre>
            </details>
            <details v-if="selectedNodeTrace.upstream && selectedNodeTrace.upstream.length > 0" class="styled-details">
              <summary>{{ inspectorCopy.upstream }}</summary>
              <pre class="json-block">{{ formatTraceJson(selectedNodeTrace.upstream) }}</pre>
            </details>
            <details class="styled-details">
              <summary>{{ inspectorCopy.outputs }}</summary>
              <pre class="json-block">{{ formatTraceJson(selectedNodeTrace.outputs) }}</pre>
            </details>
          </div>
        </div>
      </section>

      <!-- Variable Mapping Section -->
      <section v-if="availableVariableBindings.length > 0 && variableFieldTargets.length > 0" class="inspector-section">
        <div class="section-head">
          <h5>{{ inspectorCopy.variableMapping }}</h5>
        </div>
        <div class="glass-card mapping-card">
          <div class="form-group">
            <label>{{ label('插入目标', 'Insert Into') }}</label>
            <select v-model="localVariableTarget" class="styled-select">
              <option
                v-for="target in variableFieldTargets"
                :key="target.id"
                :value="target.id"
              >
                {{ target.label }} · {{ formatVariableMode(target.mode, label) }}
              </option>
            </select>
          </div>
          <div class="variable-pool">
            <button
              v-for="binding in availableVariableBindings"
              :key="binding.template"
              type="button"
              class="variable-tag"
              @click="(variableFieldTargets.find((t) => t.id === localVariableTarget)?.mode === 'json')
                ? emit('insert-variable-json', localVariableTarget, binding)
                : emit('insert-variable-template', localVariableTarget, binding.template)"
            >
              <span class="var-name">{{ binding.label }}</span>
              <span class="var-source">{{ formatVariableSource(binding.source, label) }}</span>
            </button>
          </div>
          <p v-if="hasUnsavedVariableSources" class="hint-text">
            {{ label('保存后可引用新建节点的输出', 'Save to reference new node outputs') }}
          </p>
        </div>
      </section>

      <!-- Active Bindings -->
      <section v-if="selectedBindingSummary.length > 0" class="inspector-section">
        <div class="section-head">
          <h5>{{ label('绑定关系', 'Bindings') }}</h5>
        </div>
        <div class="binding-list">
          <div
            v-for="binding in selectedBindingSummary"
            :key="`${binding.path}:${binding.occurrence}:${binding.template}`"
            class="binding-row glass-card"
          >
            <div class="binding-header">
              <span class="binding-path">{{ binding.path }}</span>
              <button class="remove-binding-btn" @click="emit('remove-binding', binding)">×</button>
            </div>
            <div class="binding-edit">
              <select
                class="binding-select"
                :value="binding.template"
                @change="emit('retarget-binding', binding, ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-if="!availableVariableBindings.some((item) => item.template === binding.template)"
                  :value="binding.template"
                >
                  {{ binding.template }} ({{ inspectorCopy.unresolvedSuffix }})
                </option>
                <option
                  v-for="option in availableVariableBindings"
                  :key="option.template"
                  :value="option.template"
                >
                  {{ option.label }}
                </option>
              </select>
              <span v-if="binding.source" class="binding-source-label">{{ formatVariableSource(binding.source, label) }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Node Specific Config -->
      <template v-if="selectedNode.type === 'executor_call'">
        <section class="inspector-section">
          <div class="section-head">
            <h5>{{ inspectorCopy.executorConfig }}</h5>
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.runtimeExecutor }}</label>
            <select
              :value="selectedExecutorName"
              class="styled-select"
              @change="emit('apply-executor-preset', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ inspectorCopy.selectRuntimeExecutor }}</option>
              <option
                v-for="executor in runtimeExecutors"
                :key="executor.name"
                :value="executor.name"
              >
                {{ executor.name }}
              </option>
            </select>
          </div>

          <div v-if="selectedExecutorDescriptor" class="glass-card executor-info-card">
            <div class="card-head">
              <span class="card-label">{{ selectedExecutorDescriptor.name }}</span>
              <span :class="['type-badge', selectedExecutorDescriptor.enabled ? 'ready' : 'disabled']">
                {{ formatExecutorKind(selectedExecutorDescriptor.kind, label) }}
              </span>
            </div>
            <p class="executor-description">{{ selectedExecutorDescriptor.description }}</p>
            <div class="capability-list">
              <span
                v-for="cap in selectedExecutorDescriptor.capabilities"
                :key="cap"
                class="cap-tag"
              >
                {{ formatCapability(cap, label) }}
              </span>
            </div>
          </div>

          <div v-if="selectedExecutorName === 'plan.run'" class="form-group">
            <label>{{ inspectorCopy.planShortcut }}</label>
            <select
              :value="String(selectedExecutorParams.plan_id ?? '')"
              class="styled-select"
              @change="emit('apply-executor-plan', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ inspectorCopy.selectCompiledPlan }}</option>
              <option
                v-for="plan in availablePlans"
                :key="String(plan.id)"
                :value="String(plan.id)"
              >
                {{ String(plan.name) }}
              </option>
            </select>
          </div>

          <template v-else-if="selectedExecutorName === 'cli.invoke'">
            <div class="form-group">
              <label>{{ inspectorCopy.cliExecutor }}</label>
              <select
                :value="String(selectedExecutorParams.cli_name ?? '')"
                class="styled-select"
                @change="emit('apply-cli-executor', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ inspectorCopy.selectCliExecutor }}</option>
                <option
                  v-for="executor in availableCliExecutors"
                  :key="executor.name"
                  :value="executor.name"
                >
                  {{ executor.name }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>{{ inspectorCopy.action }}</label>
              <select
                :value="String(selectedExecutorParams.action ?? '')"
                class="styled-select"
                @change="emit('apply-cli-action', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ inspectorCopy.selectAction }}</option>
                <option
                  v-for="action in selectedCliActions"
                  :key="action"
                  :value="action"
                >
                  {{ action }}
                </option>
              </select>
            </div>

            <div v-if="selectedCliExecutor" class="glass-card executor-info-card">
              <div class="card-head">
                <span class="card-label">{{ selectedCliExecutor.name }}</span>
                <span class="type-badge">{{ formatCliExecutorSource(selectedCliExecutor.source, label) }}</span>
              </div>
              <div class="executor-stats">
                <span class="stat-tag">{{ formatCliExecutorProtocol(selectedCliExecutor.protocol, label) }}</span>
                <span class="stat-tag">{{ selectedCliExecutor.timeout_ms }}ms</span>
              </div>
              <div v-if="selectedCliActionDetail" class="action-schema">
                <div class="schema-name">{{ selectedCliActionDetail.name }}</div>
                <p v-if="selectedCliActionDetail.description" class="schema-desc">{{ selectedCliActionDetail.description }}</p>
                <pre class="json-block">{{ JSON.stringify(selectedCliActionDetail.params_schema, null, 2) }}</pre>
              </div>
            </div>

            <div v-if="selectedCliParamEntries.length" class="param-form glass-card">
              <div
                v-for="entry in selectedCliParamEntries"
                :key="entry.key"
                class="form-group"
              >
                <label class="param-label">
                  {{ entry.key }}
                  <span v-if="entry.required" class="required">*</span>
                  <span class="type-hint">{{ entry.rawType }}</span>
                </label>

                <label v-if="entry.control === 'boolean'" class="styled-checkbox">
                  <input
                    type="checkbox"
                    :checked="Boolean(selectedExecutorParams.params?.[entry.key])"
                    @change="emit('update-cli-param', entry.key, entry.type, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>{{ entry.key }}</span>
                </label>

                <input
                  v-else-if="entry.control === 'number'"
                  type="number"
                  class="styled-input"
                  :value="selectedExecutorParams.params?.[entry.key] ?? ''"
                  @input="emit('update-cli-param', entry.key, entry.type, ($event.target as HTMLInputElement).value)"
                />

                <textarea
                  v-else-if="entry.control === 'json'"
                  rows="4"
                  class="styled-textarea"
                  :value="JSON.stringify(selectedExecutorParams.params?.[entry.key] ?? {}, null, 2)"
                  @blur="emit('update-cli-json-param', entry.key, ($event.target as HTMLTextAreaElement).value)"
                ></textarea>

                <input
                  v-else
                  class="styled-input"
                  :value="selectedExecutorParams.params?.[entry.key] ?? ''"
                  @input="emit('update-cli-param', entry.key, entry.type, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </template>

          <template v-else-if="selectedExecutorName === 'agent.dispatch'">
            <div class="form-group">
              <label>{{ inspectorCopy.targetAgent }}</label>
              <select
                :value="String(selectedExecutorParams.target ?? '')"
                class="styled-select"
                @change="emit('apply-agent-adapter', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ inspectorCopy.selectTarget }}</option>
                <option
                  v-for="target in selectedAgentTargets"
                  :key="target"
                  :value="target"
                >
                  {{ target }}
                </option>
              </select>
            </div>

            <div v-if="selectedAgentAdapter" class="glass-card agent-info-card">
              <div class="card-head">
                <span class="card-label">{{ selectedAgentAdapter.display_name }}</span>
                <span :class="['status-chip', selectedAgentAdapter.status]">{{ formatAgentAdapterStatus(selectedAgentAdapter.status, label) }}</span>
              </div>
              <p class="agent-desc">{{ selectedAgentAdapter.description }}</p>
              <div class="agent-traits">
                <span class="trait">{{ formatAgentAdapterCategory(selectedAgentAdapter.category, label) }}</span>
                <span class="trait">{{ formatAgentAdapterTransport(selectedAgentAdapter.transport, label) }}</span>
                <span
                  v-if="selectedAgentAdapter.runtime_status"
                  :class="['trait', selectedAgentAdapter.runtime_status.configured ? 'live' : 'idle']"
                >
                  {{ formatAgentAdapterMode(selectedAgentAdapter.runtime_status.mode, label) }}
                </span>
              </div>

              <div class="action-strip">
                <span class="eyebrow-mini">{{ inspectorCopy.sampleDispatch }}</span>
                <button class="mini-btn" @click="emit('apply-agent-sample')">{{ inspectorCopy.useSample }}</button>
              </div>
              <pre class="json-block compact-json">{{ JSON.stringify(selectedAgentAdapter.sample_dispatch, null, 2) }}</pre>
            </div>

            <div class="form-group">
              <label>{{ inspectorCopy.task }}</label>
              <input
                :value="String(selectedExecutorParams.task ?? '')"
                class="styled-input"
                @input="emit('update-executor-param', 'task', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="form-group">
              <label>{{ inspectorCopy.executionMode }}</label>
              <select
                :value="String(selectedExecutorParams.execution_mode ?? 'deferred')"
                class="styled-select"
                @change="emit('update-executor-param', 'execution_mode', ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="mode in (selectedAgentAdapter?.execution_modes ?? ['deferred'])"
                  :key="mode"
                  :value="mode"
                >
                  {{ formatExecutionMode(mode, label) }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>{{ inspectorCopy.payloadJson }}</label>
              <textarea
                class="styled-textarea"
                :value="JSON.stringify(selectedExecutorParams.payload ?? {}, null, 2)"
                rows="6"
                @blur="emit('update-executor-object-param', 'payload', ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </div>
          </template>

          <template v-else-if="selectedExecutorName === 'workflow.run'">
            <div class="form-group">
              <label>{{ inspectorCopy.workflow }}</label>
              <select
                :value="String(selectedExecutorParams.workflow_id ?? '')"
                class="styled-select"
                @change="emit('update-executor-param', 'workflow_id', Number(($event.target as HTMLSelectElement).value))"
              >
                <option value="">{{ inspectorCopy.selectWorkflow }}</option>
                <option
                  v-for="wf in workflows"
                  :key="wf.id"
                  :value="wf.id"
                >
                  {{ wf.name }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>{{ inspectorCopy.inputsJson }}</label>
              <textarea
                class="styled-textarea"
                rows="6"
                :value="JSON.stringify(selectedExecutorParams.inputs ?? {}, null, 2)"
                @blur="emit('update-executor-object-param', 'inputs', ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </div>
          </template>

          <div class="form-group">
            <label>{{ inspectorCopy.advancedParamsJson }}</label>
            <textarea
              class="styled-textarea"
              v-model="localExecutorParamsText"
              rows="6"
              @blur="emit('commit-executor-params', localExecutorParamsText)"
            ></textarea>
          </div>

          <PlanPreviewCard v-if="selectedExecutorParams.plan_id" :plan-id="selectedExecutorParams.plan_id" />
        </section>
      </template>

      <template v-else-if="selectedNode.type === 'device_capability'">
        <section class="inspector-section">
          <div class="section-head">
            <h5>{{ inspectorCopy.deviceCapabilityConfig }}</h5>
            <button
              type="button"
              class="mini-btn"
              :disabled="runtimeDeviceManifestLoading"
              @click="emit('refresh-runtime-device-manifest')"
            >
              {{ runtimeDeviceManifestLoading ? label('读取中', 'Loading') : label('刷新', 'Refresh') }}
            </button>
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.device }}</label>
            <select
              class="styled-select"
              :value="selectedDeviceCapabilityDeviceId"
              :disabled="runtimeDeviceManifestLoading || runtimeDeviceManifest.length === 0"
              @change="handleDeviceCapabilityDeviceChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ inspectorCopy.selectDevice }}</option>
              <option
                v-for="device in runtimeDeviceManifest"
                :key="device.id"
                :value="device.id"
              >
                {{ deviceLabel(device) }}
              </option>
            </select>
            <p class="hint-text">{{ inspectorCopy.concreteDeviceHint }}</p>
          </div>

          <div class="form-group">
            <label>{{ formatNodeFieldLabel('device_id', 'Device ID', label) }}</label>
            <input
              class="styled-input"
              :value="String(selectedNode.config.device_id ?? '')"
              @input="emit('update-config', 'device_id', ($event.target as HTMLInputElement).value)"
            />
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.capability }}</label>
            <select
              class="styled-select"
              :value="selectedConcreteCapabilityId"
              :disabled="selectedDeviceCapabilities.length === 0"
              @change="handleDeviceCapabilityChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ inspectorCopy.selectCapability }}</option>
              <option
                v-for="capability in selectedDeviceCapabilities"
                :key="capability.capability_id"
                :value="capability.capability_id"
              >
                {{ capability.name || capability.capability_id }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label>{{ formatNodeFieldLabel('capability_id', 'Capability ID', label) }}</label>
            <input
              class="styled-input"
              :value="String(selectedNode.config.capability_id ?? '')"
              @input="emit('update-config', 'capability_id', ($event.target as HTMLInputElement).value)"
            />
          </div>

          <div v-if="selectedDeviceCapability" class="glass-card capability-contract-card">
            <div class="card-head">
              <span class="card-label">{{ selectedDeviceCapability.name }}</span>
              <span class="type-badge">{{ selectedDeviceCapability.source }}</span>
            </div>
            <div class="capability-meta-row">
              <span>{{ selectedDeviceCapability.kind }}</span>
              <span>{{ selectedDeviceCapability.risk }}</span>
              <span v-if="selectedDeviceCapability.required_fields?.length">
                {{ label('必填', 'Required') }}: {{ selectedDeviceCapability.required_fields.join(', ') }}
              </span>
            </div>
            <details class="styled-details compact-details">
              <summary>{{ inspectorCopy.capabilitySchema }}</summary>
              <pre class="json-block">{{ JSON.stringify(selectedDeviceCapability.input_schema ?? {}, null, 2) }}</pre>
            </details>
            <div class="action-strip">
              <span class="eyebrow-mini">{{ inspectorCopy.sampleArguments }}</span>
              <button class="mini-btn" type="button" @click="applyDeviceCapabilitySampleArguments">{{ inspectorCopy.useSample }}</button>
            </div>
            <pre class="json-block compact-json">{{ JSON.stringify(selectedDeviceCapability.sample_arguments ?? {}, null, 2) }}</pre>
          </div>

          <div class="form-group">
            <label>{{ formatNodeFieldLabel('arguments', 'Arguments', label) }}</label>
            <textarea
              class="styled-textarea"
              rows="6"
              :value="formatJsonConfigValue(selectedNode.config.arguments)"
              @blur="emit('update-node-object-config', 'arguments', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <p v-if="isTemplateLike(selectedNode.config.device_id) || isTemplateLike(selectedNode.config.capability_id)" class="hint-text">
              {{ label('当前节点使用模板输入，运行时会从 workflow inputs 解析。', 'This node uses template inputs and resolves them from workflow inputs at runtime.') }}
            </p>
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.configJson }}</label>
            <textarea
              class="styled-textarea"
              rows="7"
              :value="JSON.stringify(selectedNode.config ?? {}, null, 2)"
              @blur="emit('commit-node-config', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>
        </section>
      </template>

      <template v-else-if="selectedNode.type === 'subflow'">
        <section class="inspector-section">
          <div class="section-head">
            <h5>{{ inspectorCopy.subflowConfig }}</h5>
          </div>
          <div class="form-group">
            <label>{{ inspectorCopy.targetWorkflow }}</label>
            <select
              class="styled-select"
              :value="String(selectedNode.config.workflow_id ?? '')"
              @change="emit('update-config', 'workflow_id', (($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null))"
            >
              <option value="">{{ inspectorCopy.selectWorkflow }}</option>
              <option
                v-for="wf in availableSubflowWorkflows"
                :key="wf.id"
                :value="wf.id"
              >
                {{ wf.name }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.targetWorkflowName }}</label>
            <input
              class="styled-input"
              :value="String(selectedNode.config.workflow_name ?? '')"
              @input="emit('update-config', 'workflow_name', ($event.target as HTMLInputElement).value)"
            />
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.inputsJson }}</label>
            <textarea
              class="styled-textarea"
              rows="6"
              :value="JSON.stringify(selectedNode.config.inputs ?? {}, null, 2)"
              @blur="emit('update-node-object-config', 'inputs', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.outputKey }}</label>
            <input
              class="styled-input"
              :value="String(selectedNode.config.output_key ?? '')"
              @input="emit('update-config', 'output_key', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </section>
      </template>

      <template v-else-if="selectedNode.type === 'answer'">
        <section class="inspector-section">
          <div class="section-head">
            <h5>{{ inspectorCopy.answerConfig }}</h5>
          </div>
          <div class="form-group">
            <label>{{ inspectorCopy.answer }}</label>
            <textarea
              class="styled-textarea"
              rows="4"
              :value="String(selectedNode.config.message ?? '')"
              @input="emit('update-config', 'message', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="inspector-section">
          <div class="section-head">
            <h5>{{ inspectorCopy.genericConfig }}</h5>
          </div>

          <div v-if="selectedConfigFields.length > 0" class="generic-config-pool">
            <div
              v-for="field in selectedConfigFields"
              :key="field.key"
              class="form-group"
            >
              <label>
                {{ formatNodeFieldLabel(field.key, field.label, label) }}
                <span v-if="field.required" class="required">*</span>
              </label>

              <textarea
                v-if="field.control === 'textarea'"
                class="styled-textarea"
                rows="4"
                :placeholder="field.placeholder"
                :value="String(selectedNode.config[field.key] ?? '')"
                @input="emit('update-config', field.key, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>

              <textarea
                v-else-if="field.control === 'json'"
                class="styled-textarea"
                rows="6"
                :placeholder="field.placeholder"
                :value="formatJsonConfigValue(selectedNode.config[field.key])"
                @blur="emit('update-node-object-config', field.key, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>

              <input
                v-else-if="field.control === 'number'"
                type="number"
                class="styled-input"
                :placeholder="field.placeholder"
                :value="selectedNode.config[field.key] == null ? '' : String(selectedNode.config[field.key])"
                @input="emit('update-number-config', field.key, ($event.target as HTMLInputElement).value)"
              />

              <label v-else-if="field.control === 'boolean'" class="styled-checkbox">
                <input
                  type="checkbox"
                  :checked="Boolean(selectedNode.config[field.key])"
                  @change="emit('update-config', field.key, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ formatNodeFieldLabel(field.key, field.label, label) }}</span>
              </label>

              <select
                v-else-if="field.control === 'select'"
                class="styled-select"
                :value="String(selectedNode.config[field.key] ?? '')"
                @change="emit('update-select-config', field, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ inspectorCopy.selectValue }}</option>
                <option
                  v-for="opt in field.options ?? []"
                  :key="String(opt.value)"
                  :value="String(opt.value)"
                >
                  {{ opt.label }}
                </option>
              </select>

              <input
                v-else
                class="styled-input"
                :placeholder="field.placeholder"
                :value="String(selectedNode.config[field.key] ?? '')"
                @input="emit('update-config', field.key, ($event.target as HTMLInputElement).value)"
              />

              <p v-if="field.helper" class="hint-text">{{ field.helper }}</p>
            </div>
          </div>

          <div class="form-group">
            <label>{{ inspectorCopy.configJson }}</label>
            <textarea
              class="styled-textarea"
              rows="8"
              :value="JSON.stringify(selectedNode.config ?? {}, null, 2)"
              @blur="emit('commit-node-config', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.node-inspector {
  width: 380px;
  border-left: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  z-index: 20;
  box-shadow: -8px 0 40px rgba(0, 0, 0, 0.04);
}

.inspector-header {
  padding: 36px 28px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(24px);
}

.eyebrow {
  display: block;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.node-title {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.remove-btn {
  padding: 8px 16px;
  border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  background: rgba(254, 242, 242, 0.6);
  color: #ef4444;
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.06);
}

.remove-btn:hover {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(239, 68, 68, 0.25);
  border-color: transparent;
}

.inspector-body {
  padding: 28px;
}

.inspector-section {
  margin-bottom: 44px;
}

.section-head {
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-head h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-tertiary);
}

.glass-card {
  padding: 24px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(24px);
  margin-bottom: 20px;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
}

.glass-card:hover {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(229, 231, 235, 0.8);
  transform: translateY(-3px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.05);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.card-label {
  font-size: 15px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.type-badge {
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 99px;
  background: rgba(241, 245, 249, 0.8);
  color: var(--text-secondary);
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid rgba(0, 0, 0, 0.04);
}

.type-badge.ready {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.type-badge.disabled {
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}

.node-description {
  font-size: 16px;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-bottom: 20px;
  font-weight: 600;
  opacity: 0.85;
}

.contract-subsection {
  margin-top: 20px;
  border-top: 1px solid rgba(229, 231, 235, 0.5);
  padding-top: 16px;
}

.subsection-title {
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-tertiary);
  margin-bottom: 14px;
}

.contract-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.03);
}

.contract-row:last-child {
  border-bottom: none;
}

.row-key {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.row-type {
  font-size: 14px;
  color: var(--primary-color);
  background: rgba(16, 163, 127, 0.08);
  padding: 3px 10px;
  border-radius: 8px;
  font-weight: 900;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.row-help {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 4px 0 0;
  line-height: 1.4;
  font-weight: 600;
}

/* Form Styles */
.form-group {
  margin-bottom: 24px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}

.styled-input, .styled-select, .styled-textarea {
  width: 100%;
  padding: 14px 18px;
  background: rgba(248, 250, 252, 0.55);
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 16px;
  font-size: 16px;
  color: var(--text-primary);
  outline: none;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(0,0,0,0.02);
}

.styled-input:focus, .styled-select:focus, .styled-textarea:focus {
  border-color: var(--primary-color);
  background: #fff;
  box-shadow: 0 0 0 4px rgba(16, 163, 127, 0.12), 0 4px 16px rgba(16, 163, 127, 0.08);
  transform: translateY(-2px);
}

.styled-textarea {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 16px;
  line-height: 1.6;
}

.styled-checkbox {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  padding: 8px 0;
}

.styled-checkbox input {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  accent-color: var(--primary-color);
  cursor: pointer;
}

.styled-checkbox span {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-secondary);
}

.required {
  color: #ef4444;
  margin-left: 2px;
}

.type-hint {
  font-size: 13px;
  color: var(--text-tertiary);
  background: rgba(0,0,0,0.05);
  padding: 3px 8px;
  border-radius: 6px;
  margin-left: 8px;
  font-weight: 900;
  letter-spacing: 0.02em;
}

.hint-text {
  font-size: 15px;
  color: var(--text-tertiary);
  margin-top: 12px;
  font-weight: 700;
  opacity: 0.7;
  line-height: 1.5;
}

/* Trace Styles */
.status-chip {
  font-size: 13px;
  padding: 4px 14px;
  border-radius: 99px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid transparent;
}

.status-chip.succeeded { background: rgba(16, 185, 129, 0.12); color: #059669; border-color: rgba(16, 185, 129, 0.15); }
.status-chip.failed { background: rgba(239, 68, 68, 0.12); color: #dc2626; border-color: rgba(239, 68, 68, 0.15); }
.status-chip.skipped { background: rgba(100, 116, 139, 0.12); color: #475569; border-color: rgba(100, 116, 139, 0.15); }

.trace-meta {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.node-id-hint {
  opacity: 0.55;
}

.trace-error {
  padding: 16px 18px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #b91c1c;
  font-size: 16px;
  line-height: 1.6;
  margin-bottom: 16px;
  border-radius: 14px;
  font-weight: 700;
  backdrop-filter: blur(8px);
}

.trace-details-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.trace-summary-card {
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid rgba(16, 185, 129, 0.16);
  border-radius: 18px;
  background: rgba(16, 185, 129, 0.045);
}

.trace-summary-card.warning {
  border-color: rgba(245, 158, 11, 0.22);
  background: rgba(245, 158, 11, 0.055);
}

.trace-summary-card.error {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.045);
}

.trace-summary-title {
  margin-bottom: 12px;
  font-size: 12px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.trace-summary-device {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(226, 232, 240, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  margin-bottom: 12px;
}

.trace-device-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
}

.trace-device-dot.online { background: #10b981; }
.trace-device-dot.offline { background: #ef4444; }
.trace-device-dot.unknown { background: #94a3b8; }

.trace-summary-device div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trace-summary-device strong,
.trace-summary-device span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-summary-device strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.trace-summary-device span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
}

.trace-phase-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.trace-phase-chip {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(255, 255, 255, 0.58);
}

.trace-phase-chip em,
.trace-phase-chip strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}

.trace-phase-chip em {
  margin-bottom: 4px;
  color: var(--text-tertiary);
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.trace-phase-chip strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.trace-phase-chip.success { border-color: rgba(16, 185, 129, 0.18); background: rgba(16, 185, 129, 0.08); }
.trace-phase-chip.warning { border-color: rgba(245, 158, 11, 0.2); background: rgba(245, 158, 11, 0.08); }
.trace-phase-chip.error { border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.08); }

.trace-effect {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-left: 3px solid rgba(16, 185, 129, 0.55);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.56);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  font-weight: 750;
}

.trace-changed-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.trace-changed-fields span {
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 11px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.trace-summary-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trace-summary-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.trace-summary-row span {
  color: var(--text-tertiary);
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.trace-summary-row strong {
  min-width: 0;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.56);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.styled-details {
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.35);
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.styled-details:hover {
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(255, 255, 255, 0.55);
}

.styled-details summary {
  padding: 14px 18px;
  font-size: 16px;
  font-weight: 900;
  color: var(--text-secondary);
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: background 0.25s;
  letter-spacing: 0.02em;
}

.styled-details summary:hover {
  background: rgba(0, 0, 0, 0.02);
}

.json-block {
  padding: 20px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 0 0 16px 16px;
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-x: auto;
  margin: 0;
  line-height: 1.6;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.compact-json {
  font-size: 15px;
  padding: 16px;
  border-radius: 14px;
  border-top: none;
  margin-top: 4px;
}

/* Variable Styles */
.variable-pool {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.variable-tag {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 16px;
  background: rgba(16, 163, 127, 0.04);
  border: 1px solid rgba(16, 163, 127, 0.15);
  border-radius: 14px;
  text-align: left;
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(8px);
}

.variable-tag:hover {
  background: #fff;
  border-color: var(--primary-color);
  transform: scale(1.03) translateY(-3px);
  box-shadow: 0 12px 28px rgba(16, 163, 127, 0.12);
}

.var-name {
  font-size: 15px;
  font-weight: 900;
  color: var(--primary-color);
  letter-spacing: -0.01em;
}

.var-source {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 3px;
}

/* Binding Styles */
.binding-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.binding-row {
  padding: 20px;
  border-color: rgba(16, 163, 127, 0.15);
}

.binding-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.binding-path {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  font-family: ui-monospace, monospace;
  letter-spacing: -0.01em;
}

.remove-binding-btn {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: none;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 900;
}

.remove-binding-btn:hover {
  background: #ef4444;
  color: white;
  transform: scale(1.1);
}

.binding-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.binding-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 12px;
  font-size: 16px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--primary-color);
  font-family: ui-monospace, monospace;
  font-weight: 800;
  outline: none;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.binding-select:focus {
  border-color: var(--primary-color);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.1);
}

.binding-source-label {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Executor Specific */
.cap-tag, .stat-tag, .trait {
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-secondary);
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid rgba(0,0,0,0.03);
}

.capability-list, .executor-stats, .agent-traits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.capability-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.capability-meta-row span {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.trait.live { background: rgba(16, 185, 129, 0.12); color: #059669; border-color: rgba(16, 185, 129, 0.15); }
.trait.idle { background: rgba(241, 245, 249, 0.8); color: #64748b; border-color: rgba(100, 116, 139, 0.1); }

.action-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px 0 10px;
  padding-top: 16px;
  border-top: 1px solid rgba(0,0,0,0.04);
}

.eyebrow-mini {
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  color: var(--text-tertiary);
  letter-spacing: 0.12em;
}

.mini-btn {
  padding: 6px 14px;
  border-radius: 10px;
  border: 1px solid var(--primary-color);
  background: transparent;
  color: var(--primary-color);
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.mini-btn:hover {
  background: var(--primary-color);
  color: white;
  box-shadow: 0 6px 16px rgba(16, 163, 127, 0.25);
  transform: translateY(-2px);
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.executor-description, .agent-desc {
  font-size: 16px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 16px;
  font-weight: 600;
  opacity: 0.85;
}

.param-form {
  margin-top: 20px;
}

.param-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.schema-name {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 6px;
  letter-spacing: -0.01em;
}

.schema-desc {
  font-size: 15px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
  font-weight: 600;
  opacity: 0.8;
}

/* Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 10px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
}
</style>
