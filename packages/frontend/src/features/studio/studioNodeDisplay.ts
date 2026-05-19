type Labeler = (zh: string, en: string) => string

const NODE_LABELS: Record<string, [string, string]> = {
  start: ['开始节点', 'Start'],
  device_control: ['设备控制', 'Device Control'],
  xiaoai: ['小爱音箱', 'XiaoAi'],
  ir_control: ['红外控制', 'IR Control'],
  llm: ['LLM', 'LLM'],
  if_else: ['条件分支', 'Condition'],
  delay: ['延迟', 'Delay'],
  parallel: ['并行', 'Parallel'],
  subflow: ['子流程', 'Subflow'],
  code: ['代码节点', 'Code'],
  executor_call: ['执行器调用', 'Executor Call'],
  answer: ['回答节点', 'Answer'],
}

const NODE_DESCRIPTIONS: Record<string, [string, string]> = {
  start: ['工作流入口节点。', 'Entry node.'],
  device_control: ['控制米家设备实体。', 'Control Mi device entity.'],
  xiaoai: ['向小爱音箱发送语音播报。', 'Send TTS to XiaoAi speaker.'],
  ir_control: ['发送红外按键命令。', 'Send IR key command.'],
  llm: ['执行一次 LLM 推理。', 'Run LLM inference.'],
  if_else: ['根据条件决定分支走向。', 'Boolean branch routing.'],
  delay: ['暂停指定毫秒数。', 'Pause for milliseconds.'],
  parallel: ['并行编排多个分支。', 'Parallel orchestration node.'],
  subflow: ['运行一个子工作流。', 'Run child workflow.'],
  code: ['执行内联 JavaScript 变换。', 'Run inline JavaScript transform.'],
  executor_call: ['通过执行网关调用能力。', 'Invoke executor via gateway.'],
  answer: ['输出最终回答。', 'Output final answer.'],
}

const FIELD_LABELS: Record<string, [string, string]> = {
  inputs: ['输入', 'Inputs'],
  did: ['设备 ID', 'Device ID'],
  siid: ['服务 IID', 'Service IID'],
  piid: ['属性 IID', 'Property IID'],
  aiid: ['动作 IID', 'Action IID'],
  value: ['值', 'Value'],
  params: ['参数', 'Params'],
  text: ['文本', 'Text'],
  silent: ['静音模式', 'Silent Mode'],
  controller_id: ['控制器 ID', 'Controller ID'],
  key_id: ['按键 ID', 'Key ID'],
  prompt: ['提示词', 'Prompt'],
  temperature: ['温度', 'Temperature'],
  left: ['左值', 'Left'],
  operator: ['运算符', 'Operator'],
  right: ['右值', 'Right'],
  duration: ['时长（毫秒）', 'Duration MS'],
  workflow_id: ['工作流 ID', 'Workflow ID'],
  workflow_name: ['工作流名称', 'Workflow Name'],
  output_key: ['输出键', 'Output Key'],
  code: ['代码', 'Code'],
  executor_name: ['执行器名称', 'Executor Name'],
  message: ['消息', 'Message'],
}

const CATEGORY_LABELS: Record<string, [string, string]> = {
  trigger: ['触发器', 'Trigger'],
  device: ['设备', 'Device'],
  logic: ['逻辑', 'Logic'],
  compute: ['计算', 'Compute'],
  control: ['控制', 'Control'],
  output: ['输出', 'Output'],
}

export function formatNodeLabel(type: string, fallback: string, label: Labeler): string {
  const names = NODE_LABELS[type]
  return names ? localize(names[0], names[1], label) : fallback
}

export function formatNodeDescription(type: string, fallback: string, label: Labeler): string {
  const names = NODE_DESCRIPTIONS[type]
  return names ? localize(names[0], names[1], label) : fallback
}

export function formatNodeFieldLabel(key: string, fallback: string, label: Labeler): string {
  const names = FIELD_LABELS[key]
  return names ? localize(names[0], names[1], label) : fallback
}

export function formatNodeCategory(category: string, label: Labeler): string {
  const names = CATEGORY_LABELS[category]
  return names ? localize(names[0], names[1], label) : category
}

function localize(zh: string, en: string, label: Labeler): string {
  return zh === en ? zh : label(zh, en)
}
