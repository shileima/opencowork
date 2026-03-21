/**
 * API 模块统一导出
 * 使用示例:
 *
 * import api from '@/api';
 * // 或者
 * import { projectApi, rpaProjectApi } from '@/api';
 *
 * const projects = await api.project.list();
 * const rpaProjects = await api.rpaProject.list();
 */

export * from './types';
export * from './ipc';
export { default } from './ipc';
