export type StudioDetailTab = {
  route: string
  label: string
}

export function buildWorkflowDetailTabs(
  workflowId: number,
  label: (zh: string, en: string) => string,
): StudioDetailTab[] {
  return [
    { route: `/studio/workflows/${workflowId}/overview`, label: label('概览', 'Overview') },
    { route: `/studio/workflows/${workflowId}/editor`, label: label('编排器', 'Editor') },
    { route: `/studio/workflows/${workflowId}/runs`, label: label('运行记录', 'Runs') },
  ]
}

export function buildSkillDetailTabs(
  skillName: string,
  label: (zh: string, en: string) => string,
): StudioDetailTab[] {
  const name = encodeURIComponent(skillName)
  return [
    { route: `/studio/skills/${name}/overview`, label: label('概览', 'Overview') },
    { route: `/studio/skills/${name}/prompt`, label: label('完整提示词', 'Prompt') },
  ]
}
